// Package telegram holds the workspace use cases above the repository
// port: which incoming messages notify, and how a notification reads.
package telegram

import (
	"strings"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// Notification is a desktop banner for an incoming message.
type Notification struct {
	ChatID    tg.ChatID
	MessageID tg.MessageID
	Title     string
	Body      string
	Silent    bool
}

// Placeholders the banner uses when the preview or the sender is hidden;
// the UI copy catalog supplies them.
type Placeholders struct {
	AppName    string
	NewMessage string
	Media      func(tg.MediaKind) string
}

// Notify decides whether an incoming message raises a banner, and builds
// it. Outgoing, edited, muted (unless counted), focused-chat and
// kind-disabled messages stay silent, as the reference clients do.
func Notify(m tg.Message, edited bool, chat tg.Chat, focused bool, p preferences.Preferences, ph Placeholders) (Notification, bool) {
	if edited || m.Outgoing || !p.Notifications || chat.Muted || focused || m.Service != tg.ServiceNone {
		return Notification{}, false
	}
	switch chat.Kind {
	case tg.ChatDirect, tg.ChatSecret:
		if !p.NotifyDirect {
			return Notification{}, false
		}
	case tg.ChatGroup:
		if !p.NotifyGroups {
			return Notification{}, false
		}
	case tg.ChatChannel:
		if !p.NotifyChannels {
			return Notification{}, false
		}
	case tg.ChatSaved:
		return Notification{}, false
	}
	n := Notification{ChatID: m.ChatID, MessageID: m.ID, Title: ph.AppName, Body: ph.NewMessage, Silent: !p.NotifySound}
	if p.NotifySender {
		n.Title = chat.Title
		if chat.Kind == tg.ChatGroup && m.SenderName != "" {
			n.Title = m.SenderName + " · " + chat.Title
		}
	}
	// A secret chat's content never leaves it in a banner.
	if p.NotifyPreview && chat.Kind != tg.ChatSecret {
		body := strings.TrimSpace(m.Body)
		if body == "" && m.Media != nil && ph.Media != nil {
			body = ph.Media(m.Media.Kind)
		}
		if body != "" {
			n.Body = body
		}
	}
	return n, true
}

// UnreadBadge is the dock badge: unread messages, muted chats counted only
// when the user asks.
func UnreadBadge(chats []tg.Chat, countMuted bool) int {
	n := 0
	for _, c := range chats {
		if c.Muted && !countMuted {
			continue
		}
		n += c.UnreadCount
		if c.MarkedUnread && c.UnreadCount == 0 {
			n++
		}
	}
	return n
}
