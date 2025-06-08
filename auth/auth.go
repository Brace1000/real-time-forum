// auth/auth.go
package auth

import (
	//"database/sql"
	"net/http"
	//"strconv"
	"strings"
	"time"
	"real/db"
)

// GetUserID returns the user ID as string from request
func GetUserID(r *http.Request) (string, bool) {
	// Try cookie first
	cookie, err := r.Cookie("session_id")
	if err == nil && cookie != nil {
		userID, err := validateSession(cookie.Value)
		if err == nil && userID != "" {
			return userID, true
		}
	}

	// Try Authorization header
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		userID, err := validateSession(token)
		if err == nil && userID != "" {
			return userID, true
		}
	}

	return "", false
}

// GetCurrentUserID returns the user ID as int from context
func GetCurrentUserID(r *http.Request) int {
	if userID, ok := r.Context().Value("userID").(int); ok {
		return userID
	}
	return 0
}

// AuthMiddleware verifies authentication
func AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		
	}
}

func validateSession(sessionID string) (string, error) {
	var userID string
	err := db.DB.QueryRow(
		"SELECT user_id FROM sessions WHERE session_id = ? AND expires_at > ?",
		sessionID,
		time.Now(),
	).Scan(&userID)
	
	if err != nil {
		return "", err
	}
	return userID, nil
}