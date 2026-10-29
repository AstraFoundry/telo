// Package testkit builds a runtime over the demo workspace for the views'
// and stores' tests: the same repository `make dev DEMO=1` opens, a fixed
// clock, in-memory settings and a desktop that records what it was asked.
package testkit

import (
	"bytes"
	"image/png"
	"os"
	"path/filepath"

	"context"
	"github.com/egoist/mygo/ui"
	"sync"
	"testing"
	"time"

	kfapp "github.com/AstraFoundry/telo/backend/application/keywordfolder"
	prefapp "github.com/AstraFoundry/telo/backend/application/preferences"
	apptg "github.com/AstraFoundry/telo/backend/application/telegram"
	"github.com/AstraFoundry/telo/backend/domain/keywordfolder"
	"github.com/AstraFoundry/telo/backend/domain/preferences"
	"github.com/AstraFoundry/telo/backend/infrastructure/telegram/demo"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
)

// Desktop records the requests views make of the OS.
type Desktop struct {
	mu            sync.Mutex
	Opened        []string
	Notifications []apptg.Notification
	Badge         int
	Clipboard     string
	// Files is what PickFiles answers.
	Files []string
	// Save is what SavePath answers.
	Save    string
	Copies  [][2]string
	Focus   bool
	Reveals []string
}

func (d *Desktop) OpenURL(u string) error {
	d.mu.Lock()
	d.Opened = append(d.Opened, u)
	d.mu.Unlock()
	return nil
}
func (d *Desktop) Notify(n apptg.Notification) {
	d.mu.Lock()
	d.Notifications = append(d.Notifications, n)
	d.mu.Unlock()
}
func (d *Desktop) SetBadge(n int)                        { d.mu.Lock(); d.Badge = n; d.mu.Unlock() }
func (d *Desktop) WriteClipboard(s string)               { d.mu.Lock(); d.Clipboard = s; d.mu.Unlock() }
func (d *Desktop) PickFiles(string, bool, bool) []string { return d.Files }
func (d *Desktop) SavePath(string) string                { return d.Save }
func (d *Desktop) CopyFile(from, to string) error {
	d.mu.Lock()
	d.Copies = append(d.Copies, [2]string{from, to})
	d.mu.Unlock()
	return nil
}
func (d *Desktop) RevealFile(p string)     { d.mu.Lock(); d.Reveals = append(d.Reveals, p); d.mu.Unlock() }
func (d *Desktop) OpenFile(p string) error { return d.OpenURL("file://" + p) }
func (d *Desktop) Focused() bool           { return d.Focus }

type prefStore struct {
	mu sync.Mutex
	p  preferences.Preferences
}

func (s *prefStore) Get(context.Context) (preferences.Preferences, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.p, nil
}
func (s *prefStore) Save(_ context.Context, p preferences.Preferences) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.p = p
	return nil
}

type folderStore struct {
	mu sync.Mutex
	f  []keywordfolder.Folder
}

func (s *folderStore) List(context.Context) ([]keywordfolder.Folder, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]keywordfolder.Folder(nil), s.f...), nil
}
func (s *folderStore) Save(_ context.Context, f []keywordfolder.Folder) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.f = append([]keywordfolder.Folder(nil), f...)
	return nil
}

// Env is a runtime over a fresh demo workspace.
type Env struct {
	Runtime *runtime.Runtime
	Repo    *demo.Repository
	Desktop *Desktop
}

// New builds an environment; edit adjusts the initial preferences.
func New(t testing.TB, edit func(*preferences.Preferences)) *Env {
	t.Helper()
	repo := demo.New(demo.Options{CacheDir: t.TempDir(), Now: func() time.Time { return demo.Base }})
	t.Cleanup(repo.Close)
	p := preferences.Default()
	p.OnboardingDone = true
	if edit != nil {
		edit(&p)
	}
	prefs, err := prefapp.Load(context.Background(), &prefStore{p: p}, true)
	if err != nil {
		t.Fatal(err)
	}
	desk := &Desktop{}
	rt := &runtime.Runtime{
		Accounts: demo.NewAccounts(repo), Preferences: prefs, KeywordFolders: kfapp.New(&folderStore{}),
		Desktop: desk, Demo: true, Now: func() time.Time { return demo.Base },
		Info: runtime.Info{Version: "0.1.0", TDLib: "1.8.67", TelegramConfigured: true, Platform: "darwin"},
	}
	return &Env{Runtime: rt, Repo: repo, Desktop: desk}
}

// Settle drains background work until none is left, running frame between
// rounds (nil frame drains only).
func (e *Env) Settle(t testing.TB, frame func()) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		e.Runtime.Drain()
		if frame != nil {
			frame()
		}
		if !e.Runtime.Busy() {
			e.Runtime.Drain()
			if frame != nil {
				frame()
			}
			if !e.Runtime.Busy() {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("background work did not settle")
		}
		time.Sleep(time.Millisecond)
	}
}

// Snapshot saves the tester's last frame as name.png when TELO_UI_SNAPSHOTS
// names a directory, for visual review.
func Snapshot(t testing.TB, tt *ui.Tester, name string) {
	t.Helper()
	dir := os.Getenv("TELO_UI_SNAPSHOTS")
	if dir == "" {
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	if err := png.Encode(&b, tt.Image()); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name+".png"), b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}
