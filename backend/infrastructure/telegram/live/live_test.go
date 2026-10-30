package live

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib/tdapi"
)

// recorder answers every request with ok and keeps them.
type recorder struct {
	mu    sync.Mutex
	calls []string
}

func (r *recorder) Call(_ context.Context, req tdapi.Object) (json.RawMessage, error) {
	r.mu.Lock()
	r.calls = append(r.calls, req.TDType())
	r.mu.Unlock()
	if req.TDType() == "downloadFile" {
		return json.RawMessage(`{"@type":"file","id":1}`), nil
	}
	return json.RawMessage(`{"@type":"ok"}`), nil
}

// feed decodes TDLib JSON updates and hands them to the session.
func feed(t *testing.T, s *Session, updates ...string) {
	t.Helper()
	for _, u := range updates {
		obj, err := tdapi.Decode(json.RawMessage(u))
		if err != nil {
			t.Fatal(err)
		}
		if _, unknown := obj.(*tdapi.Unknown); unknown {
			t.Fatalf("not generated: %s", u)
		}
		s.handle(obj)
	}
}

const (
	me     = `{"@type":"updateOption","name":"my_id","value":{"@type":"optionValueInteger","value":"100"}}`
	ada    = `{"@type":"updateUser","user":{"@type":"user","id":100,"first_name":"Ada","last_name":"Park","phone_number":"351912345678","status":{"@type":"userStatusOnline","expires":1},"accent_color_id":2,"type":{"@type":"userTypeRegular"}}}`
	mina   = `{"@type":"updateUser","user":{"@type":"user","id":200,"first_name":"Mina","usernames":{"@type":"usernames","active_usernames":["mina"]},"status":{"@type":"userStatusOffline","was_online":1700000000},"type":{"@type":"userTypeRegular"},"profile_photo":{"@type":"profilePhoto","id":"9","small":{"@type":"file","id":7,"size":100,"local":{"@type":"localFile","path":""}},"minithumbnail":{"@type":"minithumbnail","width":8,"height":8,"data":"AQID"}}}}`
	saved  = `{"@type":"updateNewChat","chat":{"@type":"chat","id":100,"type":{"@type":"chatTypePrivate","user_id":100},"title":"Ada Park","positions":[{"@type":"chatPosition","list":{"@type":"chatListMain"},"order":"900","is_pinned":true}],"notification_settings":{"@type":"chatNotificationSettings","mute_for":0},"permissions":{"@type":"chatPermissions","can_send_basic_messages":true,"can_send_other_messages":true,"can_send_photos":true}}}`
	direct = `{"@type":"updateNewChat","chat":{"@type":"chat","id":200,"type":{"@type":"chatTypePrivate","user_id":200},"title":"Mina","unread_count":2,"photo":{"@type":"chatPhotoInfo","small":{"@type":"file","id":7,"size":100,"local":{"@type":"localFile","path":""}},"minithumbnail":{"@type":"minithumbnail","width":8,"height":8,"data":"AQID"}},"last_read_inbox_message_id":3145728,` +
		`"positions":[{"@type":"chatPosition","list":{"@type":"chatListMain"},"order":"800"},{"@type":"chatPosition","list":{"@type":"chatListFolder","chat_folder_id":4},"order":"800"}],` +
		`"notification_settings":{"@type":"chatNotificationSettings","mute_for":3600},"permissions":{"@type":"chatPermissions","can_send_basic_messages":true}}}`
	channel = `{"@type":"updateNewChat","chat":{"@type":"chat","id":-1001,"type":{"@type":"chatTypeSupergroup","supergroup_id":1,"is_channel":true},"title":"News","positions":[{"@type":"chatPosition","list":{"@type":"chatListArchive"},"order":"700"}],"notification_settings":{"@type":"chatNotificationSettings"}}}`
	news    = `{"@type":"updateSupergroup","supergroup":{"@type":"supergroup","id":1,"status":{"@type":"chatMemberStatusMember"},"member_count":42,"is_channel":true}}`
	reply   = `{"@type":"updateNewMessage","message":{"@type":"message","id":4194304,"chat_id":200,"sender_id":{"@type":"messageSenderUser","user_id":200},"date":1700000100,` +
		`"reply_to":{"@type":"messageReplyToMessage","chat_id":200,"message_id":3145728,"content":{"@type":"messageText","text":{"@type":"formattedText","text":"lunch?"}}},` +
		`"content":{"@type":"messageText","text":{"@type":"formattedText","text":"see @mina's link","entities":[{"@type":"textEntity","offset":4,"length":5,"type":{"@type":"textEntityTypeMention"}},{"@type":"textEntity","offset":0,"length":3,"type":{"@type":"textEntityTypeBold"}}]}},` +
		`"interaction_info":{"@type":"messageInteractionInfo","view_count":3,"reactions":{"@type":"messageReactions","reactions":[{"@type":"messageReaction","type":{"@type":"reactionTypeEmoji","emoji":"👍"},"total_count":2,"is_chosen":true}]}}}}`
	quiz = `{"@type":"updateNewMessage","message":{"@type":"message","id":5242880,"chat_id":200,"sender_id":{"@type":"messageSenderUser","user_id":100},"is_outgoing":true,"date":1700000200,` +
		`"content":{"@type":"messagePoll","poll":{"@type":"poll","id":"77","question":{"@type":"formattedText","text":"Best key?"},"options":[{"@type":"pollOption","id":"a","text":{"@type":"formattedText","text":"⌘"},"voter_count":1,"vote_percentage":100,"is_chosen":true}],"total_voter_count":1,"type":{"@type":"pollTypeQuiz","correct_option_ids":[0]}}}}}`
)

func session(t *testing.T) (*Session, *recorder, *[]tg.Event) {
	rec := &recorder{}
	s := newSession(Config{}, rec)
	var mu sync.Mutex
	var events []tg.Event
	s.Subscribe(func(e tg.Event) {
		mu.Lock()
		events = append(events, e)
		mu.Unlock()
	})
	feed(t, s, me, ada, mina, saved, direct, news, channel)
	return s, rec, &events
}

func TestChatsMapFromUpdates(t *testing.T) {
	s, _, _ := session(t)
	s.mu.Lock()
	list := s.listedLocked()
	s.mu.Unlock()
	if len(list) != 3 || list[0].ID != 100 || list[1].ID != 200 || list[2].ID != -1001 {
		t.Fatalf("order %+v", list)
	}
	saved, direct, news := list[0], list[1], list[2]
	if saved.Kind != tg.ChatSaved || !saved.Pinned || !saved.CanSendMessages {
		t.Fatalf("saved %+v", saved)
	}
	if direct.Kind != tg.ChatDirect || !direct.Muted || direct.UnreadCount != 2 || direct.Online || len(direct.FolderIDs) != 1 || direct.FolderIDs[0] != 4 {
		t.Fatalf("direct %+v", direct)
	}
	if direct.CanSendMedia || !direct.CanSendMessages {
		t.Fatalf("permissions of direct %+v", direct)
	}
	if !direct.Avatar.Pending || len(direct.Avatar.Minithumbnail) != 3 || direct.Avatar.Placeholder.Glyph != "M" {
		t.Fatalf("avatar %+v", direct.Avatar)
	}
	if news.Kind != tg.ChatChannel || news.FolderID != tg.ArchiveFolderID || news.CanSendMessages || news.MemberCount != 42 {
		t.Fatalf("channel %+v", news)
	}
}

func TestMessagesMapFromUpdates(t *testing.T) {
	s, _, events := session(t)
	feed(t, s, reply, quiz)
	var got []tg.Message
	for _, e := range *events {
		if m, ok := e.(tg.MessageUpserted); ok {
			got = append(got, m.Message)
		}
	}
	if len(got) != 2 {
		t.Fatalf("%d messages", len(got))
	}
	m := got[0]
	if m.SenderName != "Mina" || m.Body != "see @mina's link" || len(m.Entities) != 2 || m.Entities[1].Type != tg.EntityBold {
		t.Fatalf("text %+v", m)
	}
	if m.ReplyTo == nil || m.ReplyTo.ID != 3145728 || m.ReplyTo.Body != "lunch?" || m.Views != 3 {
		t.Fatalf("reply %+v", m.ReplyTo)
	}
	if len(m.Reactions) != 1 || m.Reactions[0].Emoji != "👍" || !m.Reactions[0].Chosen {
		t.Fatalf("reactions %+v", m.Reactions)
	}
	p := got[1]
	if !p.Outgoing || p.SenderName != "Ada Park" || p.Poll == nil || p.Poll.Kind != tg.PollQuiz || p.Poll.Question != "Best key?" || len(p.Poll.CorrectOptionIDs) != 1 {
		t.Fatalf("poll %+v", p)
	}
}

func TestProfilePictureSettles(t *testing.T) {
	s, rec, events := session(t)
	deadline := time.Now().Add(2 * time.Second)
	for {
		rec.mu.Lock()
		asked := len(rec.calls)
		rec.mu.Unlock()
		if asked > 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(rec.calls) == 0 || rec.calls[0] != "downloadFile" {
		t.Fatalf("calls %v", rec.calls)
	}
	*events = nil
	feed(t, s, `{"@type":"updateFile","file":{"@type":"file","id":7,"size":100,"local":{"@type":"localFile","path":"/tmp/mina.jpg","is_downloading_completed":true}}}`)
	var avatar, chat bool
	for _, e := range *events {
		switch e := e.(type) {
		case tg.AvatarChanged:
			avatar = e.UserID == 200 && e.Avatar.Path == "/tmp/mina.jpg"
		case tg.ChatUpserted:
			chat = chat || e.Chat.ID == 200 && e.Chat.Avatar.Path == "/tmp/mina.jpg"
		case tg.DownloadProgressed:
			t.Fatal("a profile picture is not a download")
		}
	}
	if !avatar || !chat {
		t.Fatalf("events %+v", *events)
	}
}

func TestEntitiesRoundTrip(t *testing.T) {
	in := []tg.Entity{{Type: tg.EntityBold, Offset: 0, Length: 4}, {Type: tg.EntityPre, Offset: 5, Length: 3, Language: "go"},
		{Type: tg.EntityTextLink, Offset: 9, Length: 2, URL: "https://telegram.org"}, {Type: tg.EntityMention, Offset: 12, Length: 3}}
	out := entities(inputEntities(in))
	if len(out) != 3 || out[1].Language != "go" || out[2].URL != "https://telegram.org" {
		t.Fatalf("%+v", out)
	}
}

type memoryKeys struct {
	mu   sync.Mutex
	keys map[string][]byte
}

func (k *memoryKeys) Key(name string) ([]byte, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if key, ok := k.keys[name]; ok {
		return key, nil
	}
	key := make([]byte, 32)
	key[0] = byte(len(k.keys) + 1)
	k.keys[name] = key
	return key, nil
}

func (k *memoryKeys) Delete(name string) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	delete(k.keys, name)
	return nil
}

func stagedLibrary(t *testing.T) *tdlib.Library {
	t.Helper()
	path, err := tdlib.Locate(filepath.Join("..", "..", "..", "..", "build", "tdlib-native"))
	if err != nil {
		if os.Getenv("TELO_REQUIRE_TDLIB") == "1" {
			t.Fatal(err)
		}
		t.Skip(err)
	}
	lib, err := tdlib.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return lib
}

// TestSignInReachesPhoneStep opens a new account on the real libtdjson:
// TDLib takes the parameters and the encrypted database, and asks for
// the phone number without the network.
func TestSignInReachesPhoneStep(t *testing.T) {
	lib := stagedLibrary(t)
	keys := &memoryKeys{keys: map[string][]byte{}}
	dir := t.TempDir()
	a := NewAccounts(AccountsOptions{Library: lib, Directory: dir, Keys: keys,
		Template: Config{APIID: 1, APIHash: "0123456789abcdef0123456789abcdef", Language: "en", Device: "Test", System: "Linux", Version: "0.1.0"}})
	t.Cleanup(func() { _ = a.Close() })
	steps := make(chan tg.AuthStep, 16)
	a.Subscribe(func(e tg.Event) {
		if auth, ok := e.(tg.AuthChanged); ok {
			steps <- auth.State.Step
		}
	})
	ctx := context.Background()
	if err := a.Restore(ctx); err != nil {
		t.Fatal(err)
	}
	if got := a.Auth().Step; got != tg.AuthIdle {
		t.Fatalf("no accounts yet: %s", got)
	}
	if err := a.StartSignIn(ctx); err != nil {
		t.Fatal(err)
	}
	timeout := time.After(20 * time.Second)
	for a.Auth().Step != tg.AuthWaitPhone {
		select {
		case <-steps:
		case <-timeout:
			t.Fatalf("stuck at %s", a.Auth().Step)
		}
	}
	if a.Active() != nil {
		t.Fatal("an account signing in is not active")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("account directory: %v %v", entries, err)
	}
	if err := a.CancelSignIn(ctx); err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 || len(keys.keys) != 0 {
		t.Fatalf("a cancelled sign-in leaves %v and %d keys", entries, len(keys.keys))
	}
	if got := a.Auth().Step; got != tg.AuthIdle {
		t.Fatalf("after cancel: %s", got)
	}
}
