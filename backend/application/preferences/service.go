// Package preferences is the use case of reading and changing settings.
package preferences

import (
	"context"
	"sync"

	domain "github.com/AstraFoundry/telo/backend/domain/preferences"
)

// Service holds the current settings and persists every change.
type Service struct {
	store domain.Store
	mu    sync.Mutex
	value domain.Preferences
	subs  map[int]func(domain.Preferences)
	next  int
}

// Load reads the stored settings, normalized; a missing file is the
// defaults. demo is the process's TELO_DEMO_WORKSPACE flag, written on
// every start so a leftover true never reopens the demo.
func Load(ctx context.Context, store domain.Store, demo bool) (*Service, error) {
	p, err := store.Get(ctx)
	if err != nil {
		return nil, err
	}
	p = p.Normalize()
	if p.DemoWorkspace != demo {
		p.DemoWorkspace = demo
		if err := store.Save(ctx, p); err != nil {
			return nil, err
		}
	}
	if demo && len(p.Templates) == 0 {
		p.Templates = domain.DemoTemplates
	}
	return &Service{store: store, value: p, subs: map[int]func(domain.Preferences){}}, nil
}

// Get returns the current settings.
func (s *Service) Get() domain.Preferences {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.value
}

// Update applies edit, normalizes, persists and notifies. A failed write
// keeps the stored value, so the UI resyncs to what is on disk.
func (s *Service) Update(ctx context.Context, edit func(*domain.Preferences)) (domain.Preferences, error) {
	s.mu.Lock()
	next := s.value
	edit(&next)
	next = next.Normalize()
	if err := s.store.Save(ctx, next); err != nil {
		current := s.value
		s.mu.Unlock()
		return current, err
	}
	s.value = next
	subs := make([]func(domain.Preferences), 0, len(s.subs))
	for _, f := range s.subs {
		subs = append(subs, f)
	}
	s.mu.Unlock()
	for _, f := range subs {
		f(next)
	}
	return next, nil
}

// Subscribe calls f after every change until unsubscribed.
func (s *Service) Subscribe(f func(domain.Preferences)) func() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.next++
	id := s.next
	s.subs[id] = f
	return func() {
		s.mu.Lock()
		delete(s.subs, id)
		s.mu.Unlock()
	}
}
