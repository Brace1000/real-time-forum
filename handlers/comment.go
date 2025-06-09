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

// You should already have this struct definition from before.
type Comment struct {
    CommentID    int       `json:"comment_id"`
    PostID       int       `json:"post_id"`
    UserID       int       `json:"user_id"`
    Content      string    `json:"content"`
    CreatedAt    time.Time `json:"created_at"`
    Author       string    `json:"author"`       
    FirstName    string    `json:"first_name"`   
    LastName     string    `json:"last_name"`    
    Likes        int       `json:"likes"`
    Dislikes     int       `json:"dislikes"`
    UserReaction string    `json:"user_reaction"`
}

func CreateCommentHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    if r.Method != http.MethodPost {
        w.WriteHeader(http.StatusMethodNotAllowed)
        json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request method"})
        return
    }

    // Get user ID from context or session
    userIDStr, ok := auth.GetUserID(r)
    if !ok || userIDStr == "" {
        w.WriteHeader(http.StatusUnauthorized)
        json.NewEncoder(w).Encode(map[string]string{"error": "You must be logged in to comment"})
        return
    }

    // Parse form data
    if err := r.ParseForm(); err != nil {
        w.WriteHeader(http.StatusBadRequest)
        json.NewEncoder(w).Encode(map[string]string{"error": "Cannot parse form"})
        return
    }

    // Get post ID and content
    postID, err := strconv.Atoi(r.FormValue("post_id"))
    if err != nil {
        w.WriteHeader(http.StatusBadRequest)
        json.NewEncoder(w).Encode(map[string]string{"error": "Invalid post ID"})
        return
    }

    content := r.FormValue("content")
    if content == "" {
        w.WriteHeader(http.StatusBadRequest)
        json.NewEncoder(w).Encode(map[string]string{"error": "Content cannot be empty"})
        return
    }

    // Convert userID to int
    userID, err := strconv.Atoi(userIDStr)
    if err != nil {
        w.WriteHeader(http.StatusInternalServerError)
        json.NewEncoder(w).Encode(map[string]string{"error": "Invalid user session data"})
        return
    }

    // Insert comment
    result, err := db.DB.Exec(
        "INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)", 
        postID, userID, content,
    )
    if err != nil {
        log.Printf("Database error inserting comment: %v", err)
        w.WriteHeader(http.StatusInternalServerError)
        json.NewEncoder(w).Encode(map[string]string{"error": "Failed to save comment"})
        return
    }

    // Get the new comment ID
    commentID, err := result.LastInsertId()
    if err != nil {
        log.Printf("Error getting last insert ID: %v", err)
        w.WriteHeader(http.StatusInternalServerError)
        json.NewEncoder(w).Encode(map[string]string{"error": "Failed to get comment ID"})
        return
    }

    // Retrieve the full comment data
    var comment Comment
    err = db.DB.QueryRow(`
        SELECT 
            c.comment_id, 
            c.post_id, 
            c.user_id, 
            c.content, 
            c.created_at,
            u.username,
            u.first_name,
            u.last_name,
            0 as likes,
            0 as dislikes,
            '' as user_reaction
        FROM comments c
        JOIN users u ON c.user_id = u.user_id
        WHERE c.comment_id = ?
    `, commentID).Scan(
        &comment.CommentID,
        &comment.PostID,
        &comment.UserID,
        &comment.Content,
        &comment.CreatedAt,
        &comment.Author,
        &comment.FirstName,
        &comment.LastName,
        &comment.Likes,
        &comment.Dislikes,
        &comment.UserReaction,
    )

    if err != nil {
        log.Printf("Database error fetching comment: %v", err)
        w.WriteHeader(http.StatusInternalServerError)
        json.NewEncoder(w).Encode(map[string]string{"error": "Comment created but could not retrieve details"})
        return
    }

    // Success response
    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(comment)
}