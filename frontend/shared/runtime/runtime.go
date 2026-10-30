// Package runtime is the UI's boundary to the application layer: the
// services the composition root hands the views, the desktop adapter, and
// the queue that brings background results onto the main thread.
//
// Views run on the main thread. Work that touches Telegram, files or the
// network runs in Go, which posts its result back with Post; the root view
// drains posts at the start of each frame, so state only changes where the
// view reads it.
package runtime

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	agentapp "github.com/AstraFoundry/telo/backend/application/agent"
	"github.com/AstraFoundry/telo/backend/application/keywordfolder"
	"github.com/AstraFoundry/telo/backend/application/preferences"
	apptg "github.com/AstraFoundry/telo/backend/application/telegram"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// Desktop is what the views ask of the operating system.
type Desktop interface {
	OpenURL(url string) error
	Notify(n apptg.Notification)
	SetBadge(count int)
	WriteClipboard(text string)
	// PickFiles asks for files to open; nil when cancelled.
	PickFiles(title string, multiple bool, images bool) []string
	// SavePath asks where to save a file named name; "" when cancelled.
	SavePath(name string) string
	// CopyFile copies a downloaded file to a chosen path.
	CopyFile(from, to string) error
	RevealFile(path string)
	OpenFile(path string) error
	// Focused tells whether a Telo window has the keyboard.
	Focused() bool
}

// Info describes the build.
type Info struct {
	Version string
	TDLib   string
	// TelegramConfigured tells whether the build carries Telegram API
	// credentials.
	TelegramConfigured bool
	Platform           string
}

// Runtime is everything a view may reach.
type Runtime struct {
	Accounts       tg.Accounts
	Preferences    *preferences.Service
	KeywordFolders *keywordfolder.Service
	Agent          *agentapp.Service
	Desktop        Desktop
	Info           Info
	Demo           bool
	// Now is the clock views and stores read; tests fix it.
	Now func() time.Time

	// Wake asks the window for a frame, from any goroutine.
	Wake func()

	mu       sync.Mutex
	posted   []func()
	inFlight atomic.Int64
}

// Post runs f on the main thread at the start of the next frame.
func (r *Runtime) Post(f func()) {
	r.mu.Lock()
	r.posted = append(r.posted, f)
	r.mu.Unlock()
	if r.Wake != nil {
		r.Wake()
	}
}

// Drain runs the posted functions; the root view calls it first thing.
func (r *Runtime) Drain() {
	for {
		r.mu.Lock()
		batch := r.posted
		r.posted = nil
		r.mu.Unlock()
		if len(batch) == 0 {
			return
		}
		for _, f := range batch {
			f()
		}
	}
}

// Go runs work off the main thread and posts the function it returns.
func (r *Runtime) Go(work func(ctx context.Context) func()) {
	r.inFlight.Add(1)
	go func() {
		defer r.inFlight.Add(-1)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if apply := work(ctx); apply != nil {
			r.Post(apply)
		}
	}()
}

// Busy tells whether work is running or results wait to be applied, for
// tests to settle on.
func (r *Runtime) Busy() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.inFlight.Load() > 0 || len(r.posted) > 0
}

// Clock returns the current time.
func (r *Runtime) Clock() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

// Repo is the active account's repository, nil before sign-in.
func (r *Runtime) Repo() tg.Repository {
	if r.Accounts == nil {
		return nil
	}
	return r.Accounts.Active()
}
