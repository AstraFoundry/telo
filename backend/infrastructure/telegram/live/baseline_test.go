package live

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/storage"
)

// TestLiveBaseline drives docs/telegram/baseline.md against a real
// account: it runs only with TELO_LIVE_E2E=1, on the "telegram" directory
// of a profile `make dev` signed in (TELO_LIVE_DIR), with that build's
// credentials (TELO_TELEGRAM_API_ID, TELO_TELEGRAM_API_HASH).
func TestLiveBaseline(t *testing.T) {
	if os.Getenv("TELO_LIVE_E2E") != "1" {
		t.Skip("set TELO_LIVE_E2E=1, TELO_LIVE_DIR and the API credentials")
	}
	id, err := strconv.Atoi(os.Getenv("TELO_TELEGRAM_API_ID"))
	if err != nil {
		t.Fatal("TELO_TELEGRAM_API_ID:", err)
	}
	a := NewAccounts(AccountsOptions{Library: stagedLibrary(t), Directory: os.Getenv("TELO_LIVE_DIR"), Keys: storage.NewKeychain(),
		Template: Config{APIID: int32(id), APIHash: os.Getenv("TELO_TELEGRAM_API_HASH"), Language: "en", Device: "Telo baseline", System: "test", Version: "baseline"}})
	t.Cleanup(func() { _ = a.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if err := a.Restore(ctx); err != nil {
		t.Fatal(err)
	}
	for a.Active() == nil {
		select {
		case <-ctx.Done():
			t.Fatalf("the account did not restore: %s", a.Auth().Step)
		case <-time.After(200 * time.Millisecond):
		}
	}
	repo := a.Active()
	step := func(name string, f func() error) {
		if err := f(); err != nil {
			t.Errorf("FAIL %s: %v", name, err)
			return
		}
		t.Logf("PASS %s", name)
	}
	var saved tg.Chat
	step("chat list loads", func() error {
		page, err := repo.ChatPage(ctx, "", 50)
		if err == nil && len(page.Items) == 0 {
			t.Log("the account has no chats")
		}
		return err
	})
	step("Saved Messages opens", func() (err error) { saved, err = repo.OpenSavedMessages(ctx); return err })
	var sent tg.Message
	step("send", func() (err error) {
		sent, err = repo.SendMessage(ctx, saved.ID, "Telo baseline "+time.Now().Format(time.RFC3339), tg.SendOptions{})
		return err
	})
	// The server id replaces the temporary one asynchronously; read back.
	time.Sleep(3 * time.Second)
	step("history reads the message", func() error {
		page, err := repo.Messages(ctx, saved.ID, 0, 5)
		if err != nil {
			return err
		}
		for _, m := range page.Items {
			if m.Outgoing && m.Body == sent.Body {
				sent = m
				return nil
			}
		}
		return tg.ErrNotFound
	})
	step("edit", func() error { return repo.EditMessage(ctx, saved.ID, sent.ID, sent.Body+" (edited)", nil) })
	step("delete", func() error { return repo.DeleteMessages(ctx, saved.ID, []tg.MessageID{sent.ID}, tg.DeleteForEveryone) })
	step("sessions", func() error { _, err := repo.Sessions(ctx); return err })
}
