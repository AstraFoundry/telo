package demo

import (
	"context"
	"os"
	"slices"
	"sync"
	"testing"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

type recorder struct {
	mu     sync.Mutex
	events []tg.Event
}

func (r *recorder) add(e tg.Event) { r.mu.Lock(); r.events = append(r.events, e); r.mu.Unlock() }

func (r *recorder) has(match func(tg.Event) bool) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.ContainsFunc(r.events, match)
}

func setup(t *testing.T) (*Repository, *recorder) {
	t.Helper()
	r := New(Options{CacheDir: t.TempDir(), Now: func() time.Time { return Base }})
	rec := &recorder{}
	r.Subscribe(rec.add)
	t.Cleanup(r.Close)
	return r, rec
}

func TestChatListOrder(t *testing.T) {
	r, _ := setup(t)
	page, err := r.ChatPage(context.Background(), "", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 3 || page.Items[0].ID != SavedChat || page.Items[1].ID != DesignChat || page.NextCursor == "" {
		t.Fatalf("%+v", page)
	}
	rest, _ := r.ChatPage(context.Background(), page.NextCursor, 50)
	if len(rest.Items) != 5 || rest.NextCursor != "" {
		t.Fatalf("%d %q", len(rest.Items), rest.NextCursor)
	}
}

func TestPagingAndUnreadBoundary(t *testing.T) {
	r, _ := setup(t)
	ctx := context.Background()
	c, _ := r.Chat(ctx, DesignChat)
	if c.UnreadCount != 3 || c.LastReadMessageID != 13 {
		t.Fatalf("unread %d boundary %d", c.UnreadCount, c.LastReadMessageID)
	}
	page, _ := r.Messages(ctx, DesignChat, 0, 5)
	if page.Items[0].ID != 16 || len(page.Items) != 5 || page.NextCursor != 12 {
		t.Fatalf("first page %d items, newest %d, cursor %d", len(page.Items), page.Items[0].ID, page.NextCursor)
	}
	older, _ := r.Messages(ctx, DesignChat, page.NextCursor, 5)
	if older.Items[0].ID != 11 {
		t.Fatalf("older page starts at %d", older.Items[0].ID)
	}
	if err := r.ViewMessages(ctx, DesignChat, []tg.MessageID{16}); err != nil {
		t.Fatal(err)
	}
	if c, _ := r.Chat(ctx, DesignChat); c.UnreadCount != 0 {
		t.Fatal("still unread after viewing")
	}
}

func TestSendEditDeleteForward(t *testing.T) {
	r, rec := setup(t)
	ctx := context.Background()
	m, err := r.SendMessage(ctx, MinaChat, "  hello **there**  ", tg.SendOptions{ClientID: "c1", ReplyTo: 4})
	if err != nil {
		t.Fatal(err)
	}
	if m.Body != "hello **there**" || m.ReplyTo == nil || m.ClientID != "c1" || !m.Outgoing {
		t.Fatalf("%+v", m)
	}
	if !rec.has(func(e tg.Event) bool { u, ok := e.(tg.MessageUpserted); return ok && u.Message.ID == m.ID }) {
		t.Fatal("no upsert event")
	}
	if err := r.EditMessage(ctx, MinaChat, m.ID, "edited", nil); err != nil {
		t.Fatal(err)
	}
	if err := r.EditMessage(ctx, MinaChat, 4, "not mine", nil); err == nil {
		t.Fatal("edited an incoming message")
	}
	if err := r.ForwardMessages(ctx, MinaChat, []tg.MessageID{m.ID}, AronChat, false); err != nil {
		t.Fatal(err)
	}
	page, _ := r.Messages(ctx, AronChat, 0, 1)
	if page.Items[0].Forward == nil || page.Items[0].Body != "edited" {
		t.Fatalf("%+v", page.Items[0])
	}
	if err := r.DeleteMessages(ctx, MinaChat, []tg.MessageID{m.ID}, tg.DeleteForEveryone); err != nil {
		t.Fatal(err)
	}
	page, _ = r.Messages(ctx, MinaChat, 0, 1)
	if page.Items[0].ID == m.ID {
		t.Fatal("not deleted")
	}
}

func TestReadOnlyChannelRejectsSends(t *testing.T) {
	r, _ := setup(t)
	if _, err := r.SendMessage(context.Background(), ProductChat, "hi", tg.SendOptions{}); err != tg.ErrCannotWrite {
		t.Fatal(err)
	}
}

func TestScheduledAndPinned(t *testing.T) {
	r, _ := setup(t)
	ctx := context.Background()
	at := Base.Add(time.Hour)
	m, err := r.SendMessage(ctx, AronChat, "later", tg.SendOptions{SendAt: at})
	if err != nil {
		t.Fatal(err)
	}
	s, _ := r.ScheduledMessages(ctx, AronChat)
	if len(s) != 1 || !s[0].ScheduledAt.Equal(at) {
		t.Fatal(s)
	}
	if err := r.SendScheduledNow(ctx, AronChat, m.ID); err != nil {
		t.Fatal(err)
	}
	if s, _ := r.ScheduledMessages(ctx, AronChat); len(s) != 0 {
		t.Fatal("still scheduled")
	}
	pinned, _ := r.PinnedMessages(ctx, DesignChat)
	if len(pinned) != 2 || pinned[0].ID != 16 {
		t.Fatalf("%v", pinned)
	}
}

func TestPollVoting(t *testing.T) {
	r, _ := setup(t)
	ctx := context.Background()
	if err := r.VotePoll(ctx, DesignChat, 3, []int{0, 2}); err != nil {
		t.Fatal(err)
	}
	page, _ := r.MessagesAround(ctx, DesignChat, 3, 3)
	var poll *tg.Poll
	for _, m := range page.Items {
		if m.ID == 3 {
			poll = m.Poll
		}
	}
	if poll == nil || poll.TotalVoterCount != 4 || !poll.Options[0].Chosen || poll.Options[0].VoterCount != 3 {
		t.Fatalf("%+v", poll)
	}
	if err := r.VotePoll(ctx, DesignChat, 5, []int{1}); err == nil {
		t.Fatal("voted in a closed poll")
	}
}

func TestReactionsAndFolders(t *testing.T) {
	r, rec := setup(t)
	ctx := context.Background()
	if err := r.SetReaction(ctx, DesignChat, 1, "👍", false); err != nil {
		t.Fatal(err)
	}
	if !rec.has(func(e tg.Event) bool { c, ok := e.(tg.ReactionsChanged); return ok && c.Reactions[0].Count == 1 }) {
		t.Fatal("reaction count")
	}
	f, err := r.CreateFolder(ctx, tg.FolderInput{Title: "Friends", ChatIDs: []tg.ChatID{MinaChat, AronChat}})
	if err != nil {
		t.Fatal(err)
	}
	c, _ := r.Chat(ctx, MinaChat)
	if !slices.Contains(c.FolderIDs, f.ID) {
		t.Fatal("chat not in folder")
	}
	if err := r.DeleteFolder(ctx, f.ID); err != nil {
		t.Fatal(err)
	}
	if c, _ := r.Chat(ctx, MinaChat); slices.Contains(c.FolderIDs, f.ID) {
		t.Fatal("deleted folder kept")
	}
}

func TestDownloadsMaterializeFiles(t *testing.T) {
	r, rec := setup(t)
	page, _ := r.MessagesAround(context.Background(), DesignChat, 7, 3)
	var photo *tg.Media
	for _, m := range page.Items {
		if m.ID == 7 {
			photo = m.Media
		}
	}
	if err := r.Download(context.Background(), photo.FileID); err != nil {
		t.Fatal(err)
	}
	var path string
	rec.has(func(e tg.Event) bool {
		if d, ok := e.(tg.DownloadProgressed); ok && d.Download.State == tg.TransferDone {
			path = d.Download.Path
			return true
		}
		return false
	})
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}

func TestSessionsPrivacyProxies(t *testing.T) {
	r, _ := setup(t)
	ctx := context.Background()
	if err := r.TerminateSession(ctx, 1); err == nil {
		t.Fatal("ended the current session")
	}
	if err := r.TerminateOtherSessions(ctx); err != nil {
		t.Fatal(err)
	}
	if s, _ := r.Sessions(ctx); len(s) != 1 {
		t.Fatal(s)
	}
	if err := r.SetPrivacy(ctx, tg.PrivacyLastSeen, tg.PrivacyRule{Audience: tg.AudienceNobody}); err != nil {
		t.Fatal(err)
	}
	if rule, _ := r.Privacy(ctx, tg.PrivacyLastSeen); rule.Audience != tg.AudienceNobody {
		t.Fatal(rule)
	}
	p, err := r.AddProxy(ctx, tg.Proxy{Server: "10.0.0.1", Port: 443, Kind: tg.ProxyMTProto, Secret: "ee00"})
	if err != nil {
		t.Fatal(err)
	}
	if err := r.EnableProxy(ctx, p.ID, true); err != nil {
		t.Fatal(err)
	}
	ps, _ := r.Proxies(ctx)
	if len(ps) != 2 || !ps[1].Enabled || ps[0].Enabled {
		t.Fatal(ps)
	}
}

func TestAutoReply(t *testing.T) {
	r := New(Options{CacheDir: t.TempDir(), ReplyAfter: 5 * time.Millisecond})
	defer r.Close()
	done := make(chan tg.Message, 4)
	r.Subscribe(func(e tg.Event) {
		if u, ok := e.(tg.MessageUpserted); ok && !u.Message.Outgoing {
			done <- u.Message
		}
	})
	if _, err := r.SendMessage(context.Background(), MinaChat, "ping", tg.SendOptions{}); err != nil {
		t.Fatal(err)
	}
	select {
	case m := <-done:
		if m.Body != "On it." {
			t.Fatal(m.Body)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no reply")
	}
}
