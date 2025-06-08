// main.go
package main

import (
	"encoding/json"
	"log"
	"net/http"

	"real/db"
	"real/handlers"
)

func main() {
	if err := db.Init("./forum.db"); err != nil {
		log.Fatalf("Database initialization failed: %v", err)
	}
	defer db.DB.Close()

	// Set up API routes
	http.HandleFunc("/api/categories", handlers.GetCategoriesHandler)
	http.HandleFunc("/api/posts", handlers.GetPostsHandler) // Add this line
	http.HandleFunc("/post/create", handlers.CreatePostHandler)
	http.HandleFunc("/login", recoverMiddleware(handlers.LoginHandler))
	http.HandleFunc("/register", recoverMiddleware(handlers.RegisterHandler))
	// Serve static files
	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/static/", http.StripPrefix("/static/", fs))
	http.Handle("/images/", http.StripPrefix("/images/", http.FileServer(http.Dir("./static/images"))))

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			if _, err := http.Dir("./static").Open(r.URL.Path); err != nil {
				http.ServeFile(w, r, "./static/index.html")
				return
			}
		}

		http.ServeFile(w, r, "./static/index.html")
	})

	// Start server
	log.Println("Server started at http://localhost:8085")
	log.Fatal(http.ListenAndServe(":8085", nil))
}

func recoverMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("Panic recovered: %v", err)
				writeJSON(w, http.StatusInternalServerError, map[string]string{
					"status":  "error",
					"message": "Internal server error",
				})
			}
		}()
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("JSON encode error: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}