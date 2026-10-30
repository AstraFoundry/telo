package chat

import (
	"strings"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
)

// Summary is a one-line rendering of a message: its text, else what it
// carries (a photo, a poll, a call) or the event it records. The chat
// list, the pinned bar and reply quotes read it.
func Summary(m tg.Message) string {
	if m.Service != tg.ServiceNone {
		return ServiceText(m)
	}
	body := strings.Join(strings.Fields(m.Body), " ")
	if body != "" && m.Media == nil {
		return body
	}
	var kind string
	switch {
	case m.Poll != nil:
		return "📊 " + m.Poll.Question
	case m.Call != nil:
		return copy.T(CallLabel(*m.Call))
	case m.Media != nil && m.Media.Kind == tg.MediaWebPage:
		return body
	case m.Media != nil:
		kind = MediaName(m.Media)
	}
	if body == "" {
		return kind
	}
	return kind + ", " + body
}

// Preview is the chat list's second line for a chat.
func Preview(ch tg.Chat) string {
	if ch.LastMessage == nil {
		return ch.Preview
	}
	return Summary(*ch.LastMessage)
}

// MediaName names what a message carries.
func MediaName(md *tg.Media) string {
	switch md.Kind {
	case tg.MediaPhoto:
		return copy.T(copy.Photo)
	case tg.MediaVideo:
		return copy.T(copy.Video)
	case tg.MediaAnimation:
		return copy.T(copy.Gif)
	case tg.MediaVoice:
		return copy.T(copy.VoiceMessage)
	case tg.MediaVideoNote:
		return copy.T(copy.VideoMessage)
	case tg.MediaAudio:
		return copy.T(copy.Audio)
	case tg.MediaSticker:
		if md.Sticker != nil && md.Sticker.Emoji != "" {
			return md.Sticker.Emoji + " " + copy.T(copy.Sticker)
		}
		return copy.T(copy.Sticker)
	case tg.MediaLocation:
		return copy.T(copy.Location)
	case tg.MediaContact:
		return copy.T(copy.ContactCard)
	case tg.MediaWebPage:
		if md.WebPage != nil {
			return md.WebPage.URL
		}
	}
	return copy.T(copy.File)
}

// CallLabel names a call by its outcome, as tdesktop folds them.
func CallLabel(call tg.MessageCall) copy.Key {
	if call.Video {
		switch call.Status {
		case tg.CallOutgoing:
			return copy.CallVideoOutgoing
		case tg.CallIncoming:
			return copy.CallVideoIncoming
		case tg.CallMissed:
			return copy.CallVideoMissed
		}
	}
	return map[tg.CallStatus]copy.Key{tg.CallOutgoing: copy.CallOutgoing, tg.CallIncoming: copy.CallIncoming, tg.CallMissed: copy.CallMissed,
		tg.CallDeclined: copy.CallDeclined, tg.CallCancelled: copy.CallCancelled, tg.CallGroup: copy.CallGroup}[call.Status]
}

// ServiceText words a service message.
func ServiceText(m tg.Message) string {
	who := m.SenderName
	switch m.Service {
	case tg.ServiceChatCreated:
		return copy.F(copy.ChatCreated, who)
	case tg.ServiceTitleChanged:
		return copy.F(copy.TitleChanged, who, m.Body)
	case tg.ServicePhotoChanged:
		return copy.F(copy.PhotoChanged, who)
	case tg.ServiceMembersAdded:
		return copy.F(copy.MembersAdded, who)
	case tg.ServiceMemberJoined:
		return copy.F(copy.MemberJoined, who)
	case tg.ServiceMemberLeft:
		return copy.F(copy.MemberLeft, who)
	case tg.ServicePinned:
		return copy.F(copy.MessagePinnedService, who)
	case tg.ServiceScreenshot:
		return copy.F(copy.ScreenshotTaken, who)
	case tg.ServiceAutoDelete:
		return copy.F(copy.AutoDeleteSet, who)
	case tg.ServiceJoinedTelegram:
		return copy.F(copy.JoinedTelegram, who)
	}
	return m.Body
}
