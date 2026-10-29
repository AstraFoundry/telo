// Package keywordfolder manages local keyword folders and projects them
// onto the chat list.
package keywordfolder

import (
	"context"
	"slices"
	"sync"

	domain "github.com/AstraFoundry/telo/backend/domain/keywordfolder"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// Searcher finds messages containing a term, across chats.
type Searcher interface {
	SearchGlobal(ctx context.Context, query string) (tg.GlobalSearchResult, error)
}

// Service is keyword folder CRUD plus membership.
type Service struct {
	store domain.Store
	mu    sync.Mutex
}

// New returns the service over a store.
func New(store domain.Store) *Service { return &Service{store: store} }

// List returns the folders in creation order.
func (s *Service) List(ctx context.Context) ([]domain.Folder, error) {
	return s.store.List(ctx)
}

// Create adds a folder with the next free id.
func (s *Service) Create(ctx context.Context, title, query string) (domain.Folder, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	folders, err := s.store.List(ctx)
	if err != nil {
		return domain.Folder{}, err
	}
	if len(folders) >= domain.Max {
		return domain.Folder{}, domain.ErrTooMany
	}
	f, err := domain.New(domain.NextID(folders), title, query)
	if err != nil {
		return domain.Folder{}, err
	}
	return f, s.store.Save(ctx, append(folders, f))
}

// Update renames a folder or changes its term.
func (s *Service) Update(ctx context.Context, id int, title, query string) (domain.Folder, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	folders, err := s.store.List(ctx)
	if err != nil {
		return domain.Folder{}, err
	}
	i := slices.IndexFunc(folders, func(f domain.Folder) bool { return f.ID == id })
	if i < 0 {
		return domain.Folder{}, tg.ErrNotFound
	}
	f, err := domain.New(id, title, query)
	if err != nil {
		return domain.Folder{}, err
	}
	folders[i] = f
	return f, s.store.Save(ctx, folders)
}

// Delete removes a folder.
func (s *Service) Delete(ctx context.Context, id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	folders, err := s.store.List(ctx)
	if err != nil {
		return err
	}
	return s.store.Save(ctx, slices.DeleteFunc(folders, func(f domain.Folder) bool { return f.ID == id }))
}

// Membership maps each folder to the chats whose messages mention its
// term, as Telegram's search finds them.
func (s *Service) Membership(ctx context.Context, search Searcher) (map[int][]tg.ChatID, error) {
	folders, err := s.store.List(ctx)
	if err != nil {
		return nil, err
	}
	out := map[int][]tg.ChatID{}
	for _, f := range folders {
		res, err := search.SearchGlobal(ctx, f.Query)
		if err != nil {
			return nil, err
		}
		for _, m := range res.Messages {
			if domain.Matches(m.Body, f.Query) && !slices.Contains(out[f.ID], m.ChatID) {
				out[f.ID] = append(out[f.ID], m.ChatID)
			}
		}
	}
	return out, nil
}

// Tabs returns the folders as chat-list tabs with their unread counts over
// chats.
func Tabs(folders []domain.Folder, members map[int][]tg.ChatID, chats []tg.Chat) []tg.Folder {
	out := make([]tg.Folder, 0, len(folders))
	for _, f := range folders {
		unread := 0
		for _, c := range chats {
			if slices.Contains(members[f.ID], c.ID) {
				unread += c.UnreadCount
			}
		}
		out = append(out, tg.Folder{ID: f.ID, Title: f.Title, Kind: tg.FolderKeyword, Query: f.Query, UnreadCount: unread})
	}
	return out
}
