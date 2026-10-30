// Package telegram is Telo's Telegram vocabulary: chats, messages, media,
// folders, contacts and the repository port adapters implement. It has no
// dependency on TDLib or the UI; infrastructure maps TDLib objects onto
// these types and the UI renders them.
package telegram

import "time"

// ChatID identifies a chat (TDLib int53).
type ChatID int64

// MessageID identifies a message within its chat (TDLib int53).
type MessageID int64

// UserID identifies a user (TDLib int53).
type UserID int64

// FileID identifies a file TDLib knows (TDLib int32).
type FileID int32

// ArchiveFolderID is the reserved folder id of the Archive chat list.
const ArchiveFolderID = 1

// ChatKind is the shape of a chat.
type ChatKind string

const (
	ChatDirect  ChatKind = "direct"
	ChatGroup   ChatKind = "group"
	ChatChannel ChatKind = "channel"
	ChatSaved   ChatKind = "saved"
	ChatSecret  ChatKind = "secret"
)

// SecretState is a secret chat's handshake.
type SecretState string

const (
	SecretPending SecretState = "pending"
	SecretReady   SecretState = "ready"
	SecretClosed  SecretState = "closed"
)

// AvatarPlaceholder is TDLib's empty userpic: one grapheme on the peer's
// accent colors (CSS hex), painted when there is no photo.
type AvatarPlaceholder struct {
	Glyph       string
	LightColors []string
	DarkColors  []string
}

// Avatar is a peer's picture as far as it is known. Path is a cached file
// once downloaded; Minithumbnail is TDLib's tiny JPEG preview, painted
// while the download runs. Pending is true until the photo settles.
type Avatar struct {
	Path          string
	Minithumbnail []byte
	Pending       bool
	Placeholder   *AvatarPlaceholder
}

// Chat is one dialog of the chat list.
type Chat struct {
	ID      ChatID
	Title   string
	Preview string
	// LastMessage is the message Preview comes from, for the list to say
	// what kind it is (a photo, a poll, a member joining); nil when the
	// adapter only knows the text.
	LastMessage *Message
	UpdatedAt   time.Time
	UnreadCount int
	// UnreadMentions counts unread messages mentioning the account.
	UnreadMentions int
	// LastReadMessageID positions the unread divider; 0 when unknown.
	LastReadMessageID MessageID
	// LastReadOutboxID is the newest outgoing message the peer read.
	LastReadOutboxID MessageID
	Muted            bool
	Pinned           bool
	MarkedUnread     bool
	Kind             ChatKind
	// CanSendMessages, CanSendStickers and CanSendMedia follow the
	// account's member status and the chat's permissions.
	CanSendMessages bool
	CanSendStickers bool
	CanSendMedia    bool
	// CanDeleteForAll tells whether history can be deleted for everyone.
	CanDeleteForAll bool
	Initials        string
	Avatar          Avatar
	// DraftPreview is the server-synced draft, empty when none.
	DraftPreview string
	Typing       bool
	// Online is the peer's presence in a direct chat.
	Online bool
	// FolderID is ArchiveFolderID for archived chats, a custom folder id,
	// or 0 for the main list outside folders.
	FolderID int
	// FolderIDs lists every custom folder the chat appears in.
	FolderIDs []int
	// KeywordFolderIDs are the local keyword folders it matches (negative).
	KeywordFolderIDs []int
	// ListOrder is TDLib chatPosition.order; higher sorts first.
	ListOrder   int64
	SecretState SecretState
	// UserID is the peer of a direct or secret chat.
	UserID UserID
	// MemberCount is the size of a group or channel when known.
	MemberCount int
	// AutoDeleteSeconds is the chat's message auto-delete timer.
	AutoDeleteSeconds int
	// Blocked tells whether the peer of a direct chat is blocked.
	Blocked bool
}

// CanSend reports whether the account may send kind to the chat.
func (c Chat) CanSend(kind ContentKind) bool {
	switch kind {
	case ContentText:
		return c.CanSendMessages
	case ContentStickers:
		return c.CanSendStickers
	case ContentMedia:
		return c.CanSendMedia
	}
	return c.CanSendMessages || c.CanSendStickers || c.CanSendMedia
}

// ContentKind is a class of content a chat may forbid.
type ContentKind string

const (
	ContentText     ContentKind = "text"
	ContentStickers ContentKind = "stickers"
	ContentMedia    ContentKind = "media"
	ContentAny      ContentKind = "any"
)

// FolderKind tells Telegram folders from local keyword folders.
type FolderKind string

const (
	FolderNative  FolderKind = "native"
	FolderKeyword FolderKind = "keyword"
)

// Folder is a chat-list tab: a Telegram folder, the Archive or a keyword
// folder (negative id).
type Folder struct {
	ID          int
	Title       string
	UnreadCount int
	Kind        FolderKind
	// Query is a keyword folder's case-insensitive search term.
	Query string
}

// FolderInput creates or edits a Telegram folder: its name and the chats
// it always includes.
type FolderInput struct {
	Title   string
	ChatIDs []ChatID
}

// FolderDetails is a Telegram folder's edit state.
type FolderDetails struct {
	ID              int
	Title           string
	IncludedChatIDs []ChatID
	// IncludeContacts and the flags after it are the folder's filters.
	IncludeContacts    bool
	IncludeNonContacts bool
	IncludeGroups      bool
	IncludeChannels    bool
	IncludeBots        bool
	ExcludeMuted       bool
	ExcludeRead        bool
	ExcludeArchived    bool
}

// ChatPage is a page of the chat list. Cursor is opaque to callers.
type ChatPage struct {
	Items      []Chat
	NextCursor string
}

// Member is a member of a group, for mentions and the member list.
type Member struct {
	ID          UserID
	DisplayName string
	Username    string
	Avatar      Avatar
	// Role is "creator", "administrator", "member" or "restricted".
	Role   string
	Online bool
}

// CreateGroupInput creates a basic group.
type CreateGroupInput struct {
	Title   string
	UserIDs []UserID
}

// CreateChannelInput creates a channel.
type CreateChannelInput struct {
	Title       string
	Description string
}

// builtInAccents are Telegram's seven built-in peer colors (accent ids
// 0–6), light and dark gradient stops of the empty userpic.
var builtInAccents = [7][2]string{
	{"#E17076", "#FF885E"}, {"#FAA774", "#FFCD6A"}, {"#A695E7", "#BFA0F3"}, {"#7BC862", "#6EC96C"},
	{"#6EC9CB", "#53D4D4"}, {"#65AADD", "#54B3F0"}, {"#EE7AAE", "#F58FB7"},
}

// Placeholder is the empty userpic of title on built-in accent id; ids
// past the built-in set wrap, as Telegram's fallback does.
func Placeholder(title string, accentID int) *AvatarPlaceholder {
	c := builtInAccents[((accentID%7)+7)%7]
	glyph := FirstGrapheme(title)
	if glyph == "" {
		glyph = "?"
	}
	return &AvatarPlaceholder{Glyph: glyph, LightColors: []string{c[0], c[1]}, DarkColors: []string{c[0], c[1]}}
}
