package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"real/auth"
	"real/db"
	"strconv"
	"time"
)

type Message struct {
	ID         int    `json:"id"`
	SenderID   int    `json:"senderId"`
	ReceiverID int    `json:"receiverId"`
	Content    string `json:"content"`
	CreatedAt  string `json:"createdAt"`
}

// SavePrivateMessage stores a message in the database
func SavePrivateMessage(sender, receiver int, content string) error {
	log.Printf("Attempting to save message from %d to %d: %s", sender, receiver, content)
	
	_, err := db.DB.Exec(`
		INSERT INTO private_messages (sender_id, receiver_id, content, created_at) 
		VALUES (?, ?, ?, ?)`,
		sender, receiver, content, time.Now())
	
	if err != nil {
		log.Printf("Error saving message: %v", err)
		return err
	}
	
	log.Println("Message saved successfully")
	return nil
}

// GetMessageHistory retrieves message history between two users
func GetMessageHistory(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetCurrentUserID(r)
	if userID == 0 {
		log.Println("GetMessageHistory: Unauthorized request")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Extract other user ID from URL path
	path := r.URL.Path
	if len(path) <= len("/api/messages/") {
		http.Error(w, "Invalid URL path", http.StatusBadRequest)
		return
	}
	
	otherUserParam := path[len("/api/messages/"):]
	otherID, err := strconv.Atoi(otherUserParam)
	if err != nil || otherID == 0 {
		log.Printf("Invalid user ID parameter: %s", otherUserParam)
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	// Get offset for pagination
	offsetStr := r.URL.Query().Get("offset")
	offset, err := strconv.Atoi(offsetStr)
	if err != nil {
		offset = 0
	}

	log.Printf("Fetching message history between users %d and %d (offset: %d)", userID, otherID, offset)

	// Fetch messages between the two users
	// Note: Using private_messages table name to match SavePrivateMessage function
	rows, err := db.DB.Query(`
		SELECT id, sender_id, receiver_id, content, created_at
		FROM private_messages
		WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
		ORDER BY created_at DESC
		LIMIT 50 OFFSET ?`,
		userID, otherID, otherID, userID, offset)
	
	if err != nil {
		log.Printf("Database error fetching messages: %v", err)
		http.Error(w, "Failed to fetch messages", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var m Message
		var createdAt time.Time
		
		if err := rows.Scan(&m.ID, &m.SenderID, &m.ReceiverID, &m.Content, &createdAt); err != nil {
			log.Printf("Error scanning message row: %v", err)
			continue
		}
		
		m.CreatedAt = createdAt.Format(time.RFC3339)
		messages = append(messages, m)
	}

	// Check for any row iteration errors
	if err = rows.Err(); err != nil {
		log.Printf("Row iteration error: %v", err)
		http.Error(w, "Failed to process messages", http.StatusInternalServerError)
		return
	}

	// Reverse the order to get chronological order (oldest first)
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	log.Printf("Retrieved %d messages between users %d and %d", len(messages), userID, otherID)

	// Write response as JSON
	writeJSON(w, http.StatusOK, messages)
}

// GetOnlineUsersHandler returns list of currently online users
func GetOnlineUsersHandler(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetCurrentUserID(r)
	if userID == 0 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get online users from WebSocket connections
	onlineUsers := GetOnlineUsers()
	
	// You might want to get additional user info from database
	type OnlineUser struct {
		ID       int    `json:"id"`
		Username string `json:"username"`
	}

	var users []OnlineUser
	for _, id := range onlineUsers {
		var username string
		err := db.DB.QueryRow("SELECT username FROM users WHERE id = ?", id).Scan(&username)
		if err != nil {
			log.Printf("Error getting username for user %d: %v", id, err)
			continue
		}
		
		users = append(users, OnlineUser{
			ID:       id,
			Username: username,
		})
	}

	writeJSON(w, http.StatusOK, users)
}

// GetUserChatsHandler returns list of users that current user has chatted with
func GetUserChatsHandler(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetCurrentUserID(r)
	if userID == 0 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get users who have exchanged messages with current user
	rows, err := db.DB.Query(`
		SELECT DISTINCT 
			CASE 
				WHEN sender_id = ? THEN receiver_id 
				ELSE sender_id 
			END as other_user_id,
			u.username,
			MAX(pm.created_at) as last_message_time
		FROM private_messages pm
		JOIN users u ON u.id = CASE 
			WHEN pm.sender_id = ? THEN pm.receiver_id 
			ELSE pm.sender_id 
		END
		WHERE sender_id = ? OR receiver_id = ?
		GROUP BY other_user_id, u.username
		ORDER BY last_message_time DESC`,
		userID, userID, userID, userID)

	if err != nil {
		log.Printf("Error fetching user chats: %v", err)
		http.Error(w, "Failed to fetch chats", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type ChatUser struct {
		ID               int    `json:"id"`
		Username         string `json:"username"`
		LastMessageTime  string `json:"lastMessageTime"`
	}

	var chatUsers []ChatUser
	for rows.Next() {
		var cu ChatUser
		var lastMsgTime time.Time
		
		if err := rows.Scan(&cu.ID, &cu.Username, &lastMsgTime); err != nil {
			log.Printf("Error scanning chat user: %v", err)
			continue
		}
		
		cu.LastMessageTime = lastMsgTime.Format(time.RFC3339)
		chatUsers = append(chatUsers, cu)
	}

	writeJSON(w, http.StatusOK, chatUsers)
}

// writeJSON is a helper function to write JSON responses
func writeJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Error encoding JSON: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}