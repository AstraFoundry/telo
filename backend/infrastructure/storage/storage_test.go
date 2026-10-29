package storage

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type fixedKeys []byte

func (k fixedKeys) Key(string) ([]byte, error) { return k, nil }

type secret struct {
	Token string `json:"token"`
}

func TestSealedRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.enc")
	f := &Sealed[secret]{Path: path, Keys: fixedKeys(bytes.Repeat([]byte{7}, 32)), KeyName: "agent"}
	var v secret
	if found, err := f.Load(&v); found || err != nil {
		t.Fatal(found, err)
	}
	if err := f.Save(secret{Token: "sk-live"}); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	if bytes.Contains(raw, []byte("sk-live")) {
		t.Fatal("secret written in the clear")
	}
	if found, err := f.Load(&v); !found || err != nil || v.Token != "sk-live" {
		t.Fatal(found, err, v)
	}
	other := &Sealed[secret]{Path: path, Keys: fixedKeys(bytes.Repeat([]byte{8}, 32)), KeyName: "agent"}
	if _, err := other.Load(&v); !errors.Is(err, ErrTampered) {
		t.Fatalf("wrong key decrypted: %v", err)
	}
}

func TestJSONAtomic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "prefs.json")
	f := &JSON[map[string]int]{Path: path}
	if err := f.Save(map[string]int{"a": 1}); err != nil {
		t.Fatal(err)
	}
	v := map[string]int{}
	if found, err := f.Load(&v); !found || err != nil || v["a"] != 1 {
		t.Fatal(found, err, v)
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Fatalf("temporary files left: %v", entries)
	}
	if err := AppendLine(filepath.Join(filepath.Dir(path), "log.jsonl"), v); err != nil {
		t.Fatal(err)
	}
}
