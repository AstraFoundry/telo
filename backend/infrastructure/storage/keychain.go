package storage

import (
	"crypto/rand"
	"errors"
	"fmt"
	"sync"

	"github.com/egoist/mygo"
)

// Keychain keeps sealing keys in the OS credential store (the macOS
// Keychain, the Windows Credential Manager, the Secret Service on Linux),
// creating each on first use. Where the system has no credential store it
// fails: Telo never writes a secret in the clear instead.
type Keychain struct {
	mu    sync.Mutex
	cache map[string][]byte
}

// NewKeychain returns the system key source.
func NewKeychain() *Keychain { return &Keychain{cache: map[string][]byte{}} }

// ErrNoCredentialStore reports a system without a credential store.
var ErrNoCredentialStore = errors.New("storage: the system has no credential store for Telo's keys")

// Key returns the named key, generating and storing it the first time.
func (k *Keychain) Key(name string) ([]byte, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if key, ok := k.cache[name]; ok {
		return key, nil
	}
	account := "key:" + name
	key, err := mygo.Secrets.Get(account)
	switch {
	case errors.Is(err, mygo.ErrSecretNotFound):
		key = make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return nil, err
		}
		if err := mygo.Secrets.Set(account, key); err != nil {
			return nil, k.wrap(err)
		}
	case err != nil:
		return nil, k.wrap(err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("storage: stored key %s is %d bytes", name, len(key))
	}
	k.cache[name] = key
	return key, nil
}

func (k *Keychain) wrap(err error) error {
	if errors.Is(err, errors.ErrUnsupported) {
		return fmt.Errorf("%w: %v", ErrNoCredentialStore, err)
	}
	return err
}

// Delete removes a key, making the files it sealed unreadable.
func (k *Keychain) Delete(name string) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	delete(k.cache, name)
	if err := mygo.Secrets.Delete("key:" + name); err != nil && !errors.Is(err, mygo.ErrSecretNotFound) {
		return k.wrap(err)
	}
	return nil
}
