package telegram

import "time"

// EntityType is a formatting span's kind, as TDLib textEntityType names it.
type EntityType string

const (
	EntityMention       EntityType = "mention"
	EntityHashtag       EntityType = "hashtag"
	EntityCashtag       EntityType = "cashtag"
	EntityBotCommand    EntityType = "bot-command"
	EntityURL           EntityType = "url"
	EntityEmail         EntityType = "email"
	EntityPhone         EntityType = "phone"
	EntityBankCard      EntityType = "bank-card"
	EntityBold          EntityType = "bold"
	EntityItalic        EntityType = "italic"
	EntityUnderline     EntityType = "underline"
	EntityStrikethrough EntityType = "strikethrough"
	EntitySpoiler       EntityType = "spoiler"
	EntityCode          EntityType = "code"
	EntityPre           EntityType = "pre"
	EntityBlockquote    EntityType = "blockquote"
	EntityTextLink      EntityType = "text-link"
	EntityTextMention   EntityType = "text-mention"
	EntityCustomEmoji   EntityType = "custom-emoji"
)

// Entity is a formatting span over a message body. Offset and Length are
// UTF-16 code units, as Telegram counts them.
type Entity struct {
	Type   EntityType
	Offset int
	Length int
	// Language of a pre block.
	Language string
	// URL of a text link.
	URL string
	// UserID of a text mention.
	UserID UserID
	// CustomEmojiID of a custom emoji.
	CustomEmojiID int64
	// Collapsed blockquotes show their first lines.
	Collapsed bool
}

// ReplyTo is a snapshot of the message a message answers.
type ReplyTo struct {
	ID         MessageID
	SenderName string
	Body       string
	Entities   []Entity
	// Quote is the part of the message the reply quotes, when it does.
	Quote string
}

// MediaKind is what a message's file is.
type MediaKind string

const (
	MediaPhoto     MediaKind = "photo"
	MediaVideo     MediaKind = "video"
	MediaFile      MediaKind = "file"
	MediaAudio     MediaKind = "audio"
	MediaVoice     MediaKind = "voice"
	MediaVideoNote MediaKind = "video-note"
	MediaAnimation MediaKind = "animation"
	MediaSticker   MediaKind = "sticker"
	MediaWebPage   MediaKind = "webpage"
	MediaLocation  MediaKind = "location"
	MediaContact   MediaKind = "contact"
)

// Media is the one attachment a message carries. Files are referenced by
// FileID; Path is the local file once downloaded.
type Media struct {
	Kind     MediaKind
	FileID   FileID
	Path     string
	FileName string
	MIMEType string
	Size     int64
	Width    int
	Height   int
	Duration time.Duration
	Spoiler  bool
	// Minithumbnail is TDLib's blurred JPEG preview.
	Minithumbnail []byte
	// ThumbnailFileID is a small rendition, downloaded before the file.
	ThumbnailFileID FileID
	ThumbnailPath   string
	// Waveform is a voice note's level samples (5 bits each, TDLib packing).
	Waveform []byte
	// Performer and Title describe an audio file.
	Performer string
	Title     string
	Sticker   *MessageSticker
	WebPage   *WebPage
	Location  *Location
	Contact   *SharedContact
}

// WebPage is a link preview.
type WebPage struct {
	URL         string
	DisplayURL  string
	SiteName    string
	Title       string
	Description string
	// Photo is the preview's picture, when it has one.
	Photo *Media
}

// Location is a shared point, venues carrying a title and address.
type Location struct {
	Latitude, Longitude float64
	Title, Address      string
}

// SharedContact is a contact card in a message.
type SharedContact struct {
	Name   string
	Phone  string
	UserID UserID
}

// ButtonKind is what an inline keyboard button does.
type ButtonKind string

const (
	ButtonCallback    ButtonKind = "callback"
	ButtonURL         ButtonKind = "url"
	ButtonCopy        ButtonKind = "copy"
	ButtonUnsupported ButtonKind = "unsupported"
)

// Button is one inline keyboard button. ID addresses a callback button.
type Button struct {
	ID       string
	Text     string
	Kind     ButtonKind
	URL      string
	CopyText string
}

// Keyboard is an inline keyboard, as rows of buttons.
type Keyboard struct{ Rows [][]Button }

// CallbackAnswer is a bot's answer to a callback button.
type CallbackAnswer struct {
	Text  string
	Alert bool
	URL   string
}

// Forward describes where a forwarded message came from.
type Forward struct {
	SenderName string
	SenderID   int64
	MessageID  MessageID
	PostAuthor string
}

// Reaction is one emoji's tally on a message.
type Reaction struct {
	Emoji  string
	Count  int
	Chosen bool
}

// MessageStatus is the delivery state of a message.
type MessageStatus string

const (
	StatusSending MessageStatus = "sending"
	StatusSent    MessageStatus = "sent"
	StatusRead    MessageStatus = "read"
	StatusFailed  MessageStatus = "failed"
)

// ServiceKind marks a service message (a member joined, the title
// changed); empty for ordinary messages.
type ServiceKind string

const (
	ServiceNone           ServiceKind = ""
	ServiceChatCreated    ServiceKind = "chat-created"
	ServiceTitleChanged   ServiceKind = "title-changed"
	ServicePhotoChanged   ServiceKind = "photo-changed"
	ServiceMembersAdded   ServiceKind = "members-added"
	ServiceMemberJoined   ServiceKind = "member-joined"
	ServiceMemberLeft     ServiceKind = "member-left"
	ServicePinned         ServiceKind = "pinned"
	ServiceScreenshot     ServiceKind = "screenshot"
	ServiceAutoDelete     ServiceKind = "auto-delete"
	ServiceJoinedTelegram ServiceKind = "joined-telegram"
	ServiceCustom         ServiceKind = "custom"
)

// Message is one message of a transcript.
type Message struct {
	ID         MessageID
	ChatID     ChatID
	SenderName string
	SenderID   int64
	// SenderAvatar is the sender's picture in groups.
	SenderAvatar Avatar
	Body         string
	Entities     []Entity
	// IsolatedEmoji counts the emoji of an emoji-only text (1–3), drawn
	// larger; 0 otherwise.
	IsolatedEmoji int
	Media         *Media
	// AlbumID groups the messages of one album.
	AlbumID  int64
	SentAt   time.Time
	Outgoing bool
	Status   MessageStatus
	ReplyTo  *ReplyTo
	EditedAt time.Time
	// ClientID is the optimistic id the sender minted, kept until the
	// server message replaces it.
	ClientID  string
	Forward   *Forward
	Pinned    bool
	Keyboard  *Keyboard
	Reactions []Reaction
	Call      *MessageCall
	Poll      *Poll
	// ScheduledAt is set on scheduled messages.
	ScheduledAt time.Time
	Service     ServiceKind
	// Views counts channel post views.
	Views int
	// CanEdit and the flags after it are what TDLib allows on the message.
	CanEdit         bool
	CanDeleteForAll bool
	CanForward      bool
	// Unsupported marks content this build does not render.
	Unsupported bool
}

// Pending tells an optimistic message that has no server id yet.
func (m Message) Pending() bool { return m.Status == StatusSending || m.ID <= 0 }

// MessagePage is a page of a transcript, newest first; NextCursor pages
// older messages.
type MessagePage struct {
	Items      []Message
	NextCursor MessageID
}

// GlobalSearchResult answers a search across chats.
type GlobalSearchResult struct {
	Chats    []Chat
	Messages []Message
}

// SearchPage is one page of in-chat search hits.
type SearchPage struct {
	MessageIDs []MessageID
	TotalCount int
	NextCursor MessageID
}

// SendOptions qualify an outgoing message.
type SendOptions struct {
	ReplyTo  MessageID
	ClientID string
	// Silent sends without a notification sound.
	Silent bool
	// SendAt schedules the message; zero sends now.
	SendAt   time.Time
	Entities []Entity
}

// DeleteScope chooses who loses a deleted message.
type DeleteScope string

const (
	DeleteForMe       DeleteScope = "me"
	DeleteForEveryone DeleteScope = "everyone"
)

// UploadFile is a local file to send.
type UploadFile struct {
	Path     string
	Name     string
	MIMEType string
	Size     int64
	// Voice marks a recorded voice note of Duration.
	Voice    bool
	Duration time.Duration
}

// MediaDownload is progress of a file download.
type MediaDownload struct {
	FileID     FileID
	State      TransferState
	Downloaded int64
	Total      int64
	Path       string
	Err        string
}

// TransferState is where a download or upload is.
type TransferState string

const (
	TransferRunning   TransferState = "running"
	TransferDone      TransferState = "done"
	TransferCancelled TransferState = "cancelled"
	TransferFailed    TransferState = "failed"
)

// Upload limits, as Telegram enforces them.
const (
	MaxAlbumFiles     = 10
	MaxUploadBytes    = 2 << 30
	StoryPhotoMaxSize = 10 << 20
)
