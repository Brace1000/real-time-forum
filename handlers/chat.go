package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"real/db"
	"real/auth"
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
    
    _, err := db.DB.Exec("INSERT INTO private_messages(sender_id, receiver_id, content) VALUES(?,?,?)",
        sender, receiver, content)
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
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Extract other user ID from URL
	otherUserParam := r.URL.Path[len("/api/messages/"):]
	otherID, err := strconv.Atoi(otherUserParam)
	if err != nil || otherID == 0 {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	// Get offset for pagination
	offsetStr := r.URL.Query().Get("offset")
	offset, err := strconv.Atoi(offsetStr)
	if err != nil {
		offset = 0
	}

	// Fetch messages between the two users
	rows, err := db.DB.Query(`
		SELECT id, sender_id, receiver_id, content, created_at 
		FROM messages 
		WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) 
		ORDER BY created_at DESC
		LIMIT 50 OFFSET ?`,
		userID, otherID, otherID, userID, offset)
	
	if err != nil {
		log.Println("Database error:", err)
		http.Error(w, "Failed to fetch messages", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var m Message
		var createdAt time.Time
		if err := rows.Scan(&m.ID, &m.SenderID, &m.ReceiverID, &m.Content, &createdAt); err != nil {
			log.Println("Scan error:", err)
			continue
		}
		m.CreatedAt = createdAt.Format(time.RFC3339)
		messages = append(messages, m)
	}

	// Reverse the order to get chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	// Write response as JSON
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(messages)
}

// writeJSON is a helper function to write JSON responses
func writeJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Error encoding JSON: %v", err)
	}
}