// Package tdlib runs TDLib through its JSON interface: libtdjson is loaded
// at runtime with purego, so the desktop builds without cgo. One receive
// loop serves every client of the process and routes answers by
// "@client_id" and "@extra".
package tdlib

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib/tdapi"
	"github.com/ebitengine/purego"
)

// LibraryName is libtdjson's file name on this platform.
func LibraryName() string {
	switch runtime.GOOS {
	case "darwin":
		return "libtdjson.dylib"
	case "windows":
		return "tdjson.dll"
	}
	return "libtdjson.so"
}

// PlatformDir names the staged native directory of this platform, as
// scripts/stage-tdlib.mjs writes it ("darwin-arm64", "linux-x64-glibc").
func PlatformDir() string {
	arch := map[string]string{"amd64": "x64", "arm64": "arm64"}[runtime.GOARCH]
	if runtime.GOOS == "linux" {
		return "linux-" + arch + "-glibc"
	}
	if runtime.GOOS == "windows" {
		return "win32-" + arch
	}
	return runtime.GOOS + "-" + arch
}

// ErrLibraryNotFound reports that no libtdjson was found where Telo stages it.
var ErrLibraryNotFound = errors.New("libtdjson not found")

// Locate returns the first existing libtdjson among the candidates: the
// TELO_TDJSON override, then each directory given (the app's resources,
// the repository's build/tdlib-native staging).
func Locate(dirs ...string) (string, error) {
	if p := os.Getenv("TELO_TDJSON"); p != "" {
		if _, err := os.Stat(p); err != nil {
			return "", fmt.Errorf("TELO_TDJSON=%s: %w", p, err)
		}
		return p, nil
	}
	for _, d := range dirs {
		for _, p := range []string{filepath.Join(d, PlatformDir(), LibraryName()), filepath.Join(d, LibraryName())} {
			if _, err := os.Stat(p); err == nil {
				return p, nil
			}
		}
	}
	return "", fmt.Errorf("%w in %q", ErrLibraryNotFound, dirs)
}

// Library is a loaded libtdjson.
type Library struct {
	createClientID func() int32
	send           func(int32, string)
	receive        func(float64) string
	execute        func(string) string

	mu      sync.Mutex
	clients map[int32]*Client
	loop    sync.Once
	extra   atomic.Uint64
}

var (
	loadOnce sync.Once
	loaded   *Library
	loadErr  error
)

// Load opens libtdjson at path once per process; later calls return the
// same library whatever path they pass.
func Load(path string) (*Library, error) {
	loadOnce.Do(func() {
		handle, err := openLibrary(path)
		if err != nil {
			loadErr = fmt.Errorf("load %s: %w", path, err)
			return
		}
		lib := &Library{clients: map[int32]*Client{}}
		purego.RegisterLibFunc(&lib.createClientID, handle, "td_create_client_id")
		purego.RegisterLibFunc(&lib.send, handle, "td_send")
		purego.RegisterLibFunc(&lib.receive, handle, "td_receive")
		purego.RegisterLibFunc(&lib.execute, handle, "td_execute")
		// TDLib's own log goes to stderr at verbosity 1 (errors) unless
		// the developer raises it.
		level := 1
		if v, err := strconv.Atoi(os.Getenv("TELO_TDLIB_VERBOSITY")); err == nil {
			level = v
		}
		lib.execute(fmt.Sprintf(`{"@type":"setLogVerbosityLevel","new_verbosity_level":%d}`, level))
		loaded = lib
	})
	return loaded, loadErr
}

// Execute runs a synchronous TDLib function (getTextEntities,
// parseMarkdown and the other functions TDLib documents as executable).
func (l *Library) Execute(request tdapi.Object) (json.RawMessage, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	raw := json.RawMessage(l.execute(string(body)))
	return raw, answerError(raw)
}

// NewClient creates a TDLib client instance; its updates arrive on
// Updates until Close.
func (l *Library) NewClient() *Client {
	c := &Client{lib: l, pending: map[string]chan json.RawMessage{}, updates: make(chan tdapi.Object, 1024)}
	l.mu.Lock()
	c.id = l.createClientID()
	l.clients[c.id] = c
	l.mu.Unlock()
	l.loop.Do(func() { go l.receiveLoop() })
	// A client starts receiving updates once it is sent its first request.
	c.send(`{"@type":"getOption","name":"version"}`)
	return c
}

func (l *Library) receiveLoop() {
	for {
		raw := l.receive(1)
		if raw == "" {
			continue
		}
		var head struct {
			ClientID int32  `json:"@client_id"`
			Extra    string `json:"@extra"`
			Type     string `json:"@type"`
		}
		if err := json.Unmarshal([]byte(raw), &head); err != nil {
			continue
		}
		l.mu.Lock()
		c := l.clients[head.ClientID]
		l.mu.Unlock()
		if c == nil {
			continue
		}
		c.dispatch(head.Extra, head.Type, json.RawMessage(raw))
	}
}

// Client is one TDLib instance, one Telegram account.
type Client struct {
	lib *Library
	id  int32

	mu      sync.Mutex
	pending map[string]chan json.RawMessage
	updates chan tdapi.Object
	closed  bool
}

var _ tdapi.Transport = (*Client)(nil)

// Updates delivers the client's updates in order. It is closed after
// authorizationStateClosed.
func (c *Client) Updates() <-chan tdapi.Object { return c.updates }

func (c *Client) send(body string) { c.lib.send(c.id, body) }

// Call sends request and waits for its answer or ctx.
func (c *Client) Call(ctx context.Context, request tdapi.Object) (json.RawMessage, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	extra := strconv.FormatUint(c.lib.extra.Add(1), 36)
	answer := make(chan json.RawMessage, 1)
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, ErrClosed
	}
	c.pending[extra] = answer
	c.mu.Unlock()
	// "@extra" rides at the top level of the request; TDLib echoes it.
	tagged := append([]byte(`{"@extra":`+strconv.Quote(extra)+`,`), body[1:]...)
	c.send(string(tagged))
	select {
	case raw := <-answer:
		return raw, answerError(raw)
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, extra)
		c.mu.Unlock()
		return nil, ctx.Err()
	}
}

// ErrClosed reports a call on a closed client.
var ErrClosed = errors.New("tdlib client is closed")

func (c *Client) dispatch(extra, tdType string, raw json.RawMessage) {
	if extra != "" {
		c.mu.Lock()
		answer := c.pending[extra]
		delete(c.pending, extra)
		c.mu.Unlock()
		if answer != nil {
			answer <- raw
		}
		return
	}
	obj, err := tdapi.Decode(raw)
	if err != nil {
		obj = &tdapi.Unknown{Type: tdType, Raw: raw}
	}
	closing := false
	if u, ok := obj.(*tdapi.UpdateAuthorizationState); ok {
		_, closing = u.AuthorizationState.(*tdapi.AuthorizationStateClosed)
	}
	c.mu.Lock()
	if !c.closed {
		c.updates <- obj
	}
	if closing && !c.closed {
		c.closed = true
		close(c.updates)
		for k, ch := range c.pending {
			close(ch)
			delete(c.pending, k)
		}
		c.lib.mu.Lock()
		delete(c.lib.clients, c.id)
		c.lib.mu.Unlock()
	}
	c.mu.Unlock()
}

func answerError(raw json.RawMessage) error {
	if raw == nil {
		return ErrClosed
	}
	var head struct {
		Type    string `json:"@type"`
		Code    int32  `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if head.Type == "error" {
		return &tdapi.Error{Code: head.Code, Message: head.Message}
	}
	return nil
}
