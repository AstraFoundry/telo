package telegram

import (
	"testing"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

var ph = Placeholders{AppName: "Telo", NewMessage: "New message", Media: func(k tg.MediaKind) string { return "Photo" }}

func TestNotify(t *testing.T) {
	p := preferences.Default()
	group := tg.Chat{ID: 1, Title: "Design", Kind: tg.ChatGroup}
	m := tg.Message{ID: 9, ChatID: 1, SenderName: "Mina", Body: "hi"}
	n, ok := Notify(m, false, group, false, p, ph)
	if !ok || n.Title != "Mina · Design" || n.Body != "hi" || n.Silent {
		t.Fatalf("%+v %v", n, ok)
	}
	for name, block := range map[string]func() (tg.Message, bool, tg.Chat, bool, preferences.Preferences){
		"edited": func() (tg.Message, bool, tg.Chat, bool, preferences.Preferences) { return m, true, group, false, p },
		"outgoing": func() (tg.Message, bool, tg.Chat, bool, preferences.Preferences) {
			o := m
			o.Outgoing = true
			return o, false, group, false, p
		},
		"muted": func() (tg.Message, bool, tg.Chat, bool, preferences.Preferences) {
			c := group
			c.Muted = true
			return m, false, c, false, p
		},
		"focused": func() (tg.Message, bool, tg.Chat, bool, preferences.Preferences) { return m, false, group, true, p },
		"groups off": func() (tg.Message, bool, tg.Chat, bool, preferences.Preferences) {
			q := p
			q.NotifyGroups = false
			return m, false, group, false, q
		},
	} {
		m, edited, c, focused, prefs := block()
		if _, ok := Notify(m, edited, c, focused, prefs, ph); ok {
			t.Errorf("%s notified", name)
		}
	}
	q := p
	q.NotifySender, q.NotifyPreview, q.NotifySound = false, false, false
	n, _ = Notify(m, false, group, false, q, ph)
	if n.Title != "Telo" || n.Body != "New message" || !n.Silent {
		t.Fatalf("%+v", n)
	}
	secret := tg.Chat{ID: 2, Title: "Mina", Kind: tg.ChatSecret}
	n, _ = Notify(tg.Message{ChatID: 2, Body: "secret text"}, false, secret, false, p, ph)
	if n.Body != "New message" {
		t.Fatalf("secret chat leaked %q", n.Body)
	}
	n, _ = Notify(tg.Message{ChatID: 1, Media: &tg.Media{Kind: tg.MediaPhoto}}, false, group, false, p, ph)
	if n.Body != "Photo" {
		t.Fatal(n.Body)
	}
}

func TestUnreadBadge(t *testing.T) {
	chats := []tg.Chat{{UnreadCount: 3}, {UnreadCount: 2, Muted: true}, {MarkedUnread: true}}
	if UnreadBadge(chats, false) != 4 || UnreadBadge(chats, true) != 6 {
		t.Fatal(UnreadBadge(chats, false), UnreadBadge(chats, true))
	}
}
