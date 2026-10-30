package live

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/storage"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib"
)

// Keys holds each account's database key in the system credential store.
type Keys interface {
	Key(name string) ([]byte, error)
	Delete(name string) error
}

// AccountsOptions is how Accounts opens accounts.
type AccountsOptions struct {
	Library *tdlib.Library
	// Directory holds accounts.json and one directory per account.
	Directory string
	Keys      Keys
	// Template carries the API credentials and the device description;
	// Directory and DatabaseKey are filled per account.
	Template Config
	Now      func() time.Time
}

// Accounts runs sign-in and the switcher as tdesktop does: every account
// keeps its own TDLib database, exactly one is connected (the active one,
// or the one signing in), and only its events reach the app.
type Accounts struct {
	opts     AccountsOptions
	registry storage.JSON[registryFile]

	mu sync.Mutex
	// reg is the registry; Active names the connected account.
	reg tg.AccountRegistry
	// active is the active account's session; adding is a session signing
	// in as a new account, which takes the foreground until it is done.
	active, adding     *Session
	activeID, addingID tg.AccountID
	unsubs             map[*Session]func()

	subsMu sync.Mutex
	subs   map[int]func(tg.Event)
	nextID int
}

type registryFile struct {
	Accounts []tg.AccountRecord `json:"accounts"`
	Active   tg.AccountID       `json:"active"`
}

// NewAccounts prepares the switcher; Restore connects the active account.
func NewAccounts(opts AccountsOptions) *Accounts {
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &Accounts{opts: opts, registry: storage.JSON[registryFile]{Path: filepath.Join(opts.Directory, "accounts.json")},
		unsubs: map[*Session]func(){}, subs: map[int]func(tg.Event){}}
}

func (a *Accounts) configured() bool {
	return a.opts.Template.APIID != 0 && a.opts.Template.APIHash != ""
}

func (a *Accounts) Subscribe(f func(tg.Event)) func() {
	a.subsMu.Lock()
	id := a.nextID
	a.nextID++
	a.subs[id] = f
	a.subsMu.Unlock()
	return func() {
		a.subsMu.Lock()
		delete(a.subs, id)
		a.subsMu.Unlock()
	}
}

func (a *Accounts) emit(e tg.Event) {
	a.subsMu.Lock()
	fs := make([]func(tg.Event), 0, len(a.subs))
	for _, f := range a.subs {
		fs = append(fs, f)
	}
	a.subsMu.Unlock()
	for _, f := range fs {
		f(e)
	}
}

// foreground is the session whose sign-in and events the app follows.
func (a *Accounts) foreground() *Session {
	if a.adding != nil {
		return a.adding
	}
	return a.active
}

func (a *Accounts) dir(id tg.AccountID) string { return filepath.Join(a.opts.Directory, string(id)) }

func keyName(id tg.AccountID) string { return "tdlib:" + string(id) }

// open starts an account's session and follows its events.
func (a *Accounts) open(id tg.AccountID) (*Session, error) {
	key, err := a.opts.Keys.Key(keyName(id))
	if err != nil {
		return nil, err
	}
	cfg := a.opts.Template
	cfg.Directory, cfg.DatabaseKey = a.dir(id), key
	if err := os.MkdirAll(cfg.Directory, 0o700); err != nil {
		return nil, err
	}
	s := Open(a.opts.Library, cfg)
	unsub := s.Subscribe(func(e tg.Event) { a.relay(s, e) })
	a.mu.Lock()
	a.unsubs[s] = unsub
	a.mu.Unlock()
	return s, nil
}

// relay forwards the foreground session's events and settles sign-in.
func (a *Accounts) relay(s *Session, e tg.Event) {
	a.mu.Lock()
	fg := a.foreground() == s
	finished := s == a.adding
	a.mu.Unlock()
	if !fg {
		return
	}
	if auth, ok := e.(tg.AuthChanged); ok && auth.State.Step == tg.AuthReady && finished {
		go a.adopt(s)
		return
	}
	if _, ok := e.(tg.CurrentUserChanged); ok {
		a.remember(s)
	}
	a.emit(e)
}

// park closes a session that is no longer in the foreground.
func (a *Accounts) park(s *Session) {
	if s == nil {
		return
	}
	a.mu.Lock()
	unsub := a.unsubs[s]
	delete(a.unsubs, s)
	a.mu.Unlock()
	if unsub != nil {
		unsub()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = s.Close(ctx)
}

func (a *Accounts) save() error {
	a.mu.Lock()
	f := registryFile{Accounts: slices.Clone(a.reg.Accounts), Active: a.reg.Active}
	a.mu.Unlock()
	return a.registry.Save(f)
}

func (a *Accounts) Restore(ctx context.Context) error {
	var f registryFile
	if _, err := a.registry.Load(&f); err != nil {
		return err
	}
	a.mu.Lock()
	a.reg = tg.AccountRegistry{Accounts: f.Accounts, Active: f.Active}
	if a.reg.Active == "" && len(a.reg.Accounts) > 0 {
		a.reg.Active = a.reg.Accounts[0].ID
	}
	id := a.reg.Active
	a.mu.Unlock()
	if id == "" || !a.configured() {
		a.emit(tg.AuthChanged{State: a.Auth()})
		return nil
	}
	s, err := a.open(id)
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.active, a.activeID = s, id
	a.mu.Unlock()
	a.emit(tg.AuthChanged{State: a.Auth()})
	return nil
}

func (a *Accounts) Auth() tg.AuthState {
	if !a.configured() {
		return tg.AuthState{Step: tg.AuthNotConfigured}
	}
	a.mu.Lock()
	fg := a.foreground()
	a.mu.Unlock()
	if fg == nil {
		return tg.AuthState{Step: tg.AuthIdle}
	}
	st := fg.Auth()
	if st.Step == tg.AuthStarting && fg == a.active {
		st.Step = tg.AuthRestoring
	}
	return st
}

func (a *Accounts) Registry() tg.AccountRegistry {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := tg.AccountRegistry{Accounts: slices.Clone(a.reg.Accounts), Active: a.reg.Active}
	for i := range out.Accounts {
		if out.Accounts[i].ID == a.activeID && a.active != nil {
			out.Accounts[i].UnreadCount = a.active.UnreadCount()
		}
	}
	return out
}

func (a *Accounts) Active() tg.Repository {
	a.mu.Lock()
	s := a.active
	adding := a.adding != nil
	a.mu.Unlock()
	if s == nil || adding || s.Auth().Step != tg.AuthReady {
		return nil
	}
	return s
}

func newAccountID() tg.AccountID {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return tg.AccountID(hex.EncodeToString(b))
}

func (a *Accounts) StartSignIn(ctx context.Context) error {
	if !a.configured() {
		return tg.ErrNotConfigured
	}
	a.mu.Lock()
	if a.adding != nil {
		a.mu.Unlock()
		return nil
	}
	// A session that lost its authorization signs back in as itself.
	if a.active != nil && a.active.Auth().Step != tg.AuthReady {
		a.mu.Unlock()
		return nil
	}
	full := len(a.reg.Accounts) >= tg.MaxAccounts
	a.mu.Unlock()
	if full {
		return tg.ErrAccountLimit
	}
	id := newAccountID()
	s, err := a.open(id)
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.adding, a.addingID = s, id
	a.mu.Unlock()
	a.emit(tg.AuthChanged{State: a.Auth()})
	return nil
}

func (a *Accounts) CancelSignIn(ctx context.Context) error {
	a.mu.Lock()
	s, id := a.adding, a.addingID
	a.adding, a.addingID = nil, ""
	a.mu.Unlock()
	if s == nil {
		return nil
	}
	a.park(s)
	if err := a.discard(id); err != nil {
		return err
	}
	a.emit(tg.AuthChanged{State: a.Auth()})
	return nil
}

// discard deletes an account's database and key.
func (a *Accounts) discard(id tg.AccountID) error {
	if err := os.RemoveAll(a.dir(id)); err != nil {
		return err
	}
	return a.opts.Keys.Delete(keyName(id))
}

// adopt makes a finished sign-in the active account and parks the one
// before; signing in to an account already here returns to it instead.
func (a *Accounts) adopt(s *Session) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	user, err := s.CurrentUser(ctx)
	if err != nil {
		s.fail(err)
		return
	}
	a.mu.Lock()
	id := a.addingID
	existing := slices.IndexFunc(a.reg.Accounts, func(r tg.AccountRecord) bool { return r.UserID == user.ID })
	a.mu.Unlock()
	if existing >= 0 {
		a.mu.Lock()
		target := a.reg.Accounts[existing].ID
		a.adding, a.addingID = nil, ""
		a.mu.Unlock()
		a.park(s)
		_ = a.discard(id)
		if err := a.Switch(ctx, target); err != nil {
			a.emit(tg.SyncFailed{Err: err.Error()})
		}
		return
	}
	now := a.opts.Now()
	a.mu.Lock()
	prev := a.active
	a.reg.Accounts = append([]tg.AccountRecord{{ID: id, UserID: user.ID, DisplayName: user.DisplayName, Username: user.Username,
		Avatar: user.Avatar, CreatedAt: now, LastActiveAt: now}}, a.reg.Accounts...)
	a.reg.Active = id
	a.active, a.activeID, a.adding, a.addingID = s, id, nil, ""
	a.mu.Unlock()
	if err := a.save(); err != nil {
		a.emit(tg.SyncFailed{Err: err.Error()})
	}
	a.park(prev)
	a.emit(tg.AccountsChanged{Registry: a.Registry()})
	a.emit(tg.AuthChanged{State: a.Auth()})
}

// remember refreshes the active account's record from its profile.
func (a *Accounts) remember(s *Session) {
	u := s.currentUser()
	a.mu.Lock()
	if s != a.active {
		a.mu.Unlock()
		return
	}
	changed := false
	for i := range a.reg.Accounts {
		r := &a.reg.Accounts[i]
		if r.ID == a.activeID && (r.DisplayName != u.DisplayName || r.Username != u.Username || r.Avatar.Path != u.Avatar.Path) {
			r.DisplayName, r.Username, r.Avatar, r.UserID = u.DisplayName, u.Username, u.Avatar, u.ID
			changed = true
		}
	}
	a.mu.Unlock()
	if changed {
		_ = a.save()
		a.emit(tg.AccountsChanged{Registry: a.Registry()})
	}
}

func (a *Accounts) step(f func(*Session) error) error {
	a.mu.Lock()
	fg := a.foreground()
	a.mu.Unlock()
	if fg == nil {
		return errors.New("live: no sign-in in progress")
	}
	return f(fg)
}

func (a *Accounts) SubmitPhone(ctx context.Context, phone string) error {
	return a.step(func(s *Session) error { return s.SubmitPhone(ctx, phone) })
}

func (a *Accounts) SubmitCode(ctx context.Context, code string) error {
	return a.step(func(s *Session) error { return s.SubmitCode(ctx, code) })
}

func (a *Accounts) SubmitPassword(ctx context.Context, password string) error {
	return a.step(func(s *Session) error { return s.SubmitPassword(ctx, password) })
}

func (a *Accounts) SubmitRegistration(ctx context.Context, first, last string) error {
	return a.step(func(s *Session) error { return s.SubmitRegistration(ctx, first, last) })
}

func (a *Accounts) RequestQR(ctx context.Context) error {
	return a.step(func(s *Session) error { return s.RequestQR(ctx) })
}

func (a *Accounts) ResendCode(ctx context.Context) error {
	return a.step(func(s *Session) error { return s.ResendCode(ctx) })
}

func (a *Accounts) Switch(ctx context.Context, id tg.AccountID) error {
	a.mu.Lock()
	known := slices.ContainsFunc(a.reg.Accounts, func(r tg.AccountRecord) bool { return r.ID == id })
	same := id == a.activeID && a.active != nil
	a.mu.Unlock()
	if !known {
		return tg.ErrNotFound
	}
	if same {
		return nil
	}
	if err := a.CancelSignIn(ctx); err != nil {
		return err
	}
	a.mu.Lock()
	prev := a.active
	a.active, a.activeID = nil, ""
	a.mu.Unlock()
	a.park(prev)
	s, err := a.open(id)
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.active, a.activeID, a.reg.Active = s, id, id
	for i := range a.reg.Accounts {
		if a.reg.Accounts[i].ID == id {
			a.reg.Accounts[i].LastActiveAt = a.opts.Now()
		}
	}
	a.mu.Unlock()
	if err := a.save(); err != nil {
		return err
	}
	a.emit(tg.AccountsChanged{Registry: a.Registry()})
	a.emit(tg.AuthChanged{State: a.Auth()})
	return nil
}

func (a *Accounts) Logout(ctx context.Context) error {
	a.mu.Lock()
	s, id := a.active, a.activeID
	a.mu.Unlock()
	if s == nil {
		return nil
	}
	if err := s.LogOut(ctx); err != nil {
		return err
	}
	a.mu.Lock()
	if unsub := a.unsubs[s]; unsub != nil {
		unsub()
		delete(a.unsubs, s)
	}
	a.active, a.activeID = nil, ""
	a.reg.Accounts = slices.DeleteFunc(a.reg.Accounts, func(r tg.AccountRecord) bool { return r.ID == id })
	a.reg.Active = ""
	var next tg.AccountID
	if len(a.reg.Accounts) > 0 {
		next = a.reg.Accounts[0].ID
	}
	a.mu.Unlock()
	if err := a.discard(id); err != nil {
		return err
	}
	if err := a.save(); err != nil {
		return err
	}
	if next != "" {
		a.mu.Lock()
		a.reg.Active = next
		a.mu.Unlock()
		return a.Switch(ctx, next)
	}
	a.emit(tg.AccountsChanged{Registry: a.Registry()})
	a.emit(tg.AuthChanged{State: a.Auth()})
	return nil
}

func (a *Accounts) Close() error {
	a.mu.Lock()
	sessions := []*Session{a.active, a.adding}
	a.active, a.adding = nil, nil
	a.mu.Unlock()
	for _, s := range sessions {
		a.park(s)
	}
	return nil
}

var _ tg.Accounts = (*Accounts)(nil)
