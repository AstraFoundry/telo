// Package media decodes the pictures views show — downloaded photos,
// avatars, sticker files and TDLib's minithumbnails — off the main thread
// and caches them as GPU bitmaps, evicting the least recently drawn.
package media

import (
	"crypto/sha256"
	"os"
	"sync"

	"github.com/egoist/mygo/ui"
)

// Images is a bitmap cache keyed by file path or by bytes.
type Images struct {
	mu      sync.Mutex
	entries map[string]*entry
	tick    uint64
	limit   int
	// wake asks for a frame once a decode finishes.
	wake func()
}

type entry struct {
	bitmap  *ui.Bitmap
	failed  bool
	loading bool
	used    uint64
}

// NewImages returns a cache holding up to limit bitmaps; wake runs, from
// any goroutine, when a bitmap becomes ready.
func NewImages(limit int, wake func()) *Images {
	return &Images{entries: map[string]*entry{}, limit: limit, wake: wake}
}

// File returns the decoded file at path, or nil while it decodes or when
// it cannot be decoded.
func (c *Images) File(path string) *ui.Bitmap {
	if path == "" {
		return nil
	}
	return c.get("f:"+path, func() ([]byte, error) { return os.ReadFile(path) })
}

// Bytes returns data decoded, as a minithumbnail; small data decodes in
// place, so a placeholder never flickers in.
func (c *Images) Bytes(data []byte) *ui.Bitmap {
	if len(data) == 0 {
		return nil
	}
	sum := sha256.Sum256(data)
	key := "b:" + string(sum[:8])
	c.mu.Lock()
	e, ok := c.entries[key]
	if !ok {
		e = &entry{}
		if b, err := ui.DecodeBitmap(data); err == nil {
			e.bitmap = b
		} else {
			e.failed = true
		}
		c.entries[key] = e
	}
	c.tick++
	e.used = c.tick
	c.mu.Unlock()
	return e.bitmap
}

// Failed tells whether path could not be decoded.
func (c *Images) Failed(path string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries["f:"+path]
	return ok && e.failed
}

func (c *Images) get(key string, read func() ([]byte, error)) *ui.Bitmap {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tick++
	if e, ok := c.entries[key]; ok {
		e.used = c.tick
		return e.bitmap
	}
	e := &entry{loading: true, used: c.tick}
	c.entries[key] = e
	c.evict()
	go func() {
		data, err := read()
		var b *ui.Bitmap
		if err == nil {
			b, err = ui.DecodeBitmap(data)
		}
		c.mu.Lock()
		e.loading = false
		if err != nil {
			e.failed = true
		} else {
			e.bitmap = b
		}
		c.mu.Unlock()
		if c.wake != nil {
			c.wake()
		}
	}()
	return nil
}

// Pending tells whether a decode is running, for tests to settle on.
func (c *Images) Pending() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, e := range c.entries {
		if e.loading {
			return true
		}
	}
	return false
}

// evict drops the least recently used bitmaps over the limit.
func (c *Images) evict() {
	for len(c.entries) > c.limit {
		var oldest string
		var at uint64 = ^uint64(0)
		for k, e := range c.entries {
			if !e.loading && e.used < at {
				oldest, at = k, e.used
			}
		}
		if oldest == "" {
			return
		}
		delete(c.entries, oldest)
	}
}
