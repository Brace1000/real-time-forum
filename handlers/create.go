
package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"real/auth"
	"real/db"
	
)

func GetPostsHandler(w http.ResponseWriter, r *http.Request) {
	// Set JSON content type
	w.Header().Set("Content-Type", "application/json")

	// Get query parameters
	category := r.URL.Query().Get("category")
	myPostsOnly := r.URL.Query().Get("my_posts_only") == "true"
	likedPostsOnly := r.URL.Query().Get("liked_posts_only") == "true"

	// Build base query
	query := `
		SELECT 
			p.post_id,
			p.title,
			p.content,
			IFNULL(p.imgurl, '') as image_url, 
			p.created_at,
			p.user_id,
			u.username,
			u.first_name,
			u.last_name,
			GROUP_CONCAT(c.name) as categories,
			(SELECT COUNT(*) FROM likes WHERE post_id = p.post_id) as like_count,
			(SELECT COUNT(*) FROM comments WHERE post_id = p.post_id) as comment_count
		FROM posts p
		JOIN users u ON p.user_id = u.user_id
		LEFT JOIN post_categories pc ON p.post_id = pc.post_id
		LEFT JOIN categories c ON pc.category_id = c.category_id
	`

	// Add filters
	var args []interface{}
	if category != "" {
		query += " JOIN categories cat ON cat.category_id = pc.category_id AND cat.name = ?"
		args = append(args, category)
	}

	if myPostsOnly {
		userID := auth.GetCurrentUserID(r)
		if userID == 0 {
			http.Error(w, `{"error": "Unauthorized"}`, http.StatusUnauthorized)
			return
		}
		query += " WHERE p.user_id = ?"
		args = append(args, userID)
	}

	if likedPostsOnly {
		userID := auth.GetCurrentUserID(r)
		if userID == 0 {
			http.Error(w, `{"error": "Unauthorized"}`, http.StatusUnauthorized)
			return
		}
		query += " WHERE EXISTS (SELECT 1 FROM likes WHERE post_id = p.post_id AND user_id = ?)"
		args = append(args, userID)
	}

	// Complete query
	query += " GROUP BY p.post_id ORDER BY p.created_at DESC"

	// Execute query
	rows, err := db.DB.Query(query, args...)
	if err != nil {
		log.Printf("Database error: %v", err)
		http.Error(w, `{"error": "Database error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var posts []map[string]interface{}
	for rows.Next() {
		var postID, userID int
		var title, content, imageURL, createdAt, username, firstName, lastName string
		var categories sql.NullString
		//var imageURL sql.NullString
		//var likeCount, commentCount int
		var likeCount, commentCount int

		err := rows.Scan(
			&postID, &title, &content, &imageURL, &createdAt,
			&userID, &username, &firstName, &lastName,
			&categories, &likeCount, &commentCount,
		)
		if err != nil {
			log.Printf("Row scan error: %v", err)
			continue
		}

		post := map[string]interface{}{
			"post_id":      postID,
			"title":        title,
			"content":      content,
			"image_url":    imageURL,
			"created_at":   createdAt,
			"user_id":      userID,
			"username":     username,
			"first_name":   firstName,
			"last_name":    lastName,
			"categories":   categories.String,
			"like_count":   likeCount,
			"comment_count": commentCount,
		}

		posts = append(posts, post)
	}

	json.NewEncoder(w).Encode(posts)
}