package chat

import (
	"testing"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/telegram/demo"
	"github.com/AstraFoundry/telo/frontend/shared/testkit"
)

func started(t *testing.T) (*Store, *testkit.Env) {
	env := testkit.New(t, nil)
	s := New(env.Runtime)
	s.Start()
	env.Settle(t, nil)
	return s, env
}

func TestStartLoadsListFoldersAndUser(t *testing.T) {
	s, _ := started(t)
	all := s.Visible()
	if len(all) != 7 || all[0].ID != demo.SavedChat || all[1].ID != demo.DesignChat {
		t.Fatalf("%d chats, first %v", len(all), all[0].ID)
	}
	if len(s.Folders) != 1 || s.Folders[0].Title != "Work" || s.User.DisplayName != "Ada Park" {
		t.Fatalf("folders %v user %q", s.Folders, s.User.DisplayName)
	}
	if !s.HasArchive() || len(s.InTab(TabArchive)) != 1 {
		t.Fatal("archive")
	}
	if work := s.InTab(2); len(work) != 2 {
		t.Fatalf("work folder %d", len(work))
	}
}

func TestSelectLoadsTranscriptAndPins(t *testing.T) {
	s, env := started(t)
	s.Select(demo.DesignChat)
	env.Settle(t, nil)
	tr := s.Transcript(demo.DesignChat)
	if !tr.Loaded || len(tr.Messages) != 16 || tr.Messages[0].ID != 1 || len(tr.Pinned) != 2 {
		t.Fatalf("loaded %v, %d messages, %d pinned", tr.Loaded, len(tr.Messages), len(tr.Pinned))
	}
	if len(tr.Scheduled) != 1 {
		t.Fatal("scheduled")
	}
}

func TestOptimisticSendReconciles(t *testing.T) {
	s, env := started(t)
	s.Select(demo.MinaChat)
	env.Settle(t, nil)
	s.Send(demo.MinaChat, "  hello  ", tg.SendOptions{})
	tr := s.Transcript(demo.MinaChat)
	last := tr.Messages[len(tr.Messages)-1]
	if last.Status != tg.StatusSending || last.ID >= 0 || last.Body != "hello" {
		t.Fatalf("%+v", last)
	}
	env.Settle(t, nil)
	last = tr.Messages[len(tr.Messages)-1]
	if last.Status == tg.StatusSending || last.ID <= 0 {
		t.Fatalf("not reconciled: %+v", last)
	}
	count := 0
	for _, m := range tr.Messages {
		if m.Body == "hello" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("%d copies", count)
	}
}

func TestFailedSendKeepsDraftMessage(t *testing.T) {
	s, env := started(t)
	s.Select(demo.ProductChat)
	env.Settle(t, nil)
	s.Send(demo.ProductChat, "can't", tg.SendOptions{})
	env.Settle(t, nil)
	tr := s.Transcript(demo.ProductChat)
	if last := tr.Messages[len(tr.Messages)-1]; last.Status != tg.StatusFailed {
		t.Fatalf("%+v", last)
	}
	if n := s.TakeNotices(); len(n) != 1 || !n[0].Error {
		t.Fatal(n)
	}
}

func TestChatActions(t *testing.T) {
	s, env := started(t)
	s.SetPinned(demo.MinaChat, true)
	s.Mute(demo.MinaChat, -1)
	s.SetArchived(demo.AronChat, true)
	env.Settle(t, nil)
	c, _ := s.Chat(demo.MinaChat)
	if !c.Pinned || !c.Muted {
		t.Fatalf("%+v", c)
	}
	if s.Visible()[2].ID != demo.MinaChat {
		t.Fatal("pinned chat not among pinned")
	}
	if len(s.InTab(TabArchive)) != 2 {
		t.Fatal("archive")
	}
	s.SetRead(demo.DesignChat, true)
	env.Settle(t, nil)
	if c, _ := s.Chat(demo.DesignChat); c.UnreadCount != 0 {
		t.Fatal("still unread")
	}
	s.Leave(demo.AronChat)
	env.Settle(t, nil)
	if _, ok := s.Chat(demo.AronChat); ok {
		t.Fatal("left chat remains")
	}
}

func TestNeighbor(t *testing.T) {
	s, _ := started(t)
	next, ok := s.Neighbor(1)
	if !ok || next != demo.SavedChat {
		t.Fatal(next)
	}
	s.Selected = demo.SavedChat
	if next, _ := s.Neighbor(1); next != demo.DesignChat {
		t.Fatal(next)
	}
	if _, ok := s.Neighbor(-1); ok {
		t.Fatal("moved before the first chat")
	}
}

func TestIncomingMessageCallback(t *testing.T) {
	env := testkit.New(t, nil)
	s := New(env.Runtime)
	var got []tg.Message
	s.OnMessage = func(m tg.Message, edited bool) { got = append(got, m) }
	s.Start()
	env.Settle(t, nil)
	if _, err := env.Repo.SendMessage(t.Context(), demo.AronChat, "from elsewhere", tg.SendOptions{}); err != nil {
		t.Fatal(err)
	}
	env.Settle(t, nil)
	if len(got) != 1 || got[0].Body != "from elsewhere" {
		t.Fatal(got)
	}
	_ = time.Second
}
