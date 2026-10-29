package telegram

// Event is a change the active account publishes. Adapters emit them from
// TDLib updates (or the demo workspace); the application layer forwards
// them to the UI and automation.
type Event interface{ isEvent() }

// ConnectionChanged reports the network state.
type ConnectionChanged struct{ State ConnectionState }

// AuthChanged reports the sign-in flow.
type AuthChanged struct{ State AuthState }

// ChatUpserted adds or replaces a chat of the list.
type ChatUpserted struct{ Chat Chat }

// ChatRemoved drops a chat from the list (left, deleted).
type ChatRemoved struct{ ChatID ChatID }

// ChatsLoaded replaces a page of the chat list.
type ChatsLoaded struct{ Page ChatPage }

// MessageUpserted adds or replaces a message; Edited distinguishes an edit
// from a new message for notifications and automation.
type MessageUpserted struct {
	Message Message
	Edited  bool
	// Replaces is the optimistic id the message supersedes.
	Replaces MessageID
}

// MessagesDeleted removes messages.
type MessagesDeleted struct {
	ChatID ChatID
	IDs    []MessageID
}

// MessagesRead moves a read boundary.
type MessagesRead struct {
	ChatID ChatID
	MaxID  MessageID
	Outbox bool
}

// ReactionsChanged replaces a message's reactions.
type ReactionsChanged struct {
	ChatID    ChatID
	MessageID MessageID
	Reactions []Reaction
}

// TypingChanged reports the peer typing.
type TypingChanged struct {
	ChatID ChatID
	Typing bool
}

// DraftChanged reports a server-synced draft.
type DraftChanged struct {
	ChatID ChatID
	Draft  string
}

// AvatarChanged reports a settled picture of a chat, user or the account.
type AvatarChanged struct {
	ChatID ChatID
	UserID UserID
	Avatar Avatar
}

// FoldersChanged replaces the folder tabs.
type FoldersChanged struct{ Folders []Folder }

// CurrentUserChanged asks to reread the account's profile.
type CurrentUserChanged struct{ User CurrentUser }

// PinnedChanged asks to reread a chat's pinned messages.
type PinnedChanged struct{ ChatID ChatID }

// ScheduledChanged asks to reread a chat's scheduled messages.
type ScheduledChanged struct{ ChatID ChatID }

// DownloadProgressed reports a file download.
type DownloadProgressed struct{ Download MediaDownload }

// UploadProgressed reports an upload.
type UploadProgressed struct {
	UploadID string
	State    TransferState
	Progress float32
	Err      string
}

// StickersChanged asks to reread the sticker catalog.
type StickersChanged struct{}

// AnimatedEmojiClicked plays a peer's emoji burst.
type AnimatedEmojiClicked struct{ Effect AnimatedEmojiEffect }

// SyncFailed reports an update that could not be applied.
type SyncFailed struct{ Err string }

// AccountsChanged reports the account switcher's list.
type AccountsChanged struct{ Registry AccountRegistry }

func (ConnectionChanged) isEvent()    {}
func (AuthChanged) isEvent()          {}
func (ChatUpserted) isEvent()         {}
func (ChatRemoved) isEvent()          {}
func (ChatsLoaded) isEvent()          {}
func (MessageUpserted) isEvent()      {}
func (MessagesDeleted) isEvent()      {}
func (MessagesRead) isEvent()         {}
func (ReactionsChanged) isEvent()     {}
func (TypingChanged) isEvent()        {}
func (DraftChanged) isEvent()         {}
func (AvatarChanged) isEvent()        {}
func (FoldersChanged) isEvent()       {}
func (CurrentUserChanged) isEvent()   {}
func (PinnedChanged) isEvent()        {}
func (ScheduledChanged) isEvent()     {}
func (DownloadProgressed) isEvent()   {}
func (UploadProgressed) isEvent()     {}
func (StickersChanged) isEvent()      {}
func (AnimatedEmojiClicked) isEvent() {}
func (SyncFailed) isEvent()           {}
func (AccountsChanged) isEvent()      {}
