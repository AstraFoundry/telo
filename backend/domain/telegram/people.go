package telegram

import "time"

// CurrentUser is the signed-in account.
type CurrentUser struct {
	ID          UserID
	DisplayName string
	FirstName   string
	LastName    string
	Username    string
	Bio         string
	Phone       string
	Initials    string
	Avatar      Avatar
}

// ProfileName edits the account's name.
type ProfileName struct{ FirstName, LastName string }

// UsernameAvailability answers a username check.
type UsernameAvailability string

const (
	UsernameAvailable UsernameAvailability = "available"
	UsernameInvalid   UsernameAvailability = "invalid"
	UsernameTaken     UsernameAvailability = "taken"
	UsernameUnknown   UsernameAvailability = "unknown"
)

// PeerProfile is the profile side panel of a chat or user.
type PeerProfile struct {
	ChatID    ChatID
	UserID    UserID
	Title     string
	Username  string
	Kind      ChatKind
	Avatar    Avatar
	IsContact bool
	// NeedPhonePrivacyException offers to share the account's phone when
	// adding the peer as a contact.
	NeedPhonePrivacyException bool
	Bio                       string
	Phone                     string
	// LastSeen is the peer's presence, as text-free state.
	Online   bool
	LastSeen time.Time
	// MemberCount sizes groups and channels.
	MemberCount int
	// Description is a group's or channel's about text.
	Description string
	// InviteLink is the group's or channel's primary link, if visible.
	InviteLink string
	Blocked    bool
	// CommonGroups counts groups shared with a user.
	CommonGroups int
}

// Contact is a Telegram contact.
type Contact struct {
	ID          UserID
	DisplayName string
	Username    string
	Phone       string
	Avatar      Avatar
	Online      bool
}

// ContactByPhone imports a contact from a phone number.
type ContactByPhone struct{ FirstName, LastName, Phone string }

// PeerContact adds or renames a user as a contact.
type PeerContact struct {
	UserID           UserID
	FirstName        string
	LastName         string
	SharePhoneNumber bool
}

// CallStatus is how a call message ended.
type CallStatus string

const (
	CallOutgoing  CallStatus = "outgoing"
	CallIncoming  CallStatus = "incoming"
	CallMissed    CallStatus = "missed"
	CallDeclined  CallStatus = "declined"
	CallCancelled CallStatus = "cancelled"
	CallGroup     CallStatus = "group"
)

// MessageCall is a call drawn as a static card in a transcript.
type MessageCall struct {
	Video    bool
	Status   CallStatus
	Duration time.Duration
	Active   bool
}

// CallRecord is one row of the call history.
type CallRecord struct {
	ChatID     ChatID
	MessageID  MessageID
	Title      string
	Avatar     Avatar
	Status     CallStatus
	Video      bool
	OccurredAt time.Time
	Duration   time.Duration
}

// CallPage is a page of call history.
type CallPage struct {
	Items      []CallRecord
	NextCursor string
}

// PollKind is a poll's type.
type PollKind string

const (
	PollRegular PollKind = "regular"
	PollQuiz    PollKind = "quiz"
)

// Poll limits.
const (
	PollOptionsMin = 2
	PollOptionsMax = 10
)

// PollOption is one answer of a poll.
type PollOption struct {
	Text       string
	VoterCount int
	Percentage int
	Chosen     bool
}

// Poll is a poll message.
type Poll struct {
	ID               int64
	Question         string
	Options          []PollOption
	TotalVoterCount  int
	Anonymous        bool
	Closed           bool
	Kind             PollKind
	MultipleAnswers  bool
	CorrectOptionIDs []int
	Explanation      string
}

// PollInput creates a poll.
type PollInput struct {
	Question        string
	Options         []string
	Anonymous       bool
	Kind            PollKind
	MultipleAnswers bool
	CorrectOption   int
}

// StoryPrivacy is who sees a posted story.
type StoryPrivacy string

const (
	StoryEveryone     StoryPrivacy = "everyone"
	StoryContacts     StoryPrivacy = "contacts"
	StoryCloseFriends StoryPrivacy = "close-friends"
)

// StoryActivePeriods are the periods Telegram offers, in seconds.
var StoryActivePeriods = []int{6 * 3600, 12 * 3600, 24 * 3600, 48 * 3600}

// StoryInput posts a story.
type StoryInput struct {
	Caption        string
	Privacy        StoryPrivacy
	ActivePeriod   int
	ProtectContent bool
	Duration       time.Duration
}

// PostedStory confirms a posted story.
type PostedStory struct {
	ID        int32
	PostedAt  time.Time
	ExpiresAt time.Time
	Video     bool
}

// StickerFormat is how a sticker is encoded.
type StickerFormat string

const (
	StickerStatic   StickerFormat = "static"
	StickerAnimated StickerFormat = "animated"
	StickerVideo    StickerFormat = "video"
)

// StickerRole tells a sticker from an animated emoji standing in for a
// typed character.
type StickerRole string

const (
	RoleSticker StickerRole = "sticker"
	RoleEmoji   StickerRole = "emoji"
)

// MessageSticker describes a sticker inside a message.
type MessageSticker struct {
	Emoji  string
	Role   StickerRole
	Format StickerFormat
	SetID  int64
	// OutlinePath is the SVG path TDLib gives for the sticker's outline,
	// drawn while the file loads.
	OutlinePath string
}

// Sticker is a sticker of a pack, recents or favorites.
type Sticker struct {
	ID            int64
	FileID        FileID
	Path          string
	ThumbnailPath string
	Emoji         string
	Format        StickerFormat
	Width         int
	Height        int
	SetID         int64
}

// StickerSetSummary is an installed pack's metadata.
type StickerSetSummary struct {
	ID        int64
	Title     string
	ShortName string
	Thumbnail *Sticker
	// Archived packs are installed but hidden from the panel.
	Archived bool
}

// StickerSet is a pack with its stickers.
type StickerSet struct {
	StickerSetSummary
	Stickers  []Sticker
	Installed bool
}

// StickerCatalog is the panel's account-scoped catalog.
type StickerCatalog struct {
	Recent    []Sticker
	Favorites []Sticker
	Sets      []StickerSetSummary
}

// AnimatedEmojiEffect is the burst Telegram plays over a clicked emoji.
type AnimatedEmojiEffect struct {
	ChatID    ChatID
	MessageID MessageID
	Sticker   Sticker
}
