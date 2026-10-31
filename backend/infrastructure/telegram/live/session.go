// Package live is Telo's Telegram over TDLib: one Session per signed-in
// account keeps TDLib's objects as its updates deliver them, maps them to
// the domain, and implements tg.Repository; Accounts runs sign-in and the
// account switcher over sessions.
package live

import (
	"context"
	"errors"
	"slices"
	"sync"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib/tdapi"
)

// Config is what TDLib needs to open an account.
type Config struct {
	APIID   int32
	APIHash string
	// Directory holds the account's TDLib database and files.
	Directory string
	// DatabaseKey encrypts the database; it is kept in the keychain.
	DatabaseKey []byte
	Language    string
	Device      string
	System      string
	Version     string
}

// Session is one account's TDLib client and what its updates said.
type Session struct {
	cfg    Config
	client *tdlib.Client
	td     *tdapi.Client

	mu        sync.Mutex
	auth      tdapi.AuthorizationState
	authErr   string
	conn      tg.ConnectionState
	myID      int64
	users     map[int64]*tdapi.User
	userInfo  map[int64]*tdapi.UserFullInfo
	chats     map[int64]*tdapi.Chat
	basic     map[int64]*tdapi.BasicGroup
	super     map[int64]*tdapi.Supergroup
	secret    map[int32]*tdapi.SecretChat
	files     map[int32]*tdapi.File
	accents   map[int32]*tdapi.AccentColor
	folders   []*tdapi.ChatFolderInfo
	typing    map[int64]time.Time
	reactions []string
	// avatarOwners maps a profile picture's file to the chats and users it
	// belongs to, so its download reaches each of them.
	avatarOwners map[int32][]owner
	// requested remembers the pictures asked for, to ask once.
	requested map[int32]bool
	// pending maps a message being sent to its client id.
	pending map[int64]string
	// mainLoaded and archiveLoaded tell whether TDLib has no more chats.
	mainLoaded, archiveLoaded bool

	subsMu sync.Mutex
	subs   map[int]func(tg.Event)
	nextID int
	done   chan struct{}
}

type owner struct {
	chat int64
	user int64
}

// Open starts a TDLib client for an account; its first updates ask for
// the parameters, which Open answers.
func Open(lib *tdlib.Library, cfg Config) *Session {
	c := lib.NewClient()
	s := newSession(cfg, c)
	s.client = c
	go s.loop()
	go s.pollTyping()
	return s
}

// newSession prepares a session over a transport; tests drive handle.
func newSession(cfg Config, t tdapi.Transport) *Session {
	return &Session{
		cfg: cfg, td: tdapi.NewClient(t), conn: tg.ConnectionConnecting,
		users: map[int64]*tdapi.User{}, userInfo: map[int64]*tdapi.UserFullInfo{}, chats: map[int64]*tdapi.Chat{},
		basic: map[int64]*tdapi.BasicGroup{}, super: map[int64]*tdapi.Supergroup{}, secret: map[int32]*tdapi.SecretChat{},
		files: map[int32]*tdapi.File{}, accents: map[int32]*tdapi.AccentColor{}, typing: map[int64]time.Time{},
		avatarOwners: map[int32][]owner{}, requested: map[int32]bool{}, pending: map[int64]string{},
		subs: map[int]func(tg.Event){}, done: make(chan struct{}),
	}
}

// Subscribe delivers the session's events until unsubscribed.
func (s *Session) Subscribe(f func(tg.Event)) func() {
	s.subsMu.Lock()
	id := s.nextID
	s.nextID++
	s.subs[id] = f
	s.subsMu.Unlock()
	return func() {
		s.subsMu.Lock()
		delete(s.subs, id)
		s.subsMu.Unlock()
	}
}

func (s *Session) emit(e tg.Event) {
	s.subsMu.Lock()
	fs := make([]func(tg.Event), 0, len(s.subs))
	for _, f := range s.subs {
		fs = append(fs, f)
	}
	s.subsMu.Unlock()
	for _, f := range fs {
		f(e)
	}
}

// Done is closed once TDLib closed the client.
func (s *Session) Done() <-chan struct{} { return s.done }

// Close closes the client and waits for TDLib to let it go.
func (s *Session) Close(ctx context.Context) error {
	_, err := s.td.Close(ctx, &tdapi.CloseRequest{})
	if err != nil && !errors.Is(err, tdlib.ErrClosed) {
		return err
	}
	select {
	case <-s.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	return nil
}

// LogOut ends the session on Telegram's side; TDLib deletes the database.
func (s *Session) LogOut(ctx context.Context) error {
	_, err := s.td.LogOut(ctx, &tdapi.LogOutRequest{})
	if err != nil && !errors.Is(err, tdlib.ErrClosed) {
		return err
	}
	select {
	case <-s.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	return nil
}

func (s *Session) loop() {
	defer close(s.done)
	for u := range s.client.Updates() {
		s.handle(u)
	}
}

func (s *Session) handle(u tdapi.Object) {
	switch u := u.(type) {
	case *tdapi.UpdateAuthorizationState:
		s.authorization(u.AuthorizationState)
	case *tdapi.UpdateConnectionState:
		state := connectionState(u.State)
		s.mu.Lock()
		s.conn = state
		s.mu.Unlock()
		s.emit(tg.ConnectionChanged{State: state})
	case *tdapi.UpdateOption:
		if u.Name == "my_id" {
			if v, ok := u.Value.(*tdapi.OptionValueInteger); ok {
				s.mu.Lock()
				s.myID = int64(v.Value)
				s.mu.Unlock()
			}
		}
	case *tdapi.UpdateUser:
		s.mu.Lock()
		s.users[u.User.ID] = u.User
		s.watchUserPhoto(u.User)
		me := u.User.ID == s.myID
		s.mu.Unlock()
		s.refreshPrivateChats(u.User.ID)
		if me {
			s.emit(tg.CurrentUserChanged{User: s.currentUser()})
		}
	case *tdapi.UpdateUserStatus:
		s.mu.Lock()
		if user := s.users[u.UserID]; user != nil {
			cp := *user
			cp.Status = u.Status
			s.users[u.UserID] = &cp
		}
		s.mu.Unlock()
		s.refreshPrivateChats(u.UserID)
	case *tdapi.UpdateUserFullInfo:
		s.mu.Lock()
		s.userInfo[u.UserID] = u.UserFullInfo
		s.mu.Unlock()
	case *tdapi.UpdateBasicGroup:
		s.mu.Lock()
		s.basic[u.BasicGroup.ID] = u.BasicGroup
		s.mu.Unlock()
		s.refreshChatsWhere(func(c *tdapi.Chat) bool {
			t, ok := c.Type.(*tdapi.ChatTypeBasicGroup)
			return ok && t.BasicGroupID == u.BasicGroup.ID
		})
	case *tdapi.UpdateSupergroup:
		s.mu.Lock()
		s.super[u.Supergroup.ID] = u.Supergroup
		s.mu.Unlock()
		s.refreshChatsWhere(func(c *tdapi.Chat) bool {
			t, ok := c.Type.(*tdapi.ChatTypeSupergroup)
			return ok && t.SupergroupID == u.Supergroup.ID
		})
	case *tdapi.UpdateSecretChat:
		s.mu.Lock()
		s.secret[u.SecretChat.ID] = u.SecretChat
		s.mu.Unlock()
		s.refreshChatsWhere(func(c *tdapi.Chat) bool {
			t, ok := c.Type.(*tdapi.ChatTypeSecret)
			return ok && t.SecretChatID == u.SecretChat.ID
		})
	case *tdapi.UpdateNewChat:
		s.mu.Lock()
		s.chats[u.Chat.ID] = u.Chat
		s.watchChatPhoto(u.Chat)
		s.mu.Unlock()
		s.publishChat(u.Chat.ID)
	case *tdapi.UpdateChatTitle:
		s.editChat(u.ChatID, func(c *tdapi.Chat) { c.Title = u.Title })
	case *tdapi.UpdateChatPhoto:
		s.editChat(u.ChatID, func(c *tdapi.Chat) { c.Photo = u.Photo; s.watchChatPhoto(c) })
	case *tdapi.UpdateChatPermissions:
		s.editChat(u.ChatID, func(c *tdapi.Chat) { c.Permissions = u.Permissions })
	case *tdapi.UpdateChatLastMessage:
		s.editChat(u.ChatID, func(c *tdapi.Chat) {
			c.LastMessage = u.LastMessage
			for _, p := range u.Positions {
				setPosition(c, p)
			}
		})
	case *tdapi.UpdateChatPosition:
		s.editChat(u.ChatID, func(c *tdapi.Chat) { setPosition(c, u.Position) })
	case *tdapi.UpdateChatAddedToList:
		s.editChat(u.ChatID, func(c *tdapi.Chat) {
			if !slices.ContainsFunc(c.ChatLists, func(l tdapi.ChatList) bool { return sameList(l, u.ChatList) }) {
				c.ChatLists = append(c.ChatLists, u.ChatList)
			}
		})
	case *tdapi.UpdateChatRemovedFromList:
		s.editChat(u.ChatID, func(c *tdapi.Chat) {
			c.ChatLists = slices.DeleteFunc(c.ChatLists, func(l tdapi.ChatList) bool { return sameList(l, u.ChatList) })
		})
	case *tdapi.UpdateChatReadInbox:
		s.editChat(u.ChatID, func(c *tdapi.Chat) { c.LastReadInboxMessageID, c.UnreadCount = u.LastReadInboxMessageID, u.UnreadCount })
		s.emit(tg.MessagesRead{ChatID: tg.ChatID(u.ChatID), MaxID: tg.MessageID(u.LastReadInboxMessageID)})
	case *tdapi.UpdateChatReadOutbox:
		s.editChat(u.ChatID, func(c *tdapi.Chat) { c.LastReadOutboxMessageID = u.LastReadOutboxMessageID })
		s.emit(tg.MessagesRead{ChatID: tg.ChatID(u.ChatID), MaxID: tg.MessageID(u.LastReadOutboxMessageID), Outbox: true})
	case *tdapi.UpdateChatUnreadMentionCount:
		s.editChat(u.ChatID, func(c *tdapi.Chat) { c.UnreadMentionCount = u.UnreadMentionCount })
	case *tdapi.UpdateChatIsMarkedAsUnread:
		s.editChat(u.ChatID, func(c *tdapi.Chat) { c.IsMarkedAsUnread = u.IsMarkedAsUnread })
	case *tdapi.UpdateChatNotificationSettings:
		s.editChat(u.ChatID, func(c *tdapi.Chat) { c.NotificationSettings = u.NotificationSettings })
	case *tdapi.UpdateChatDraftMessage:
		s.editChat(u.ChatID, func(c *tdapi.Chat) {
			c.DraftMessage = u.DraftMessage
			for _, p := range u.Positions {
				setPosition(c, p)
			}
		})
		s.emit(tg.DraftChanged{ChatID: tg.ChatID(u.ChatID), Draft: draftText(u.DraftMessage)})
	case *tdapi.UpdateChatAvailableReactions:
		s.editChat(u.ChatID, func(c *tdapi.Chat) { c.AvailableReactions = u.AvailableReactions })
	case *tdapi.UpdateChatAction:
		typing := true
		if _, ok := u.Action.(*tdapi.ChatActionCancel); ok {
			typing = false
		}
		s.mu.Lock()
		if typing {
			s.typing[u.ChatID] = time.Now().Add(6 * time.Second)
		} else {
			delete(s.typing, u.ChatID)
		}
		s.mu.Unlock()
		s.emit(tg.TypingChanged{ChatID: tg.ChatID(u.ChatID), Typing: typing})
	case *tdapi.UpdateChatFolders:
		s.mu.Lock()
		s.folders = u.ChatFolders
		s.mu.Unlock()
		s.emit(tg.FoldersChanged{Folders: s.folderTabs()})
	case *tdapi.UpdateNewMessage:
		if u.Message.SchedulingState != nil {
			s.emit(tg.ScheduledChanged{ChatID: tg.ChatID(u.Message.ChatID)})
			return
		}
		s.emit(tg.MessageUpserted{Message: s.message(u.Message)})
	case *tdapi.UpdateMessageSendSucceeded:
		s.mu.Lock()
		client := s.pending[u.OldMessageID]
		delete(s.pending, u.OldMessageID)
		s.pending[u.Message.ID] = client
		s.mu.Unlock()
		m := s.message(u.Message)
		m.ClientID = client
		s.emit(tg.MessageUpserted{Message: m, Replaces: tg.MessageID(u.OldMessageID)})
	case *tdapi.UpdateMessageSendFailed:
		m := s.message(u.Message)
		m.Status = tg.StatusFailed
		s.mu.Lock()
		m.ClientID = s.pending[u.OldMessageID]
		s.mu.Unlock()
		s.emit(tg.MessageUpserted{Message: m, Replaces: tg.MessageID(u.OldMessageID)})
	case *tdapi.UpdateMessageContent, *tdapi.UpdateMessageEdited, *tdapi.UpdateMessageInteractionInfo:
		chat, id := messageRef(u)
		go s.reread(chat, id, true)
	case *tdapi.UpdateMessageIsPinned:
		s.emit(tg.PinnedChanged{ChatID: tg.ChatID(u.ChatID)})
		go s.reread(u.ChatID, u.MessageID, false)
	case *tdapi.UpdateDeleteMessages:
		if u.FromCache {
			return
		}
		ids := make([]tg.MessageID, len(u.MessageIDs))
		for i, id := range u.MessageIDs {
			ids[i] = tg.MessageID(id)
		}
		s.emit(tg.MessagesDeleted{ChatID: tg.ChatID(u.ChatID), IDs: ids})
	case *tdapi.UpdateFile:
		s.file(u.File)
	case *tdapi.UpdateAccentColors:
		s.mu.Lock()
		for _, c := range u.Colors {
			s.accents[c.ID] = c
		}
		s.mu.Unlock()
	case *tdapi.UpdateActiveEmojiReactions:
		s.mu.Lock()
		s.reactions = u.Emojis
		s.mu.Unlock()
	case *tdapi.UpdateAnimatedEmojiMessageClicked:
		s.emit(tg.AnimatedEmojiClicked{Effect: tg.AnimatedEmojiEffect{
			ChatID: tg.ChatID(u.ChatID), MessageID: tg.MessageID(u.MessageID), Sticker: s.sticker(u.Sticker)}})
	case *tdapi.UpdateInstalledStickerSets, *tdapi.UpdateRecentStickers, *tdapi.UpdateFavoriteStickers:
		s.emit(tg.StickersChanged{})
	}
}

func messageRef(u tdapi.Object) (int64, int64) {
	switch u := u.(type) {
	case *tdapi.UpdateMessageContent:
		return u.ChatID, u.MessageID
	case *tdapi.UpdateMessageEdited:
		return u.ChatID, u.MessageID
	case *tdapi.UpdateMessageInteractionInfo:
		return u.ChatID, u.MessageID
	}
	return 0, 0
}

// reread fetches a changed message and publishes it.
func (s *Session) reread(chat, id int64, edited bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	m, err := s.td.GetMessage(ctx, &tdapi.GetMessageRequest{ChatID: chat, MessageID: id})
	if err != nil {
		return
	}
	if m.SchedulingState != nil {
		s.emit(tg.ScheduledChanged{ChatID: tg.ChatID(chat)})
		return
	}
	s.emit(tg.MessageUpserted{Message: s.message(m), Edited: edited})
}

// editChat changes a known chat and republishes it.
func (s *Session) editChat(id int64, edit func(*tdapi.Chat)) {
	s.mu.Lock()
	c := s.chats[id]
	if c == nil {
		s.mu.Unlock()
		return
	}
	cp := *c
	cp.Positions = slices.Clone(c.Positions)
	cp.ChatLists = slices.Clone(c.ChatLists)
	edit(&cp)
	s.chats[id] = &cp
	s.mu.Unlock()
	s.publishChat(id)
}

func (s *Session) publishChat(id int64) {
	s.mu.Lock()
	c := s.chats[id]
	if c == nil {
		s.mu.Unlock()
		return
	}
	listed := inList(c)
	chat := s.chatLocked(c)
	s.mu.Unlock()
	if !listed {
		s.emit(tg.ChatRemoved{ChatID: chat.ID})
		return
	}
	s.emit(tg.ChatUpserted{Chat: chat})
}

func (s *Session) refreshPrivateChats(user int64) {
	s.refreshChatsWhere(func(c *tdapi.Chat) bool {
		switch t := c.Type.(type) {
		case *tdapi.ChatTypePrivate:
			return t.UserID == user
		case *tdapi.ChatTypeSecret:
			return t.UserID == user
		}
		return false
	})
}

func (s *Session) refreshChatsWhere(match func(*tdapi.Chat) bool) {
	s.mu.Lock()
	var ids []int64
	for id, c := range s.chats {
		if match(c) {
			ids = append(ids, id)
		}
	}
	s.mu.Unlock()
	for _, id := range ids {
		s.publishChat(id)
	}
}

// file records a file's state: a settled profile picture reaches its
// owners, a download in flight reports progress.
func (s *Session) file(f *tdapi.File) {
	s.mu.Lock()
	s.files[f.ID] = f
	owners := s.avatarOwners[f.ID]
	s.mu.Unlock()
	done := f.Local != nil && f.Local.IsDownloadingCompleted
	if done {
		for _, o := range owners {
			if o.chat != 0 {
				s.publishChat(o.chat)
			}
			if o.user != 0 {
				s.emit(tg.AvatarChanged{UserID: tg.UserID(o.user), Avatar: s.userAvatar(o.user)})
				s.mu.Lock()
				me := o.user == s.myID
				s.mu.Unlock()
				if me {
					s.emit(tg.CurrentUserChanged{User: s.currentUser()})
				}
			}
		}
	}
	if len(owners) > 0 {
		return
	}
	d := tg.MediaDownload{FileID: tg.FileID(f.ID), Total: max(f.Size, f.ExpectedSize)}
	if f.Local != nil {
		d.Downloaded = f.Local.DownloadedSize
		switch {
		case f.Local.IsDownloadingCompleted:
			d.State, d.Path = tg.TransferDone, f.Local.Path
		case f.Local.IsDownloadingActive:
			d.State = tg.TransferRunning
		default:
			if f.Remote != nil && f.Remote.IsUploadingActive {
				return
			}
			d.State = tg.TransferCancelled
		}
	}
	s.emit(tg.DownloadProgressed{Download: d})
}

// watchChatPhoto asks for a chat's small picture once; s.mu is held.
func (s *Session) watchChatPhoto(c *tdapi.Chat) {
	if c.Photo == nil || c.Photo.Small == nil {
		return
	}
	s.watchFile(c.Photo.Small, owner{chat: c.ID})
}

// watchUserPhoto asks for a user's small picture once; s.mu is held.
func (s *Session) watchUserPhoto(u *tdapi.User) {
	if u.ProfilePhoto == nil || u.ProfilePhoto.Small == nil {
		return
	}
	s.watchFile(u.ProfilePhoto.Small, owner{user: u.ID})
}

func (s *Session) watchFile(f *tdapi.File, o owner) {
	if prev, ok := s.files[f.ID]; !ok || prev.Local == nil || f.Local != nil && f.Local.IsDownloadingCompleted {
		s.files[f.ID] = f
	}
	if !slices.Contains(s.avatarOwners[f.ID], o) {
		s.avatarOwners[f.ID] = append(s.avatarOwners[f.ID], o)
	}
	if f.Local != nil && f.Local.IsDownloadingCompleted || s.requested[f.ID] {
		return
	}
	s.requested[f.ID] = true
	id := f.ID
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		_, _ = s.td.DownloadFile(ctx, &tdapi.DownloadFileRequest{FileID: id, Priority: 4})
	}()
}

// fileState returns the latest state of a file TDLib named.
func (s *Session) fileState(f *tdapi.File) *tdapi.File {
	if f == nil {
		return nil
	}
	if known, ok := s.files[f.ID]; ok {
		return known
	}
	return f
}

func setPosition(c *tdapi.Chat, p *tdapi.ChatPosition) {
	c.Positions = slices.DeleteFunc(c.Positions, func(q *tdapi.ChatPosition) bool { return sameList(q.List, p.List) })
	if p.Order != 0 {
		c.Positions = append(c.Positions, p)
	}
}

func sameList(a, b tdapi.ChatList) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.TDType() != b.TDType() {
		return false
	}
	fa, ok := a.(*tdapi.ChatListFolder)
	if !ok {
		return true
	}
	return fa.ChatFolderID == b.(*tdapi.ChatListFolder).ChatFolderID
}

// inList tells whether a chat shows in the main list or the archive.
func inList(c *tdapi.Chat) bool {
	for _, p := range c.Positions {
		switch p.List.(type) {
		case *tdapi.ChatListMain, *tdapi.ChatListArchive:
			return p.Order != 0
		}
	}
	return false
}

func connectionState(s tdapi.ConnectionState) tg.ConnectionState {
	switch s.(type) {
	case *tdapi.ConnectionStateReady:
		return tg.ConnectionReady
	case *tdapi.ConnectionStateUpdating:
		return tg.ConnectionSynchronizing
	case *tdapi.ConnectionStateConnectingToProxy:
		return tg.ConnectionProxy
	case *tdapi.ConnectionStateWaitingForNetwork:
		return tg.ConnectionOffline
	}
	return tg.ConnectionConnecting
}
