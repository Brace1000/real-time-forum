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
		// Allow connections from your frontend origin
		origin := r.Header.Get("Origin")
		return origin == "http://localhost:8081" || origin == "http://localhost:3000"
	},
}

type Client struct {
	conn   *websocket.Conn
	userID int
	send   chan []byte
}

var (
	clients      = make(map[int]*Client)
	clientsMutex sync.RWMutex
)

// HandleWebSocket upgrades HTTP connection to WebSocket and manages the connection
func HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	log.Println("WebSocket connection attempt received")

	// Get user ID from session/auth
	userID := auth.GetCurrentUserID(r)
	if userID == 0 {
		log.Println("WebSocket: Unauthorized connection attempt")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	log.Printf("Attempting to upgrade WebSocket connection for user ID %d", userID)

	// Upgrade connection
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	log.Printf("Successful WebSocket connection for user ID %d", userID)

	// Handle existing client connection
	clientsMutex.Lock()
	if existingClient, exists := clients[userID]; exists {
		log.Printf("Replacing existing connection for User ID %d", userID)
		// Close existing connection gracefully
		close(existingClient.send)
		existingClient.conn.Close()
	}

	// Create new client
	client := &Client{
		conn:   conn,
		userID: userID,
		send:   make(chan []byte, 256),
	}

	// Register client
	clients[userID] = client
	clientsMutex.Unlock()

	log.Printf("Client registered: User ID %d", userID)

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
		// Update user status to offline
		auth.UpdateUserStatus(c.userID, false)
		broadcastUserStatus(c.userID, false)
	}()

	// Set read deadline and pong handler
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			} else {
				log.Printf("WebSocket connection closed normally for user %d", c.userID)
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

		switch msg.Type {
		case "message":
			if msg.To > 0 && msg.Content != "" {
				log.Printf("Processing private message from %d to %d", c.userID, msg.To)
				
				// Save message to database
				if err := SavePrivateMessage(c.userID, msg.To, msg.Content); err != nil {
					log.Printf("Failed to save message: %v", err)
					continue
				}

				// Send to recipient
				sendToRecipient(c.userID, msg.To, msg.Content)
			}
		case "ping":
			// Handle ping from client
			c.sendJSON(map[string]string{"type": "pong"})
		default:
			log.Printf("Unknown message type: %s", msg.Type)
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

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("Write error for user %d: %v", c.userID, err)
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
				log.Printf("Ping error for user %d: %v", c.userID, err)
				return
			}
		}
	}
}

// Helper method to send JSON messages
func (c *Client) sendJSON(data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	select {
	case c.send <- jsonData:
		return nil
	default:
		return err
	}
}

func unregisterClient(userID int) {
	clientsMutex.Lock()
	defer clientsMutex.Unlock()

	if client, ok := clients[userID]; ok {
		close(client.send)
		delete(clients, userID)
		log.Printf("Client unregistered: User ID %d", userID)
	}
}

func sendToRecipient(from, to int, content string) {
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

	clientsMutex.RLock()
	client, ok := clients[to]
	clientsMutex.RUnlock()

	if ok {
		select {
		case client.send <- jsonMsg:
			log.Printf("Message sent from %d to %d", from, to)
		default:
			log.Printf("Client buffer full for user %d", to)
			// Don't unregister here to avoid potential deadlock
			go func() {
				unregisterClient(to)
				auth.UpdateUserStatus(to, false)
				broadcastUserStatus(to, false)
			}()
		}
	} else {
		log.Printf("Recipient %d not connected", to)
	}

	// Also send confirmation back to sender
	clientsMutex.RLock()
	senderClient, senderOk := clients[from]
	clientsMutex.RUnlock()

	if senderOk {
		confirmMsg := map[string]interface{}{
			"type":      "message_sent",
			"to":        to,
			"content":   content,
			"timestamp": time.Now().Format(time.RFC3339),
		}

		if confirmJsonMsg, err := json.Marshal(confirmMsg); err == nil {
			select {
			case senderClient.send <- confirmJsonMsg:
			default:
				// Sender buffer full, ignore confirmation
			}
		}
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

	clientsMutex.RLock()
	defer clientsMutex.RUnlock()

	for _, client := range clients {
		if client.userID != userID {
			select {
			case client.send <- jsonStatus:
				// Status sent successfully
			default:
				// Client buffer full - handle asynchronously
				go func(id int) {
					unregisterClient(id)
					auth.UpdateUserStatus(id, false)
				}(client.userID)
			}
		}
	}
}

// SendMessageToClient - external function to send messages to specific clients
func SendMessageToClient(from, to int, content string) {
	sendToRecipient(from, to, content)
}

// GetOnlineUsers returns list of currently connected users
func GetOnlineUsers() []int {
	clientsMutex.RLock()
	defer clientsMutex.RUnlock()

	users := make([]int, 0, len(clients))
	for userID := range clients {
		users = append(users, userID)
	}
	return users
}