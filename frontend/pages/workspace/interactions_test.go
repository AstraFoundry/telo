package workspace

import (
	"testing"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/telegram/demo"
	"github.com/AstraFoundry/telo/frontend/features/chatactions"
	"github.com/AstraFoundry/telo/frontend/features/compose"
	"github.com/AstraFoundry/telo/frontend/features/messageactions"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/testkit"
	"github.com/egoist/mygo/ui"
)

func (h *harness) settle(t *testing.T) {
	h.env.Settle(t, h.tt.Frame)
	h.tt.Advance(400e6)
	h.env.Settle(t, h.tt.Frame)
}

func (h *harness) choose(t *testing.T, label string) {
	t.Helper()
	if err := h.tt.Click(label); err != nil {
		t.Fatalf("%s: %v in %q", label, err, h.tt.Texts())
	}
	h.settle(t)
}

func titles[T any](items []T, title func(T) copy.Key) map[string]bool {
	out := map[string]bool{}
	for _, it := range items {
		out[copy.T(title(it))] = true
	}
	return out
}

func TestMessageContextMenu(t *testing.T) {
	h := open(t, preferences.ThemeLight)
	h.page.Open(Env{Store: h.store}, demo.DesignChat, 0)
	h.settle(t)
	if err := h.tt.RightClick("The retry flow needs a failed state in the transcript."); err != nil {
		t.Fatal(err)
	}
	h.tt.Frame()
	testkit.Snapshot(t, h.tt, "message-menu")
	for _, want := range []copy.Key{copy.Reply, copy.CopyText, copy.CopyLink, copy.Forward, copy.PinMessage, copy.SelectMessage, copy.DeleteMessage, copy.Translate} {
		if !h.tt.HasText(copy.T(want)) {
			t.Fatalf("menu lacks %q: %q", copy.T(want), h.tt.Texts())
		}
	}
	h.choose(t, copy.T(copy.Reply))
	if h.store.Composer(demo.DesignChat).ReplyTo != 14 {
		t.Fatalf("reply target %d", h.store.Composer(demo.DesignChat).ReplyTo)
	}
	if !messageactionsCovers(t, "message-action:messageContextReply1") {
		t.Fatal("the registry names the reply item")
	}
}

func messageactionsCovers(t *testing.T, upstream string) bool {
	for _, it := range messageactions.Items {
		if it.Upstream == upstream {
			return true
		}
	}
	return false
}

func TestChatListContextMenu(t *testing.T) {
	h := open(t, preferences.ThemeLight)
	if err := h.tt.RightClick("Telo Bot"); err != nil {
		t.Fatal(err)
	}
	h.tt.Frame()
	testkit.Snapshot(t, h.tt, "chat-menu")
	shown := titles(chatactions.Items, func(i chatactions.Item) copy.Key { return i.Title })
	for _, want := range []copy.Key{copy.PinChat, copy.MuteChat, copy.ArchiveChat, copy.ClearHistory, copy.DeleteChat} {
		if !h.tt.HasText(copy.T(want)) {
			t.Fatalf("menu lacks %q: %q", copy.T(want), h.tt.Texts())
		}
	}
	_ = shown
	h.choose(t, copy.T(copy.ArchiveChat))
	if c, _ := h.store.Chat(demo.BotChat); c.FolderID != tg.ArchiveFolderID {
		t.Fatalf("archived %+v", c.FolderID)
	}
}

func TestComposerFormattingAndAttach(t *testing.T) {
	h := open(t, preferences.ThemeLight)
	h.page.Open(Env{Store: h.store}, demo.SavedChat, 0)
	h.settle(t)
	h.tt.Type("ship")
	h.tt.Key(ui.Cmd, ui.KeyA)
	h.tt.Key(ui.Cmd, ui.KeyB)
	h.tt.Frame()
	if got := h.store.Composer(demo.SavedChat).Text; got != "**ship**" {
		t.Fatalf("⌘B wraps the selection: %q", got)
	}
	h.tt.Key(0, ui.KeyEnter)
	h.settle(t)
	ms := h.store.Transcript(demo.SavedChat).Messages
	last := ms[len(ms)-1]
	if last.Body != "ship" || len(last.Entities) != 1 || last.Entities[0].Type != tg.EntityBold {
		t.Fatalf("sent %+v", last)
	}
	h.tt.Key(0, ui.KeyUp)
	h.settle(t)
	if h.store.Composer(demo.SavedChat).Editing != last.ID {
		t.Fatal("↑ in an empty composer edits the last message")
	}
	h.tt.Key(0, ui.KeyEscape)
	h.settle(t)
	h.choose(t, copy.T(copy.Attach))
	for _, it := range compose.AttachItems {
		if !h.tt.HasText(copy.T(it.Title)) {
			t.Fatalf("attach menu lacks %q", copy.T(it.Title))
		}
	}
	testkit.Snapshot(t, h.tt, "attach-menu")
}

func TestKeyboardShortcuts(t *testing.T) {
	h := open(t, preferences.ThemeLight)
	h.page.Open(Env{Store: h.store}, demo.DesignChat, 0)
	h.settle(t)
	h.tt.Key(ui.Cmd, ui.KeyF)
	h.settle(t)
	if !h.tt.HasText(copy.T(copy.SearchInChat)) {
		t.Fatalf("⌘F searches the chat: %q", h.tt.Texts())
	}
	h.tt.Key(0, ui.KeyEscape)
	h.tt.Key(ui.Cmd, ui.KeyK)
	h.settle(t)
	if !h.page.Search.Handle.Focused(nil) && !h.tt.Focused(copy.T(copy.SearchChats)) {
		t.Fatal("⌘K focuses the search")
	}
	h.tt.Key(0, ui.KeyEscape)
	h.page.Conversation.Composer.Focus()
	h.settle(t)
	h.tt.Key(ui.Alt, ui.KeyDown)
	h.settle(t)
	if h.store.Selected == demo.DesignChat {
		t.Fatal("⌥↓ opens the next chat")
	}
	h.page.Open(Env{Store: h.store}, demo.DesignChat, 0)
	h.settle(t)
	h.tt.Key(ui.Cmd, ui.KeyUp)
	h.settle(t)
	if h.store.Composer(demo.DesignChat).ReplyTo == 0 {
		t.Fatal("⌘↑ picks a message to reply to")
	}
}
