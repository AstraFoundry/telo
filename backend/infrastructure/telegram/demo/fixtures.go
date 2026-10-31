// Package demo is the in-memory Telegram workspace that `make dev DEMO=1`
// opens and every UI test runs on. It implements the same repository port
// as the TDLib adapter, publishes the same events, and covers each message
// shape the transcript draws, so the interface is exercised without an
// account or a network.
package demo

import (
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// Chat ids of the fixtures. The account's own user id is the Saved
// Messages chat id, as in TDLib.
const (
	AccountID   tg.UserID = 1000
	SavedChat   tg.ChatID = 1000
	DesignChat  tg.ChatID = -1002001
	ProductChat tg.ChatID = -1003001
	OffsiteChat tg.ChatID = 2001
	BotChat     tg.ChatID = 3001
	MinaChat    tg.ChatID = 4001
	AronChat    tg.ChatID = 4002
	SecretChat  tg.ChatID = 9001

	WorkFolder = 2
)

// User ids of the demo peers.
const (
	Mina  tg.UserID = 4001
	Aron  tg.UserID = 4002
	Lev   tg.UserID = 4003
	Priya tg.UserID = 2001
	Bot   tg.UserID = 3001
)

// Base is the fixtures' "now": every timestamp is relative to it, so
// snapshots render the same dates on any day.
var Base = time.Date(2026, 8, 27, 16, 0, 0, 0, time.UTC)

func ago(d time.Duration) time.Time { return Base.Add(-d) }

type peer struct {
	id        tg.UserID
	name      string
	username  string
	bio       string
	phone     string
	contact   bool
	needPhone bool
	accent    int
	online    bool
}

var peers = map[tg.UserID]peer{
	Mina:  {Mina, "Mina", "mina", "Design systems, spacing rules, and long changelogs.", "+1 555 0142", false, true, 5, true},
	Aron:  {Aron, "Aron", "aron", "Collects reference shots for the media viewer.", "", true, false, 1, true},
	Lev:   {Lev, "Lev", "lev", "Breaks the retry flow on purpose, then files it.", "", true, false, 3, false},
	Priya: {Priya, "Priya", "priya", "Offsite logistics: venues, travel, and hard deadlines.", "", true, false, 6, true},
	Bot:   {Bot, "Telo Bot", "telobot", "Builds, deploys and nightly reports.", "", false, false, 4, false},
}

func seedChats() []tg.Chat {
	chat := func(id tg.ChatID, title, preview string, at time.Time, kind tg.ChatKind, accent int) tg.Chat {
		return tg.Chat{ID: id, Title: title, Preview: preview, UpdatedAt: at, Kind: kind,
			CanSendMessages: true, CanSendStickers: true, CanSendMedia: true, CanDeleteForAll: kind != tg.ChatChannel,
			Initials: tg.Initials(title), Avatar: tg.Avatar{Placeholder: tg.Placeholder(title, accent)}}
	}
	saved := chat(SavedChat, "Saved Messages", "Release checklist: tests, docs, signed packages.", ago(18*time.Minute), tg.ChatSaved, 5)
	saved.Pinned = true
	design := chat(DesignChat, "Telo Design", "Ship both with the next build.", ago(88*time.Minute), tg.ChatGroup, 2)
	design.Pinned, design.UnreadCount, design.UnreadMentions, design.FolderID, design.FolderIDs, design.MemberCount = true, 3, 1, WorkFolder, []int{WorkFolder}, 4
	product := chat(ProductChat, "Product Notes", "Two emoji and nothing else", ago(25*time.Hour), tg.ChatChannel, 0)
	product.Muted, product.FolderID, product.FolderIDs, product.MemberCount = true, WorkFolder, []int{WorkFolder}, 1284
	product.CanSendMessages, product.CanSendStickers, product.CanSendMedia = false, false, false
	offsite := chat(OffsiteChat, "Priya", "Book the venue before Friday.", ago(54*time.Hour), tg.ChatDirect, 6)
	offsite.UnreadCount, offsite.FolderID, offsite.Online, offsite.UserID = 2, tg.ArchiveFolderID, true, Priya
	bot := chat(BotChat, "Telo Bot", "Build 482 finished: 12 tests, 0 failures.", ago(80*time.Hour), tg.ChatDirect, 4)
	bot.UserID = Bot
	mina := chat(MinaChat, "Mina", "Ship both with the next build.", ago(94*time.Hour), tg.ChatDirect, 5)
	mina.Online, mina.UserID = true, Mina
	aron := chat(AronChat, "Aron", "Send over the spacing tokens when ready.", ago(94*time.Hour+10*time.Minute), tg.ChatDirect, 1)
	aron.Online, aron.UserID = true, Aron
	secret := chat(SecretChat, "Mina", "This chat is end-to-end encrypted.", ago(94*time.Hour+20*time.Minute), tg.ChatSecret, 5)
	secret.SecretState, secret.UserID = tg.SecretReady, Mina
	secret.CanSendStickers, secret.CanDeleteForAll = true, true
	chats := []tg.Chat{saved, design, product, offsite, bot, mina, aron, secret}
	for i := range chats {
		chats[i].ListOrder = int64(len(chats)-i) * 1000
		if chats[i].Pinned {
			chats[i].ListOrder += 1 << 40
		}
	}
	return chats
}

// msg starts a fixture message.
func msg(chat tg.ChatID, id tg.MessageID, from tg.UserID, body string, at time.Time) tg.Message {
	m := tg.Message{ID: id, ChatID: chat, Body: body, SentAt: at, Status: tg.StatusRead, CanForward: true, CanDeleteForAll: true}
	if from == AccountID {
		m.Outgoing, m.SenderName, m.SenderID, m.CanEdit = true, "You", int64(AccountID), true
	} else if p, ok := peers[from]; ok {
		m.SenderName, m.SenderID = p.name, int64(from)
		m.SenderAvatar = tg.Avatar{Placeholder: tg.Placeholder(p.name, p.accent)}
	}
	m.IsolatedEmoji = tg.IsolatedEmojiCount(body)
	return m
}

func channelPost(id tg.MessageID, body string, at time.Time) tg.Message {
	m := tg.Message{ID: id, ChatID: ProductChat, SenderName: "Product Notes", SenderID: int64(ProductChat), Body: body,
		SentAt: at, Status: tg.StatusRead, Views: 1840 + int(id)*13, CanForward: true}
	m.IsolatedEmoji = tg.IsolatedEmojiCount(body)
	return m
}

func seedMessages(files *assets) map[tg.ChatID][]tg.Message {
	design := []tg.Message{}
	d1 := msg(DesignChat, 1, Mina, "The conversation list should stay compact at desktop widths.", ago(108*time.Minute))
	d1.Entities = []tg.Entity{{Type: tg.EntityBold, Offset: 34, Length: 7}}
	d1.Reactions = []tg.Reaction{{Emoji: "👍", Count: 2, Chosen: true}, {Emoji: "🎉", Count: 1}}
	d1.Pinned = true
	design = append(design, d1)
	d2 := msg(DesignChat, 2, AccountID, "Agreed. Keep the composer anchored and let only the message list scroll.", ago(102*time.Minute))
	d2.ReplyTo = &tg.ReplyTo{ID: 1, SenderName: "Mina", Body: d1.Body}
	design = append(design, d2)
	poll := msg(DesignChat, 3, Priya, "", ago(100*time.Minute))
	poll.Poll = &tg.Poll{ID: 1, Question: "Which surfaces should the poll card reach first?", Anonymous: true, MultipleAnswers: true, Kind: tg.PollRegular, TotalVoterCount: 3,
		Options: []tg.PollOption{{Text: "Transcript", VoterCount: 2, Percentage: 67}, {Text: "Chat list preview", VoterCount: 1, Percentage: 33}, {Text: "Agent context"}}}
	design = append(design, poll)
	quiz := msg(DesignChat, 4, Aron, "", ago(98*time.Minute))
	quiz.Poll = &tg.Poll{ID: 2, Question: "Which client reveals a quiz answer only after voting?", Kind: tg.PollQuiz,
		Options: []tg.PollOption{{Text: "Telegram Web"}, {Text: "Telegram Desktop"}}, Explanation: "Both do: TDLib sends the correct option after a vote."}
	design = append(design, quiz)
	closed := msg(DesignChat, 5, Lev, "", ago(96*time.Minute))
	closed.Poll = &tg.Poll{ID: 3, Question: "Ship the poll card this cycle?", Closed: true, Kind: tg.PollRegular, TotalVoterCount: 5,
		Options: []tg.PollOption{{Text: "Yes", VoterCount: 4, Percentage: 80, Chosen: true}, {Text: "No", VoterCount: 1, Percentage: 20}}}
	design = append(design, closed)
	link := msg(DesignChat, 6, Aron, "This write-up nails the spacing rules: https://example.com/spacing-craft", ago(94*time.Minute))
	link.Entities = []tg.Entity{{Type: tg.EntityURL, Offset: 39, Length: 33}}
	link.Media = &tg.Media{Kind: tg.MediaWebPage, WebPage: &tg.WebPage{URL: "https://example.com/spacing-craft", DisplayURL: "example.com/spacing-craft",
		SiteName: "Example Journal", Title: "Spacing is a system, not a vibe", Description: "Why consistent rhythm beats one-off tweaks in dense desktop interfaces."}}
	design = append(design, link)
	photo := msg(DesignChat, 7, Aron, "", ago(93*time.Minute))
	photo.Media = files.photo("telo-hero.png", 640, 480, 0)
	design = append(design, photo)
	for i, name := range []string{"telo-album-one.png", "telo-album-two.png", "telo-album-three.png"} {
		body := ""
		if i == 0 {
			body = "Reference shots for the viewer work."
		}
		m := msg(DesignChat, tg.MessageID(8+i), Aron, body, ago(92*time.Minute))
		m.Media, m.AlbumID = files.photo(name, 640, 480, i+1), 77
		design = append(design, m)
	}
	file := msg(DesignChat, 11, Mina, "Spacing tokens, as promised.", ago(91*time.Minute))
	file.Media = files.document("spacing-tokens.pdf", "application/pdf", 248_320)
	design = append(design, file)
	voice := msg(DesignChat, 12, Lev, "", ago(90*time.Minute))
	voice.Media = files.voice(14 * time.Second)
	design = append(design, voice)
	forwarded := msg(DesignChat, 13, Lev, "Changelog: chat folders now sync both ways.", ago(89*time.Minute))
	forwarded.Forward = &tg.Forward{SenderName: "Product Notes", SenderID: int64(ProductChat), MessageID: 1}
	design = append(design, forwarded)
	// Everything past the read boundary is unread: three messages, the
	// chat's unread count.
	design = append(design,
		msg(DesignChat, 14, Lev, "The retry flow needs a failed state in the transcript.", ago(92*time.Minute)),
		mention(msg(DesignChat, 15, Lev, "And the unread divider has to survive paging, @you.", ago(90*time.Minute))),
		msg(DesignChat, 16, Lev, "Ship both with the next build.", ago(88*time.Minute)),
	)
	design[len(design)-1].Pinned = true

	product := []tg.Message{
		channelPost(1, "Agent context is ready for review.", ago(29*time.Hour)),
	}
	sticker := channelPost(2, "", ago(28*time.Hour))
	sticker.Media = files.sticker("👋", tg.StickerStatic)
	product = append(product, sticker)
	animated := channelPost(3, "🎉", ago(27*time.Hour))
	animated.Media = files.sticker("🎉", tg.StickerAnimated)
	animated.Media.Sticker.Role = tg.RoleEmoji
	animated.IsolatedEmoji = 1
	product = append(product, animated)
	custom := channelPost(4, "Shipping 🎉", ago(26*time.Hour))
	custom.Entities = []tg.Entity{{Type: tg.EntityCustomEmoji, Offset: 9, Length: 2, CustomEmojiID: 9002}}
	product = append(product, custom, channelPost(5, "🚀🌘", ago(25*time.Hour)))
	formatted := channelPost(6, "Release notes: bold, italic, code, spoiler and a link.", ago(24*time.Hour+30*time.Minute))
	formatted.Entities = []tg.Entity{
		{Type: tg.EntityBold, Offset: 15, Length: 4}, {Type: tg.EntityItalic, Offset: 21, Length: 6},
		{Type: tg.EntityCode, Offset: 29, Length: 4}, {Type: tg.EntitySpoiler, Offset: 35, Length: 7},
		{Type: tg.EntityTextLink, Offset: 49, Length: 4, URL: "https://telegram.org"},
	}
	product = append(product, formatted)

	bot := msg(BotChat, 1, Bot, "Telo Bot is watching this repository.", ago(80*time.Hour+5*time.Minute))
	bot.Keyboard = &tg.Keyboard{Rows: [][]tg.Button{{{ID: "0:0", Text: "Open dashboard", Kind: tg.ButtonCallback}, {ID: "0:1", Text: "Ping", Kind: tg.ButtonCallback}}}}
	bot2 := msg(BotChat, 2, Bot, "Build 482 finished: 12 tests, 0 failures.", ago(80*time.Hour))
	bot2.Keyboard = &tg.Keyboard{Rows: [][]tg.Button{
		{{ID: "0:0", Text: "Approve deploy", Kind: tg.ButtonCallback}, {ID: "0:1", Text: "Watch builds", Kind: tg.ButtonCallback}},
		{{ID: "1:0", Text: "Open logs", Kind: tg.ButtonURL, URL: "https://example.com/telo-bot/build/482"}, {ID: "1:1", Text: "Copy build id", Kind: tg.ButtonCopy, CopyText: "build-482"}, {ID: "1:2", Text: "Play", Kind: tg.ButtonUnsupported}},
	}}

	call := func(id tg.MessageID, from tg.UserID, at time.Time, c tg.MessageCall) tg.Message {
		m := msg(MinaChat, id, from, "", at)
		m.Call = &c
		return m
	}
	mina := []tg.Message{
		call(1, AccountID, ago(94*time.Hour+50*time.Minute), tg.MessageCall{Status: tg.CallOutgoing, Duration: 65 * time.Second}),
		call(2, Mina, ago(94*time.Hour+35*time.Minute), tg.MessageCall{Status: tg.CallMissed}),
		call(3, AccountID, ago(94*time.Hour+15*time.Minute), tg.MessageCall{Status: tg.CallCancelled, Video: true}),
		msg(MinaChat, 4, Mina, "Ship both with the next build.", ago(94*time.Hour)),
	}
	saved := msg(SavedChat, 1, AccountID, "Release checklist: tests, docs, signed packages.", ago(18*time.Minute))
	return map[tg.ChatID][]tg.Message{
		SavedChat:   {saved},
		DesignChat:  design,
		ProductChat: product,
		OffsiteChat: {msg(OffsiteChat, 1, Priya, "Venue shortlist attached.", ago(55*time.Hour)), msg(OffsiteChat, 2, Priya, "Book the venue before Friday.", ago(54*time.Hour))},
		BotChat:     {bot, bot2},
		MinaChat:    mina,
		AronChat:    {msg(AronChat, 1, Aron, "Send over the spacing tokens when ready.", ago(94*time.Hour+10*time.Minute))},
		SecretChat:  {msg(SecretChat, 1, Mina, "This chat is end-to-end encrypted.", ago(94*time.Hour+20*time.Minute))},
	}
}

func mention(m tg.Message) tg.Message {
	m.Entities = append(m.Entities, tg.Entity{Type: tg.EntityMention, Offset: tg.UTF16Len(m.Body) - 5, Length: 4})
	return m
}

// lastRead is each chat's read boundary, which places the unread divider.
var lastRead = map[tg.ChatID]tg.MessageID{DesignChat: 13, OffsiteChat: 0}

var availableReactions = []string{"👍", "👎", "❤️", "🔥", "🎉", "😁", "🤔", "😢"}

func seedSessions() []tg.Session {
	return []tg.Session{
		{ID: 1, Current: true, Application: "Telo", Version: "0.1.0", Device: "Desktop", Platform: "macOS", SystemVersion: "15.4", IP: "203.0.113.4", Location: "Lisbon, Portugal", LastActive: Base, LoggedIn: ago(40 * 24 * time.Hour)},
		{ID: 2, Application: "Telegram iOS", Version: "11.9", Device: "iPhone 16", Platform: "iOS", SystemVersion: "18.6", IP: "198.51.100.7", Location: "Lisbon, Portugal", LastActive: ago(2 * time.Hour), LoggedIn: ago(200 * 24 * time.Hour), Official: true},
		{ID: 3, Application: "Telegram Web K", Version: "2.2", Device: "Chrome 140", Platform: "Web", SystemVersion: "macOS", IP: "192.0.2.12", Location: "Porto, Portugal", LastActive: ago(9 * 24 * time.Hour), LoggedIn: ago(30 * 24 * time.Hour), Official: true},
	}
}
