package telegram

import "time"

// MaxAccounts is Telegram's free-tier limit of signed-in accounts.
const MaxAccounts = 3

// AccountID names a signed-in account's local storage.
type AccountID string

// AccountRecord is a row of the account switcher.
type AccountRecord struct {
	ID           AccountID
	UserID       UserID
	DisplayName  string
	Username     string
	Avatar       Avatar
	UnreadCount  int
	CreatedAt    time.Time
	LastActiveAt time.Time
}

// AccountRegistry is the switcher's persisted list.
type AccountRegistry struct {
	Accounts []AccountRecord
	Active   AccountID
}

// AuthStep is where sign-in stands.
type AuthStep string

const (
	AuthIdle          AuthStep = "idle"
	AuthStarting      AuthStep = "starting"
	AuthWaitPhone     AuthStep = "wait-phone"
	AuthWaitCode      AuthStep = "wait-code"
	AuthWaitPassword  AuthStep = "wait-password"
	AuthWaitEmail     AuthStep = "wait-email"
	AuthWaitRegister  AuthStep = "wait-registration"
	AuthWaitQR        AuthStep = "wait-qr"
	AuthRestoring     AuthStep = "restoring"
	AuthReady         AuthStep = "ready"
	AuthLoggingOut    AuthStep = "logging-out"
	AuthNotConfigured AuthStep = "not-configured"
)

// AuthState is the sign-in flow's state.
type AuthState struct {
	Step AuthStep
	// Phone is the number the code was sent to.
	Phone string
	// CodeLength and CodeVia describe the sent code ("app", "sms", "call").
	CodeLength int
	CodeVia    string
	// PasswordHint is the 2FA hint.
	PasswordHint string
	// QRLink is the tg://login link a phone scans.
	QRLink string
	// Error is the last rejected step's message key, empty when none.
	Error string
}

// ConnectionState is the network state Telegram reports.
type ConnectionState string

const (
	ConnectionOffline       ConnectionState = "offline"
	ConnectionConnecting    ConnectionState = "connecting"
	ConnectionProxy         ConnectionState = "connecting-to-proxy"
	ConnectionSynchronizing ConnectionState = "synchronizing"
	ConnectionReady         ConnectionState = "ready"
)

// Session is one active sign-in of the account (Settings › Active
// Sessions).
type Session struct {
	ID            int64
	Current       bool
	Application   string
	Version       string
	Device        string
	Platform      string
	SystemVersion string
	IP            string
	Location      string
	LastActive    time.Time
	LoggedIn      time.Time
	// Official tells a Telegram-made client.
	Official bool
}

// PrivacyKey is one privacy setting of Privacy and Security.
type PrivacyKey string

const (
	PrivacyLastSeen     PrivacyKey = "last-seen"
	PrivacyProfilePhoto PrivacyKey = "profile-photo"
	PrivacyForwards     PrivacyKey = "forwards"
	PrivacyCalls        PrivacyKey = "calls"
	PrivacyGroupInvites PrivacyKey = "group-invites"
	PrivacyPhoneNumber  PrivacyKey = "phone-number"
	PrivacyBio          PrivacyKey = "bio"
	PrivacyVoiceNotes   PrivacyKey = "voice-notes"
)

// PrivacyKeys lists the settings in the order Telegram shows them.
var PrivacyKeys = []PrivacyKey{PrivacyPhoneNumber, PrivacyLastSeen, PrivacyProfilePhoto, PrivacyBio, PrivacyForwards, PrivacyCalls, PrivacyVoiceNotes, PrivacyGroupInvites}

// Audience is the base rule of a privacy setting.
type Audience string

const (
	AudienceEveryone Audience = "everyone"
	AudienceContacts Audience = "contacts"
	AudienceNobody   Audience = "nobody"
)

// PrivacyRule is a setting's audience with its exceptions.
type PrivacyRule struct {
	Audience Audience
	// Allow and Deny are user exceptions to the audience.
	Allow []UserID
	Deny  []UserID
}

// BlockedPeer is a blocked user or chat.
type BlockedPeer struct {
	ID     int64
	Title  string
	Avatar Avatar
}

// ProxyKind is a proxy's protocol.
type ProxyKind string

const (
	ProxySOCKS5  ProxyKind = "socks5"
	ProxyHTTP    ProxyKind = "http"
	ProxyMTProto ProxyKind = "mtproto"
)

// Proxy is a configured proxy server.
type Proxy struct {
	ID       int32
	Server   string
	Port     int32
	Kind     ProxyKind
	Username string
	Password string
	Secret   string
	Enabled  bool
	// LastUsed is when the proxy last carried traffic.
	LastUsed time.Time
}

// StorageUsage is the media cache's breakdown.
type StorageUsage struct {
	TotalBytes int64
	FileCount  int
	ByKind     map[MediaKind]int64
}

// NetworkUsage counts traffic since the last reset.
type NetworkUsage struct {
	Since    time.Time
	Sent     int64
	Received int64
}

// NotificationScope is a Telegram scope of notification defaults.
type NotificationScope string

const (
	ScopePrivate  NotificationScope = "private"
	ScopeGroups   NotificationScope = "groups"
	ScopeChannels NotificationScope = "channels"
)

// ScopeSettings are a scope's server-side notification defaults.
type ScopeSettings struct {
	Muted       bool
	ShowPreview bool
}

// TwoStepState is the account's 2FA status.
type TwoStepState struct {
	Enabled          bool
	Hint             string
	RecoveryEmailSet bool
}

// Sign-in error codes carried by AuthState.Error; the UI words them.
const (
	AuthErrPhoneInvalid    = "phone-invalid"
	AuthErrCodeInvalid     = "code-invalid"
	AuthErrCodeExpired     = "code-expired"
	AuthErrPasswordInvalid = "password-invalid"
	AuthErrFlood           = "flood"
	AuthErrFailed          = "failed"
)
