package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"real/db"
)

func LikeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Invalid request method"}`, http.StatusMethodNotAllowed)
		return
	}

	
	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))


	var req struct {
		
		UserID   int    `json:"user_id,string"`
		PostID   *int   `json:"post_id"` 
		LikeType string `json:"like_type"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// If it fails now, something is seriously wrong with the JSON structure itself.
		log.Printf("JSON decoding error: %v", err)
		http.Error(w, `{"error": "Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	// Stricter validation (now that decoding has succeeded)
	if req.UserID == 0 || req.PostID == nil || (*req.PostID == 0) || (req.LikeType != "like" && req.LikeType != "dislike") {
		http.Error(w, `{"error": "Missing or invalid required fields after parsing"}`, http.StatusBadRequest)
		return
	}

	// --- Use a Transaction for Atomic Operations ---
	tx, err := db.DB.Begin()
	if err != nil {
		log.Printf("Failed to begin transaction: %v", err)
		http.Error(w, `{"error": "Database error"}`, http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	var finalUserReaction string
	var existingLikeType string
	err = tx.QueryRow(
		`SELECT like_type FROM likes WHERE user_id = ? AND post_id = ?`,
		req.UserID, *req.PostID,
	).Scan(&existingLikeType)

	if err == sql.ErrNoRows {
		_, err = tx.Exec(
			`INSERT INTO likes (user_id, post_id, like_type) VALUES (?, ?, ?)`,
			req.UserID, *req.PostID, req.LikeType,
		)
		if err == nil {
			finalUserReaction = req.LikeType
		}
	} else if err == nil && existingLikeType == req.LikeType {
		_, err = tx.Exec(
			`DELETE FROM likes WHERE user_id = ? AND post_id = ?`,
			req.UserID, *req.PostID,
		)
		finalUserReaction = ""
	} else if err == nil {
		_, err = tx.Exec(
			`UPDATE likes SET like_type = ? WHERE user_id = ? AND post_id = ?`,
			req.LikeType, req.UserID, *req.PostID,
		)
		if err == nil {
			finalUserReaction = req.LikeType
		}
	}

	if err != nil && err != sql.ErrNoRows {
		log.Printf("Error processing like/dislike: %v", err)
		http.Error(w, `{"error": "Failed to update reaction"}`, http.StatusInternalServerError)
		return
	}

	var likes, dislikes int
	var nullLikes, nullDislikes sql.NullInt64
	err = tx.QueryRow(`
        SELECT 
            SUM(CASE WHEN like_type = 'like' THEN 1 ELSE 0 END),
            SUM(CASE WHEN like_type = 'dislike' THEN 1 ELSE 0 END)
        FROM likes
        WHERE post_id = ?`, *req.PostID,
	).Scan(&nullLikes, &nullDislikes)

	if err != nil {
		log.Printf("Error getting counts: %v", err)
		http.Error(w, `{"error": "Failed to retrieve counts"}`, http.StatusInternalServerError)
		return
	}
	likes = int(nullLikes.Int64)
	dislikes = int(nullDislikes.Int64)

	if err = tx.Commit(); err != nil {
		log.Printf("Failed to commit transaction: %v", err)
		http.Error(w, `{"error": "Failed to finalize reaction"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"likes":        likes,
        "dislikes":     dislikes,
		"userReaction": finalUserReaction,
	})
}