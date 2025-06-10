package db

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"real/models"

	_ "github.com/mattn/go-sqlite3"
)

var DB *sql.DB

func Init(dbPath string) error {
	var err error
	DB, err = sql.Open("sqlite3", dbPath)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %v", err)
	}
	

	if err = createTables(); err != nil {
		return fmt.Errorf("failed to create tables: %v", err)
	}

	if err = createCategories(); err != nil {
		return fmt.Errorf("failed to create categories: %v", err)
	}
	
	// Start session cleanup scheduler
	go ScheduleSessionCleanup(1*time.Hour, CleanupExpiredSessions)

	return nil
}

func createTables() error {
	sqlFile, err := os.Open("db/schema.sql")
	if err != nil {
		return fmt.Errorf("failed to open schema file: %v", err)
	}
	defer sqlFile.Close()

	sqlBytes, err := io.ReadAll(sqlFile)
	if err != nil {
		return fmt.Errorf("failed to read schema file: %v", err)
	}

	if _, err := DB.Exec(string(sqlBytes)); err != nil {
		return fmt.Errorf("failed to execute schema: %v", err)
	}

	return nil
}

func createCategories() error {
	categories := []struct {
		Name, Description string
	}{
		{"Technology", "Posts related to the latest technology and trends"},
		{"Health", "Discussions about health, fitness, and well-being"},
		{"Education", "Topics about learning and education"},
		{"Entertainment", "Movies, music, games, and all things fun"},
		{"Lifestyle", "Fashion, home decor, and daily living tips"},
		{"Travel", "Exploring the world, sharing travel experiences"},
	}

	for _, c := range categories {
		_, err := DB.Exec(`INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)`, c.Name, c.Description)
		if err != nil {
			return fmt.Errorf("error inserting category '%s': '%v'", c.Name, err)
		}
	}
	return nil
}

func CleanupExpiredSessions() error {
	query := `DELETE FROM sessions WHERE expires_at < ?`
	_, err := DB.Exec(query, time.Now())
	return err
}

func ScheduleSessionCleanup(interval time.Duration, cleanupFunc func() error) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		if err := cleanupFunc(); err != nil {
			log.Printf("error: session cleanup failed: %v", err)
		}
	}
}

func GetUser(userID int) ([]string, error) {
	var username, bio, profilePicture string
	qry := `SELECT username, COALESCE(bio, ""), COALESCE(profile_picture, "") 
            FROM users WHERE user_id = ?`
	err := DB.QueryRow(qry, userID).Scan(&username, &bio, &profilePicture)
	if err != nil {
		return nil, err
	}
	return []string{username, bio, profilePicture}, nil
}

func GetAllCategories() ([]models.Category, error) {
	rows, err := DB.Query("SELECT category_id, name FROM categories")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var categories []models.Category
	for rows.Next() {
		var c models.Category
		if err := rows.Scan(&c.CategoryID, &c.Name); err != nil {
			return nil, err
		}
		categories = append(categories, c)
	}

	return categories, nil
}
