// Package keywordfolder holds local keyword folders: chat-list tabs that
// collect the chats whose messages mention a term. They never reach
// Telegram; their ids are negative so they never collide with Telegram's.
package keywordfolder

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Limits of keyword folders.
const (
	Max      = 20
	TitleMax = 80
	QueryMax = 200
)

// Folder is one keyword folder.
type Folder struct {
	ID    int    `json:"id"`
	Title string `json:"title"`
	Query string `json:"query"`
}

// Errors of an invalid folder.
var (
	ErrID            = errors.New("keyword folder: id must be negative")
	ErrTitleRequired = errors.New("keyword folder: title is required")
	ErrQueryRequired = errors.New("keyword folder: query is required")
	ErrTooMany       = fmt.Errorf("keyword folder: at most %d folders", Max)
)

// New validates and trims a folder.
func New(id int, title, query string) (Folder, error) {
	title, query = strings.TrimSpace(title), strings.TrimSpace(query)
	switch {
	case id >= 0:
		return Folder{}, ErrID
	case title == "":
		return Folder{}, ErrTitleRequired
	case query == "":
		return Folder{}, ErrQueryRequired
	case utf8.RuneCountInString(title) > TitleMax:
		return Folder{}, fmt.Errorf("keyword folder: title must be at most %d characters", TitleMax)
	case utf8.RuneCountInString(query) > QueryMax:
		return Folder{}, fmt.Errorf("keyword folder: query must be at most %d characters", QueryMax)
	}
	return Folder{ID: id, Title: title, Query: query}, nil
}

// NextID is the id a new folder takes: one below the lowest.
func NextID(folders []Folder) int {
	next := -1
	for _, f := range folders {
		if f.ID <= next {
			next = f.ID - 1
		}
	}
	return next
}

// Matches tells whether body mentions the folder's term, ignoring case.
func Matches(body, query string) bool {
	term := strings.ToLower(strings.TrimSpace(query))
	return term != "" && strings.Contains(strings.ToLower(body), term)
}

// Store persists keyword folders in creation order.
type Store interface {
	List(ctx context.Context) ([]Folder, error)
	Save(ctx context.Context, folders []Folder) error
}
