package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"real/auth"
	"real/db"
	"strconv"
	"time"
    "database/sql"
)

// Comment struct definition
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

// Comment reaction request struct
type CommentReactionRequest struct {
    UserID    int    `json:"user_id,string"`    
    CommentID int    `json:"comment_id,string"` 
    LikeType  string `json:"like_type"`
}
type CommentReactionRequestAlt struct {
    UserIDStr    string `json:"user_id"`
    CommentIDStr string `json:"comment_id"`
    LikeType     string `json:"like_type"`
}

// Helper method to convert to integers
func (r *CommentReactionRequestAlt) GetUserID() (int, error) {
    return strconv.Atoi(r.UserIDStr)
}

func (r *CommentReactionRequestAlt) GetCommentID() (int, error) {
    return strconv.Atoi(r.CommentIDStr)
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
            COALESCE(u.first_name, '') as first_name,
            COALESCE(u.last_name, '') as last_name,
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

func CommentReactionHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    if r.Method != http.MethodPost {
        w.WriteHeader(http.StatusMethodNotAllowed)
        json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request method"})
        return
    }

    // Parse request body
    var req CommentReactionRequest
    
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        w.WriteHeader(http.StatusBadRequest)
        json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request data"})
        return
    }

   

    // Validate input
    if req.UserID <= 0 || req.CommentID <= 0 {
        w.WriteHeader(http.StatusBadRequest)
        json.NewEncoder(w).Encode(map[string]string{"error": "Invalid user or comment ID"})
        return
    }

    if req.LikeType != "like" && req.LikeType != "dislike" {
        w.WriteHeader(http.StatusBadRequest)
        json.NewEncoder(w).Encode(map[string]string{"error": "Invalid reaction type"})
        return
    }

    // Check if reaction exists
    var existingReaction string
    err := db.DB.QueryRow(`
        SELECT reaction_type FROM comment_reactions 
        WHERE user_id = ? AND comment_id = ?
    `, req.UserID, req.CommentID).Scan(&existingReaction)

    // Handle reaction based on current state
    var query string
    var args []interface{}
    
    if err == sql.ErrNoRows {
        // New reaction - insert
        query = `INSERT INTO comment_reactions (user_id, comment_id, reaction_type) VALUES (?, ?, ?)`
        args = []interface{}{req.UserID, req.CommentID, req.LikeType}
        
    } else if err == nil && existingReaction == req.LikeType {
        // Same reaction - remove it (toggle off)
        query = `DELETE FROM comment_reactions WHERE user_id = ? AND comment_id = ?`
        args = []interface{}{req.UserID, req.CommentID}
        
    } else if err == nil {
        // Different reaction - update it
        query = `UPDATE comment_reactions SET reaction_type = ? WHERE user_id = ? AND comment_id = ?`
        args = []interface{}{req.LikeType, req.UserID, req.CommentID}
        
    } else {
        // Database error
        log.Printf("Database error checking existing reaction: %v", err)
        w.WriteHeader(http.StatusInternalServerError)
        json.NewEncoder(w).Encode(map[string]string{"error": "Database error"})
        return
    }

    // Execute the query
    _, err = db.DB.Exec(query, args...)
    if err != nil {
        log.Printf("Database error executing reaction query: %v", err)
        w.WriteHeader(http.StatusInternalServerError)
        json.NewEncoder(w).Encode(map[string]string{"error": "Failed to process reaction"})
        return
    }

    // Get updated counts and user's current reaction
    var likes, dislikes int
    var userReaction sql.NullString
    
    err = db.DB.QueryRow(`
        SELECT 
            COALESCE(SUM(CASE WHEN reaction_type = 'like' THEN 1 ELSE 0 END), 0) as likes,
            COALESCE(SUM(CASE WHEN reaction_type = 'dislike' THEN 1 ELSE 0 END), 0) as dislikes
        FROM comment_reactions
        WHERE comment_id = ?
        GROUP BY comment_id
        UNION ALL
        SELECT 0, 0
        WHERE NOT EXISTS (SELECT 1 FROM comment_reactions WHERE comment_id = ?)
        LIMIT 1
    `, req.CommentID, req.CommentID).Scan(&likes, &dislikes)

    if err != nil {
        
        w.WriteHeader(http.StatusInternalServerError)
        json.NewEncoder(w).Encode(map[string]string{"error": "Failed to get reaction counts"})
        return
    }

    // Get user's current reaction
    err = db.DB.QueryRow(`
        SELECT reaction_type FROM comment_reactions 
        WHERE user_id = ? AND comment_id = ?
    `, req.UserID, req.CommentID).Scan(&userReaction)

    var userReactionStr string
    if err == sql.ErrNoRows {
        userReactionStr = ""
    } else if err != nil {
        log.Printf("Error getting user reaction: %v", err)
        userReactionStr = ""
    } else {
        userReactionStr = userReaction.String
    }

    // Return response
    response := map[string]interface{}{
        "success":      true,
        "likes":        likes,
        "dislikes":     dislikes,
        "userReaction": userReactionStr,
    }
    
 
    json.NewEncoder(w).Encode(response)
}