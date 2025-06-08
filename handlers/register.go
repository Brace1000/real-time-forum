package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"real/db"
)

func RegisterHandler(w http.ResponseWriter, r *http.Request) {
    
    w.Header().Set("Content-Type", "application/json")

    if r.Method != http.MethodPost {
        WriteJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Only POST method allowed"})
        return
    }

    // Parse form data
    if err := r.ParseMultipartForm(10 << 20); err != nil {
        log.Println("Form parse error:", err)
        WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "Failed to parse form"})
        return
    }

    // Extract form values
    formData := map[string]string{
        "username":      r.FormValue("username"),
        "email":         r.FormValue("email"),
        "password":      r.FormValue("password"),
        "confirmpassword": r.FormValue("confirmpassword"),
        "firstname":     r.FormValue("firstname"),
        "lastname":      r.FormValue("lastname"),
        "age":           r.FormValue("age"),
        "gender":        r.FormValue("gender"),
    }

    // Validate inputs
    errors := validateRegistrationInput(
        formData["username"],
        formData["age"],
        formData["gender"],
        formData["firstname"],
        formData["lastname"],
        formData["email"],
        formData["password"],
        formData["confirmpassword"],
    )

    if len(errors) > 0 {
        WriteJSON(w, http.StatusBadRequest, map[string]interface{}{"errors": errors})
        return
    }

    // Convert age to int
    age, _ := strconv.Atoi(formData["age"])

    // Check for existing user in transaction to prevent race conditions
    tx, err := db.DB.Begin()
    if err != nil {
        log.Printf("Transaction begin error: %v", err)
        WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
        return
    }
    defer tx.Rollback() // Safe to call if tx is already committed

    // Check for existing user
    var emailExists, usernameExists bool
    err = tx.QueryRow(
        `SELECT EXISTS(SELECT 1 FROM users WHERE email = ?), 
                EXISTS(SELECT 1 FROM users WHERE username = ?)`,
        formData["email"], formData["username"],
    ).Scan(&emailExists, &usernameExists)

    if err != nil {
        log.Printf("Database error checking user existence: %v", err)
        WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
        return
    }

    if emailExists || usernameExists {
        errorResponse := map[string]interface{}{
            "errors": make(map[string]string),
        }
        if emailExists {
            errorResponse["errors"].(map[string]string)["email"] = "Email already in use"
        }
        if usernameExists {
            errorResponse["errors"].(map[string]string)["username"] = "Username already taken"
        }
        WriteJSON(w, http.StatusConflict, errorResponse)
        return
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(formData["password"]), bcrypt.DefaultCost)
    if err != nil {
        log.Printf("Password hashing error: %v", err)
        WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
        return
    }

    // Insert user
    result, err := tx.Exec(
        `INSERT INTO users (
            username, email, password, first_name, last_name, age, gender, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        formData["username"],
        formData["email"],
        string(hashedPassword),
        formData["firstname"],
        formData["lastname"],
        age,
        formData["gender"],
        time.Now(),
    )

    if err != nil {
        log.Printf("User insert error: %v", err)
        WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "Registration failed"})
        return
    }

    userID, err := result.LastInsertId()
    if err != nil {
        log.Printf("LastInsertId error: %v", err)
        WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
        return
    }

    // Create session
    sessionID := uuid.New().String()
    expiresAt := time.Now().Add(24 * time.Hour)

    _, err = tx.Exec(
        `INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)`,
        sessionID, userID, expiresAt,
    )
    if err != nil {
        log.Printf("Session creation error: %v", err)
        WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
        return
    }

    // Commit transaction
    if err := tx.Commit(); err != nil {
        log.Printf("Transaction commit error: %v", err)
        WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
        return
    }

    // Set cookie
    http.SetCookie(w, &http.Cookie{
        Name:     "session_id",
        Value:    sessionID,
        Path:     "/",
        Expires:  expiresAt,
        HttpOnly: true,
        Secure:   true,
        SameSite: http.SameSiteStrictMode,
    })

    // Success response
    WriteJSON(w, http.StatusCreated, map[string]interface{}{
        "success": true,
        "message": "Registration successful",
        "user": map[string]interface{}{
            "id":       userID,
            "username": formData["username"],
            "email":    formData["email"],
        },
    })
}

// Reusable helper to write JSON responses
func WriteJSON(w http.ResponseWriter, status int, data interface{}) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    if err := json.NewEncoder(w).Encode(data); err != nil {
        log.Printf("JSON encode error: %v", err)
        http.Error(w, "Failed to encode response", http.StatusInternalServerError)
    }
}

// Your existing validation function
func validateRegistrationInput(username, ageStr, gender, firstname, lastname, email, password, confirmpassword string) map[string]string {
	errors := make(map[string]string)

	if username == "" {
		errors["username"] = "Username cannot be empty"
	} else if len(username) < 3 {
		errors["username"] = "Username must be at least 3 characters"
	}

	if ageStr == "" {
		errors["age"] = "Age cannot be empty"
	} else {
		age, err := strconv.Atoi(ageStr)
		if err != nil {
			errors["age"] = "Age must be a number"
		} else if age < 13 {
			errors["age"] = "You must be at least 13"
		} else if age > 120 {
			errors["age"] = "Invalid age"
		}
	}

	if gender == "" {
		errors["gender"] = "Gender is required"
	}
	if firstname == "" {
		errors["firstname"] = "First name is required"
	}
	if lastname == "" {
		errors["lastname"] = "Last name is required"
	}

	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	if email == "" {
		errors["email"] = "Email is required"
	} else if !emailRegex.MatchString(email) {
		errors["email"] = "Invalid email format"
	}

	if password == "" {
		errors["password"] = "Password is required"
	} else if len(password) < 6 {
		errors["password"] = "Password must be at least 6 characters"
	}
	if confirmpassword == "" {
		errors["confirmPassword"] = "Please confirm your password"
	} else if confirmpassword != password {
		errors["confirmPassword"] = "Passwords do not match"
	}

	return errors
}