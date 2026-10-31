package telegram

import (
	"context"
	"time"
)

// Repository is the active account's Telegram. The TDLib adapter and the
// demo workspace implement it; every call is safe from any goroutine.
type Repository interface {
	// Subscribe delivers events until the returned function is called.
	Subscribe(func(Event)) (unsubscribe func())

	CurrentUser(ctx context.Context) (CurrentUser, error)
	UpdateName(ctx context.Context, name ProfileName) (CurrentUser, error)
	UpdateBio(ctx context.Context, bio string) error
	CheckUsername(ctx context.Context, username string) (UsernameAvailability, error)
	SetUsername(ctx context.Context, username string) (CurrentUser, error)
	SetProfilePhoto(ctx context.Context, file UploadFile) (CurrentUser, error)

	ChatPage(ctx context.Context, cursor string, limit int) (ChatPage, error)
	Chat(ctx context.Context, id ChatID) (Chat, error)
	OpenChat(ctx context.Context, id ChatID, open bool) error
	OpenSavedMessages(ctx context.Context) (Chat, error)
	OpenPrivateChat(ctx context.Context, user UserID) (Chat, error)
	CreateSecretChat(ctx context.Context, user UserID) (Chat, error)
	CreateGroup(ctx context.Context, in CreateGroupInput) (Chat, error)
	CreateChannel(ctx context.Context, in CreateChannelInput) (Chat, error)
	SetChatPinned(ctx context.Context, id ChatID, pinned bool) error
	// MuteChat mutes for d; d of 0 unmutes, a negative d mutes forever.
	MuteChat(ctx context.Context, id ChatID, d time.Duration) error
	SetChatRead(ctx context.Context, id ChatID, read bool) error
	SetChatArchived(ctx context.Context, id ChatID, archived bool) error
	ClearHistory(ctx context.Context, id ChatID, forEveryone bool) error
	// LeaveChat leaves a group or channel, or deletes a direct chat.
	LeaveChat(ctx context.Context, id ChatID) error
	SetTyping(ctx context.Context, id ChatID, typing bool) error
	SaveDraft(ctx context.Context, id ChatID, text string) error
	SetAutoDelete(ctx context.Context, id ChatID, seconds int) error

	Folders(ctx context.Context) ([]Folder, error)
	FolderDetails(ctx context.Context, id int) (FolderDetails, error)
	CreateFolder(ctx context.Context, in FolderInput) (Folder, error)
	EditFolder(ctx context.Context, id int, in FolderInput) (Folder, error)
	DeleteFolder(ctx context.Context, id int) error
	AddChatToFolder(ctx context.Context, chat ChatID, folder int, add bool) error

	Messages(ctx context.Context, chat ChatID, before MessageID, limit int) (MessagePage, error)
	// MessagesAround loads a page centered on a message, for jumping to a
	// reply, a search hit or a date.
	MessagesAround(ctx context.Context, chat ChatID, around MessageID, limit int) (MessagePage, error)
	MessageAtDate(ctx context.Context, chat ChatID, at time.Time) (MessageID, error)
	SharedMedia(ctx context.Context, chat ChatID, kind MediaKind, before MessageID, limit int) (MessagePage, error)
	PinnedMessages(ctx context.Context, chat ChatID) ([]Message, error)
	ScheduledMessages(ctx context.Context, chat ChatID) ([]Message, error)
	Members(ctx context.Context, chat ChatID, query string) ([]Member, error)
	PeerProfile(ctx context.Context, chat ChatID) (PeerProfile, error)

	SendMessage(ctx context.Context, chat ChatID, body string, opts SendOptions) (Message, error)
	SendMedia(ctx context.Context, chat ChatID, files []UploadFile, caption string, opts SendOptions) ([]Message, error)
	SendSticker(ctx context.Context, chat ChatID, sticker Sticker, opts SendOptions) (Message, error)
	SendPoll(ctx context.Context, chat ChatID, poll PollInput, opts SendOptions) (Message, error)
	EditMessage(ctx context.Context, chat ChatID, id MessageID, body string, entities []Entity) error
	DeleteMessages(ctx context.Context, chat ChatID, ids []MessageID, scope DeleteScope) error
	ForwardMessages(ctx context.Context, from ChatID, ids []MessageID, to ChatID, hideSender bool) error
	PinMessage(ctx context.Context, chat ChatID, id MessageID, pinned, silent bool) error
	SendScheduledNow(ctx context.Context, chat ChatID, id MessageID) error
	Reschedule(ctx context.Context, chat ChatID, id MessageID, at time.Time) error
	MessageLink(ctx context.Context, chat ChatID, id MessageID) (string, error)
	SetReaction(ctx context.Context, chat ChatID, id MessageID, emoji string, chosen bool) error
	AvailableReactions(ctx context.Context, chat ChatID, id MessageID) ([]string, error)
	AnswerCallback(ctx context.Context, chat ChatID, id MessageID, button string) (CallbackAnswer, error)
	VotePoll(ctx context.Context, chat ChatID, id MessageID, options []int) error
	StopPoll(ctx context.Context, chat ChatID, id MessageID) error
	ClickAnimatedEmoji(ctx context.Context, chat ChatID, id MessageID) (*AnimatedEmojiEffect, error)
	Translate(ctx context.Context, chat ChatID, id MessageID, language string) (string, error)
	ViewMessages(ctx context.Context, chat ChatID, ids []MessageID) error

	SearchGlobal(ctx context.Context, query string) (GlobalSearchResult, error)
	SearchChat(ctx context.Context, chat ChatID, query string, before MessageID, limit int) (SearchPage, error)

	Download(ctx context.Context, file FileID) error
	CancelDownload(ctx context.Context, file FileID) error

	StickerCatalog(ctx context.Context) (StickerCatalog, error)
	StickerSet(ctx context.Context, id int64) (StickerSet, error)
	StickerSetByName(ctx context.Context, name string) (StickerSet, error)
	SearchStickers(ctx context.Context, emoji string) ([]Sticker, error)
	SetStickerSetInstalled(ctx context.Context, id int64, installed bool) error
	ReorderStickerSets(ctx context.Context, ids []int64) error
	SetStickerFavorite(ctx context.Context, sticker Sticker, favorite bool) error
	RemoveRecentSticker(ctx context.Context, sticker Sticker) error
	ClearRecentStickers(ctx context.Context) error
	TrendingStickerSets(ctx context.Context) ([]StickerSetSummary, error)
	ArchivedStickerSets(ctx context.Context) ([]StickerSetSummary, error)

	Contacts(ctx context.Context) ([]Contact, error)
	AddContactByPhone(ctx context.Context, in ContactByPhone) (*Contact, error)
	SetPeerContact(ctx context.Context, in PeerContact) error
	RemoveContact(ctx context.Context, user UserID) error
	SetBlocked(ctx context.Context, chat ChatID, blocked bool) error
	BlockedPeers(ctx context.Context) ([]BlockedPeer, error)
	ReportChat(ctx context.Context, chat ChatID, reason string) error

	Calls(ctx context.Context, cursor string) (CallPage, error)
	PostStory(ctx context.Context, file UploadFile, in StoryInput) (PostedStory, error)

	Sessions(ctx context.Context) ([]Session, error)
	TerminateSession(ctx context.Context, id int64) error
	TerminateOtherSessions(ctx context.Context) error
	Privacy(ctx context.Context, key PrivacyKey) (PrivacyRule, error)
	SetPrivacy(ctx context.Context, key PrivacyKey, rule PrivacyRule) error
	TwoStep(ctx context.Context) (TwoStepState, error)

	Proxies(ctx context.Context) ([]Proxy, error)
	AddProxy(ctx context.Context, p Proxy) (Proxy, error)
	EnableProxy(ctx context.Context, id int32, enabled bool) error
	RemoveProxy(ctx context.Context, id int32) error

	StorageUsage(ctx context.Context) (StorageUsage, error)
	ClearCache(ctx context.Context, kinds []MediaKind) error
	NetworkUsage(ctx context.Context) (NetworkUsage, error)
	ResetNetworkUsage(ctx context.Context) error

	ScopeSettings(ctx context.Context, scope NotificationScope) (ScopeSettings, error)
	SetScopeSettings(ctx context.Context, scope NotificationScope, s ScopeSettings) error
	ResetNotifications(ctx context.Context) error

	// ResolveLink opens a t.me or tg:// link: the chat it names, if any.
	ResolveLink(ctx context.Context, link string) (Chat, MessageID, error)
}

// Accounts owns sign-in and the signed-in accounts: exactly one is active
// and connected, the others are parked with their local databases.
type Accounts interface {
	Subscribe(func(Event)) (unsubscribe func())
	// Restore reconnects the active account of the registry, if any.
	Restore(ctx context.Context) error
	Auth() AuthState
	Registry() AccountRegistry
	// Active is the active account's repository, nil before sign-in.
	Active() Repository
	// StartSignIn opens a new account's sign-in (the first, or one more).
	StartSignIn(ctx context.Context) error
	CancelSignIn(ctx context.Context) error
	SubmitPhone(ctx context.Context, phone string) error
	SubmitCode(ctx context.Context, code string) error
	SubmitPassword(ctx context.Context, password string) error
	SubmitRegistration(ctx context.Context, first, last string) error
	RequestQR(ctx context.Context) error
	ResendCode(ctx context.Context) error
	Switch(ctx context.Context, id AccountID) error
	// Logout signs the active account out and deletes its local data.
	Logout(ctx context.Context) error
	Close() error
}
