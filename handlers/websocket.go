// handlers/websocket.go
package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"real/auth"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Client struct {
	conn   *websocket.Conn
	userID int
	send   chan []byte // Changed to []byte for more flexible message passing
}

var (
	clients       = make(map[int]*Client)
	clientsMutex  sync.Mutex
)

// HandleWebSocket upgrades HTTP connection to WebSocket and manages the connection
func HandleWebSocket(w http.ResponseWriter, r *http.Request){
log.Println("Attempting to upgrade to WebSocket connection") 
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}

	userID := auth.GetCurrentUserID(r)
	if userID == 0 {
		log.Println("WebSocket: Unauthorized connection attempt")
		
		return
	}
	log.Printf("Successful WebSocket connection for user ID %d", userID)


	// Check if client already exists, close previous connection
	clientsMutex.Lock()
	if existingClient, exists := clients[userID]; exists {
		// Close the send channel to signal the writePump to exit
		close(existingClient.send)
		// Don't close connection here - let the writePump handle it
		log.Printf("Replacing existing connection for User ID %d", userID)
	}
	clientsMutex.Unlock()

	client := &Client{
		conn:   conn,
		userID: userID,
		send:   make(chan []byte, 256),
	}

	// Register client
	registerClient(client)
	
	// Update user status to online
	auth.UpdateUserStatus(userID, true)
	
	// Broadcast user status change to all clients
	broadcastUserStatus(userID, true)

	// Start goroutines for reading and writing
	go client.readPump()
	go client.writePump()
}

func (c *Client) readPump() {
    defer func() {
        log.Printf("Closing connection for user %d", c.userID)
        unregisterClient(c.userID)
        c.conn.Close()
    }()

    for {
        _, message, err := c.conn.ReadMessage()
        if err != nil {
            if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
                log.Printf("WebSocket read error: %v", err)
            }
            break
        }

        log.Printf("Received raw message from user %d: %s", c.userID, string(message))

        var msg struct {
            Type    string `json:"type"`
            To      int    `json:"to"`
            Content string `json:"content"`
        }

        if err := json.Unmarshal(message, &msg); err != nil {
            log.Printf("Error parsing message: %v", err)
            continue
        }

        log.Printf("Parsed message: %+v", msg)

        if msg.Type == "message" && msg.To > 0 && msg.Content != "" {
            log.Printf("Processing private message from %d to %d", c.userID, msg.To)
            
            if err := SavePrivateMessage(c.userID, msg.To, msg.Content); err != nil {
                log.Printf("Failed to save message: %v", err)
                continue
            }

            sendToRecipient(c.userID, msg.To, msg.Content)
        }
    }
}

func SendMessageToClient(from, to int, content string) {
    msg := map[string]interface{}{
        "type":      "message",
        "from":      from,
        "to":        to,
        "content":   content,
        "timestamp": time.Now().Format(time.RFC3339),
    }

    jsonMsg, err := json.Marshal(msg)
    if err != nil {
        log.Printf("Error marshalling message: %v", err)
        return
    }

    clientsMutex.Lock()
    defer clientsMutex.Unlock()
    
    if client, ok := clients[to]; ok {
        select {
        case client.send <- jsonMsg:
        default:
            // Handle full buffer
            close(client.send)
            delete(clients, to)
        }
    }
}

func (c *Client) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				// Channel closed
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued chat messages to the current websocket message
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func registerClient(c *Client) {
	clientsMutex.Lock()
	defer clientsMutex.Unlock()
	
	clients[c.userID] = c
	log.Printf("Client registered: User ID %d", c.userID)
}

func unregisterClient(userID int) {
	clientsMutex.Lock()
	defer clientsMutex.Unlock()
	
	if _, ok := clients[userID]; ok {
		delete(clients, userID)
		log.Printf("Client unregistered: User ID %d", userID)
	}
}

func sendToRecipient(from, to int, content string) {
	clientsMutex.Lock()
	client, ok := clients[to]
	clientsMutex.Unlock()

	msg := map[string]interface{}{
		"type":      "message",
		"from":      from,
		"content":   content,
		"timestamp": time.Now().Format(time.RFC3339),
	}

	jsonMsg, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Error marshalling message: %v", err)
		return
	}

	if ok {
		select {
		case client.send <- jsonMsg:
			// Message sent to client's channel
			log.Printf("Message sent from %d to %d", from, to)
		default:
			// Client's buffer is full
			log.Printf("Client buffer full for user %d", to)
			unregisterClient(to)
			auth.UpdateUserStatus(to, false)
		}
	} else {
		log.Printf("Recipient %d not connected", to)
	}
}

func broadcastUserStatus(userID int, isOnline bool) {
	status := map[string]interface{}{
		"type":     "user_status",
		"userId":   userID,
		"isOnline": isOnline,
	}

	jsonStatus, err := json.Marshal(status)
	if err != nil {
		log.Printf("Error marshalling status: %v", err)
		return
	}

	clientsMutex.Lock()
	defer clientsMutex.Unlock()
	
	for _, client := range clients {
		if client.userID != userID {
			select {
			case client.send <- jsonStatus:
				// Status sent to client's channel
			default:
				// Client's buffer is full - don't unregister here to avoid
				// deadlock since we're already holding the mutex
				go func(id int) {
					unregisterClient(id)
					auth.UpdateUserStatus(id, false)
				}(client.userID)
			}
		}
	}
}