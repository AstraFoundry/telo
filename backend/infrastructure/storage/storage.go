// Package storage keeps Telo's local files in the user-data directory:
// plain JSON for preferences and history, and AES-256-GCM sealed JSON for
// anything carrying a secret, under a key the OS credential store holds.
// Writes go through a temporary file and a rename, so a crash leaves the
// previous file intact.
package storage

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

// WriteAtomic replaces path with data.
func WriteAtomic(path string, data []byte, perm fs.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Chmod(name, perm); err != nil {
		os.Remove(name)
		return err
	}
	return os.Rename(name, path)
}

// JSON is one JSON file holding a value of T.
type JSON[T any] struct {
	Path string
	mu   sync.Mutex
}

// Load reads the file into v; a missing file leaves v as given and
// reports found false.
func (f *JSON[T]) Load(v *T) (found bool, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	raw, err := os.ReadFile(f.Path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return false, fmt.Errorf("%s: %w", f.Path, err)
	}
	return true, nil
}

// Save writes v.
func (f *JSON[T]) Save(v T) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return WriteAtomic(f.Path, append(raw, '\n'), 0o600)
}

// KeySource returns the 32-byte key that seals a named file.
type KeySource interface {
	Key(name string) ([]byte, error)
}

// Sealed is one encrypted JSON file holding a value of T.
type Sealed[T any] struct {
	Path string
	Keys KeySource
	// KeyName names the key in the credential store.
	KeyName string
	mu      sync.Mutex
}

var sealedMagic = []byte("TELO1")

// ErrTampered reports a sealed file that does not decrypt.
var ErrTampered = errors.New("storage: sealed file does not decrypt")

func (f *Sealed[T]) aead() (cipher.AEAD, error) {
	key, err := f.Keys.Key(f.KeyName)
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("storage: key %s is %d bytes, want 32", f.KeyName, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Load decrypts the file into v; a missing file reports found false.
func (f *Sealed[T]) Load(v *T) (found bool, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	raw, err := os.ReadFile(f.Path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	aead, err := f.aead()
	if err != nil {
		return false, err
	}
	n := len(sealedMagic) + aead.NonceSize()
	if len(raw) < n || !bytes.Equal(raw[:len(sealedMagic)], sealedMagic) {
		return false, fmt.Errorf("%s: %w", f.Path, ErrTampered)
	}
	plain, err := aead.Open(nil, raw[len(sealedMagic):n], raw[n:], []byte(f.KeyName))
	if err != nil {
		return false, fmt.Errorf("%s: %w", f.Path, ErrTampered)
	}
	if err := json.Unmarshal(plain, v); err != nil {
		return false, fmt.Errorf("%s: %w", f.Path, err)
	}
	return true, nil
}

// Save encrypts and writes v.
func (f *Sealed[T]) Save(v T) error {
	plain, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	aead, err := f.aead()
	if err != nil {
		return err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	out := append(append(append([]byte{}, sealedMagic...), nonce...), aead.Seal(nil, nonce, plain, []byte(f.KeyName))...)
	return WriteAtomic(f.Path, out, 0o600)
}

// Remove deletes the file.
func (f *Sealed[T]) Remove() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := os.Remove(f.Path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// AppendLine appends one JSON line to a log file.
func AppendLine(path string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(raw, '\n')); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
