// Package chat is the UI's projection of the active Telegram account: the
// chat list and its folders, loaded transcripts, presence, downloads and
// the optimistic state of what the user just did. It applies repository
// events on the main thread and runs repository calls in the background
// through the runtime; it draws nothing.
package chat

import (
	"cmp"
	"context"
	"slices"
	"strconv"
	"strings"
	"time"

	kfapp "github.com/AstraFoundry/telo/backend/application/keywordfolder"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
)

// Page sizes Telegram's clients use.
const (
	ChatPageSize    = 50
	MessagePageSize = 40
)

// Tab ids beside Telegram's folder ids.
const (
	TabAll     = 0
	TabArchive = tg.ArchiveFolderID
)

// Transcript is a chat's loaded messages, oldest first.
type Transcript struct {
	Messages []tg.Message
	// Cursor pages older messages; Exhausted once there are none.
	Cursor    tg.MessageID
	Exhausted bool
	Loading   bool
	Loaded    bool
	Pinned    []tg.Message
	Scheduled []tg.Message
	// Translations holds shown translations by message.
	Translations map[tg.MessageID]string
}

// Index finds a message, or -1.
func (t *Transcript) Index(id tg.MessageID) int {
	return slices.IndexFunc(t.Messages, func(m tg.Message) bool { return m.ID == id })
}

// Message returns a loaded message.
func (t *Transcript) Message(id tg.MessageID) (tg.Message, bool) {
	if i := t.Index(id); i >= 0 {
		return t.Messages[i], true
	}
	return tg.Message{}, false
}

// Notice is a short outcome the view shows as a toast.
type Notice struct {
	Text  string
	Error bool
}

// Store is the account projection.
type Store struct {
	rt *runtime.Runtime

	chats      map[tg.ChatID]tg.Chat
	order      []tg.ChatID
	orderDirty bool
	NextCursor string
	paging     bool
	Started    bool

	Folders      []tg.Folder
	KeywordTabs  []tg.Folder
	keywordChats map[int][]tg.ChatID
	Tab          int

	Selected    tg.ChatID
	transcripts map[tg.ChatID]*Transcript
	composers   map[tg.ChatID]*Composer

	Connection tg.ConnectionState
	User       tg.CurrentUser
	Auth       tg.AuthState
	Accounts   tg.AccountRegistry
	Downloads  map[tg.FileID]tg.MediaDownload
	// Uploads tracks uploads by id.
	Uploads map[string]tg.UploadProgressed
	// Effects are animated emoji bursts playing, by message.
	Effects map[tg.MessageID]tg.AnimatedEmojiEffect

	notices []Notice
	unsub   func()
	tempID  tg.MessageID
	// OnMessage sees each new message after it is applied, for
	// notifications and automation; edited says it changed.
	OnMessage func(m tg.Message, edited bool)
	// OnChatsChanged runs after the chat list changes, for the badge.
	OnChatsChanged func()
}

// New returns an empty store over the runtime.
func New(rt *runtime.Runtime) *Store {
	return &Store{rt: rt, chats: map[tg.ChatID]tg.Chat{}, transcripts: map[tg.ChatID]*Transcript{},
		Downloads: map[tg.FileID]tg.MediaDownload{}, Uploads: map[string]tg.UploadProgressed{}, Effects: map[tg.MessageID]tg.AnimatedEmojiEffect{},
		keywordChats: map[int][]tg.ChatID{}, Connection: tg.ConnectionReady}
}

// Message finds a loaded message.
func (s *Store) Message(chat tg.ChatID, id tg.MessageID) (tg.Message, bool) {
	t, ok := s.transcripts[chat]
	if !ok {
		return tg.Message{}, false
	}
	for _, m := range t.Messages {
		if m.ID == id {
			return m, true
		}
	}
	return tg.Message{}, false
}

// Notify queues a notice for the view.
func (s *Store) Notify(text string, isError bool) {
	s.notices = append(s.notices, Notice{Text: text, Error: isError})
}

// TakeNotices returns and clears the queued notices.
func (s *Store) TakeNotices() []Notice {
	n := s.notices
	s.notices = nil
	return n
}

// fail reports err as a notice when it is not nil.
func (s *Store) fail(err error) {
	if err != nil {
		s.Notify(err.Error(), true)
	}
}

// Start subscribes to the account and loads the first page, the folders
// and the profile. It is called again after an account switch.
func (s *Store) Start() {
	if s.unsub != nil {
		s.unsub()
	}
	*s = Store{rt: s.rt, OnMessage: s.OnMessage, OnChatsChanged: s.OnChatsChanged, chats: map[tg.ChatID]tg.Chat{}, transcripts: map[tg.ChatID]*Transcript{},
		Downloads: map[tg.FileID]tg.MediaDownload{}, Uploads: map[string]tg.UploadProgressed{}, Effects: map[tg.MessageID]tg.AnimatedEmojiEffect{},
		keywordChats: map[int][]tg.ChatID{}, Connection: tg.ConnectionReady, Auth: s.rt.Accounts.Auth(), Accounts: s.rt.Accounts.Registry(), Started: true}
	s.unsub = s.rt.Accounts.Subscribe(func(e tg.Event) { s.rt.Post(func() { s.Apply(e) }) })
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	s.LoadMoreChats()
	s.rt.Go(func(ctx context.Context) func() {
		folders, ferr := repo.Folders(ctx)
		user, uerr := repo.CurrentUser(ctx)
		return func() {
			if ferr == nil {
				s.Folders = folders
			}
			if uerr == nil {
				s.User = user
			}
		}
	})
	s.RefreshKeywordFolders()
}

// Stop unsubscribes.
func (s *Store) Stop() {
	if s.unsub != nil {
		s.unsub()
		s.unsub = nil
	}
}

// LoadMoreChats requests the next page of the chat list.
func (s *Store) LoadMoreChats() {
	repo := s.rt.Repo()
	if repo == nil || s.paging || (s.NextCursor == "" && len(s.chats) > 0) {
		return
	}
	s.paging = true
	cursor := s.NextCursor
	s.rt.Go(func(ctx context.Context) func() {
		page, err := repo.ChatPage(ctx, cursor, ChatPageSize)
		return func() {
			s.paging = false
			if err != nil {
				s.fail(err)
				return
			}
			s.applyPage(page)
		}
	})
}

func (s *Store) applyPage(p tg.ChatPage) {
	for _, c := range p.Items {
		s.upsertChat(c)
	}
	s.NextCursor = p.NextCursor
}

func (s *Store) upsertChat(c tg.Chat) {
	if old, ok := s.chats[c.ID]; ok {
		// A pending download settled the avatar locally; keep it until the
		// repository sends a settled one.
		if c.Avatar.Path == "" && old.Avatar.Path != "" {
			c.Avatar.Path = old.Avatar.Path
		}
		c.KeywordFolderIDs = old.KeywordFolderIDs
	}
	s.chats[c.ID] = c
	s.orderDirty = true
	if s.OnChatsChanged != nil {
		s.OnChatsChanged()
	}
}

// Chat returns a chat of the list.
func (s *Store) Chat(id tg.ChatID) (tg.Chat, bool) {
	c, ok := s.chats[id]
	return c, ok
}

// All returns every loaded chat in list order: pinned first, then by
// Telegram's order.
func (s *Store) All() []tg.Chat {
	if s.orderDirty || len(s.order) != len(s.chats) {
		s.order = s.order[:0]
		for id := range s.chats {
			s.order = append(s.order, id)
		}
		slices.SortStableFunc(s.order, func(a, b tg.ChatID) int {
			ca, cb := s.chats[a], s.chats[b]
			if ca.Pinned != cb.Pinned {
				if ca.Pinned {
					return -1
				}
				return 1
			}
			if c := cmp.Compare(cb.ListOrder, ca.ListOrder); c != 0 {
				return c
			}
			return cb.UpdatedAt.Compare(ca.UpdatedAt)
		})
		s.orderDirty = false
	}
	out := make([]tg.Chat, 0, len(s.order))
	for _, id := range s.order {
		out = append(out, s.chats[id])
	}
	return out
}

// Visible returns the chats of the selected tab.
func (s *Store) Visible() []tg.Chat {
	return s.InTab(s.Tab)
}

// InTab returns the chats of a tab.
func (s *Store) InTab(tab int) []tg.Chat {
	var out []tg.Chat
	for _, c := range s.All() {
		archived := c.FolderID == tg.ArchiveFolderID
		switch {
		case tab == TabAll && !archived,
			tab == TabArchive && archived,
			tab > TabArchive && !archived && slices.Contains(c.FolderIDs, tab),
			tab < 0 && slices.Contains(s.keywordChats[tab], c.ID):
			out = append(out, c)
		}
	}
	return out
}

// HasArchive tells whether any chat is archived.
func (s *Store) HasArchive() bool {
	for _, c := range s.chats {
		if c.FolderID == tg.ArchiveFolderID {
			return true
		}
	}
	return false
}

// TabUnread counts unread messages of a tab; muted chats count only when
// countMuted.
func (s *Store) TabUnread(tab int, countMuted bool) int {
	n := 0
	for _, c := range s.InTab(tab) {
		if !c.Muted || countMuted {
			n += c.UnreadCount
		}
	}
	return n
}

// Transcript returns a chat's transcript, creating it.
func (s *Store) Transcript(id tg.ChatID) *Transcript {
	t, ok := s.transcripts[id]
	if !ok {
		t = &Transcript{Translations: map[tg.MessageID]string{}}
		s.transcripts[id] = t
	}
	return t
}

// Select opens a chat: the transcript's newest page loads the first time,
// and its pinned and scheduled messages with it.
func (s *Store) Select(id tg.ChatID) {
	previous := s.Selected
	s.Selected = id
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	if previous != 0 && previous != id {
		s.rt.Go(func(ctx context.Context) func() { _ = repo.OpenChat(ctx, previous, false); return nil })
	}
	if id == 0 {
		return
	}
	s.rt.Go(func(ctx context.Context) func() { _ = repo.OpenChat(ctx, id, true); return nil })
	t := s.Transcript(id)
	if !t.Loaded && !t.Loading {
		s.LoadOlder(id)
	}
	s.RefreshPinned(id)
	s.RefreshScheduled(id)
}

// LoadOlder pages the transcript backward.
func (s *Store) LoadOlder(id tg.ChatID) {
	repo := s.rt.Repo()
	t := s.Transcript(id)
	if repo == nil || t.Loading || t.Exhausted {
		return
	}
	t.Loading = true
	before := t.Cursor
	if !t.Loaded {
		before = 0
	}
	s.rt.Go(func(ctx context.Context) func() {
		page, err := repo.Messages(ctx, id, before, MessagePageSize)
		return func() {
			t.Loading = false
			if err != nil {
				s.fail(err)
				return
			}
			t.Loaded = true
			for _, m := range page.Items {
				s.merge(t, m)
			}
			t.Cursor = page.NextCursor
			t.Exhausted = page.NextCursor == 0
		}
	})
}

// JumpTo loads a page around a message that is not loaded, for replies,
// pins and search hits.
func (s *Store) JumpTo(id tg.ChatID, message tg.MessageID, done func()) {
	t := s.Transcript(id)
	if _, ok := t.Message(message); ok {
		if done != nil {
			done()
		}
		return
	}
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	s.rt.Go(func(ctx context.Context) func() {
		page, err := repo.MessagesAround(ctx, id, message, MessagePageSize)
		return func() {
			if err != nil {
				s.fail(err)
				return
			}
			for _, m := range page.Items {
				s.merge(t, m)
			}
			t.Loaded = true
			if len(t.Messages) > 0 && (t.Cursor == 0 || t.Messages[0].ID < t.Cursor) {
				t.Cursor = page.NextCursor
			}
			if done != nil {
				done()
			}
		}
	})
}

// merge inserts or replaces m in id order, folding an optimistic message
// with the same client id into the server's.
func (s *Store) merge(t *Transcript, m tg.Message) {
	if !m.ScheduledAt.IsZero() {
		return
	}
	if m.ClientID != "" {
		if i := slices.IndexFunc(t.Messages, func(x tg.Message) bool { return x.ClientID == m.ClientID && x.ID != m.ID }); i >= 0 {
			t.Messages = slices.Delete(t.Messages, i, i+1)
		}
	}
	i, found := slices.BinarySearchFunc(t.Messages, m.ID, func(x tg.Message, id tg.MessageID) int { return cmp.Compare(sortKey(x), sortKeyOf(id)) })
	if found {
		t.Messages[i] = m
		return
	}
	t.Messages = slices.Insert(t.Messages, i, m)
}

// Optimistic messages carry negative ids; they sort after every server
// message, in the order they were sent.
func sortKey(m tg.Message) int64 { return sortKeyOf(m.ID) }

func sortKeyOf(id tg.MessageID) int64 {
	if id < 0 {
		return 1<<62 - int64(id)
	}
	return int64(id)
}

// Apply folds a repository event into the store. It runs on the main
// thread.
func (s *Store) Apply(e tg.Event) {
	switch e := e.(type) {
	case tg.ConnectionChanged:
		s.Connection = e.State
	case tg.AuthChanged:
		s.Auth = e.State
	case tg.AccountsChanged:
		s.Accounts = e.Registry
	case tg.ChatUpserted:
		s.upsertChat(e.Chat)
	case tg.ChatRemoved:
		delete(s.chats, e.ChatID)
		delete(s.transcripts, e.ChatID)
		s.orderDirty = true
		if s.Selected == e.ChatID {
			s.Selected = 0
		}
	case tg.ChatsLoaded:
		s.applyPage(e.Page)
	case tg.MessageUpserted:
		if t, ok := s.transcripts[e.Message.ChatID]; ok && t.Loaded {
			if e.Replaces != 0 {
				if i := t.Index(e.Replaces); i >= 0 {
					t.Messages = slices.Delete(t.Messages, i, i+1)
				}
			}
			s.merge(t, e.Message)
		}
		if s.OnMessage != nil {
			s.OnMessage(e.Message, e.Edited)
		}
	case tg.MessagesDeleted:
		if t, ok := s.transcripts[e.ChatID]; ok {
			t.Messages = slices.DeleteFunc(t.Messages, func(m tg.Message) bool { return slices.Contains(e.IDs, m.ID) })
			t.Pinned = slices.DeleteFunc(t.Pinned, func(m tg.Message) bool { return slices.Contains(e.IDs, m.ID) })
		}
	case tg.MessagesRead:
		if c, ok := s.chats[e.ChatID]; ok {
			if e.Outbox {
				c.LastReadOutboxID = max(c.LastReadOutboxID, e.MaxID)
			} else {
				c.LastReadMessageID = max(c.LastReadMessageID, e.MaxID)
			}
			s.chats[e.ChatID] = c
		}
		if t, ok := s.transcripts[e.ChatID]; ok && e.Outbox {
			for i := range t.Messages {
				if t.Messages[i].Outgoing && t.Messages[i].ID <= e.MaxID && t.Messages[i].Status == tg.StatusSent {
					t.Messages[i].Status = tg.StatusRead
				}
			}
		}
	case tg.ReactionsChanged:
		if t, ok := s.transcripts[e.ChatID]; ok {
			if i := t.Index(e.MessageID); i >= 0 {
				t.Messages[i].Reactions = e.Reactions
			}
		}
	case tg.TypingChanged:
		if c, ok := s.chats[e.ChatID]; ok {
			c.Typing = e.Typing
			s.chats[e.ChatID] = c
		}
	case tg.DraftChanged:
		if c, ok := s.chats[e.ChatID]; ok {
			c.DraftPreview = e.Draft
			s.chats[e.ChatID] = c
		}
	case tg.AvatarChanged:
		if c, ok := s.chats[e.ChatID]; ok && e.ChatID != 0 {
			c.Avatar = e.Avatar
			s.chats[e.ChatID] = c
		}
		if e.UserID != 0 && e.UserID == s.User.ID {
			s.User.Avatar = e.Avatar
		}
	case tg.FoldersChanged:
		s.Folders = e.Folders
		if s.Tab > TabArchive && !slices.ContainsFunc(s.Folders, func(f tg.Folder) bool { return f.ID == s.Tab }) {
			s.Tab = TabAll
		}
	case tg.CurrentUserChanged:
		s.User = e.User
	case tg.PinnedChanged:
		s.RefreshPinned(e.ChatID)
	case tg.ScheduledChanged:
		s.RefreshScheduled(e.ChatID)
	case tg.DownloadProgressed:
		s.Downloads[e.Download.FileID] = e.Download
		if e.Download.State == tg.TransferDone {
			s.fillPath(e.Download.FileID, e.Download.Path)
		}
	case tg.UploadProgressed:
		s.Uploads[e.UploadID] = e
	case tg.AnimatedEmojiClicked:
		if e.Effect.ChatID == s.Selected {
			s.Effects[e.Effect.MessageID] = e.Effect
		}
	case tg.StickersChanged, tg.SyncFailed:
	}
}

// fillPath writes a finished download's path into the loaded messages.
func (s *Store) fillPath(file tg.FileID, path string) {
	for _, t := range s.transcripts {
		for i := range t.Messages {
			m := t.Messages[i].Media
			if m == nil {
				continue
			}
			if m.FileID == file {
				m.Path = path
			}
			if m.ThumbnailFileID == file {
				m.ThumbnailPath = path
			}
			if m.WebPage != nil && m.WebPage.Photo != nil && m.WebPage.Photo.FileID == file {
				m.WebPage.Photo.Path = path
			}
		}
	}
}

// RefreshPinned rereads a chat's pinned messages.
func (s *Store) RefreshPinned(id tg.ChatID) {
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	s.rt.Go(func(ctx context.Context) func() {
		pinned, err := repo.PinnedMessages(ctx, id)
		return func() {
			if err == nil {
				s.Transcript(id).Pinned = pinned
			}
		}
	})
}

// RefreshScheduled rereads a chat's scheduled messages.
func (s *Store) RefreshScheduled(id tg.ChatID) {
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	s.rt.Go(func(ctx context.Context) func() {
		list, err := repo.ScheduledMessages(ctx, id)
		return func() {
			if err == nil {
				s.Transcript(id).Scheduled = list
			}
		}
	})
}

// RefreshKeywordFolders recomputes keyword folder tabs and membership.
func (s *Store) RefreshKeywordFolders() {
	repo := s.rt.Repo()
	if repo == nil || s.rt.KeywordFolders == nil {
		return
	}
	svc := s.rt.KeywordFolders
	s.rt.Go(func(ctx context.Context) func() {
		folders, err := svc.List(ctx)
		if err != nil {
			return func() { s.fail(err) }
		}
		members, err := svc.Membership(ctx, repo)
		return func() {
			if err != nil {
				s.fail(err)
				return
			}
			s.keywordChats = members
			s.KeywordTabs = kfapp.Tabs(folders, members, s.All())
			if s.Tab < 0 && !slices.ContainsFunc(s.KeywordTabs, func(f tg.Folder) bool { return f.ID == s.Tab }) {
				s.Tab = TabAll
			}
		}
	})
}

// do runs a repository call and reports its error as a notice.
func (s *Store) do(call func(ctx context.Context, repo tg.Repository) error, then func()) {
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	s.rt.Go(func(ctx context.Context) func() {
		err := call(ctx, repo)
		return func() {
			s.fail(err)
			if err == nil && then != nil {
				then()
			}
		}
	})
}

// nextClientID mints an optimistic message's client id.
func (s *Store) nextClientID() (tg.MessageID, string) {
	s.tempID--
	return s.tempID, "c" + strconv.FormatInt(time.Now().UnixNano(), 36) + strconv.FormatInt(int64(-s.tempID), 36)
}

// Send posts a text message, shown at once as sending.
func (s *Store) Send(id tg.ChatID, body string, opts tg.SendOptions) {
	body, opts.Entities = tg.TrimOutgoing(body, opts.Entities)
	if body == "" {
		return
	}
	temp, client := s.nextClientID()
	opts.ClientID = client
	t := s.Transcript(id)
	if opts.SendAt.IsZero() && t.Loaded {
		pending := tg.Message{ID: temp, ChatID: id, Body: body, Entities: opts.Entities, Outgoing: true, Status: tg.StatusSending,
			SentAt: s.rt.Clock(), ClientID: client, SenderName: s.User.DisplayName, SenderID: int64(s.User.ID), IsolatedEmoji: tg.IsolatedEmojiCount(body)}
		if opts.ReplyTo != 0 {
			if r, ok := t.Message(opts.ReplyTo); ok {
				pending.ReplyTo = &tg.ReplyTo{ID: r.ID, SenderName: r.SenderName, Body: r.Body, Entities: r.Entities}
			}
		}
		s.merge(t, pending)
	}
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	s.rt.Go(func(ctx context.Context) func() {
		sent, err := repo.SendMessage(ctx, id, body, opts)
		return func() {
			if err != nil {
				if i := t.Index(temp); i >= 0 {
					t.Messages[i].Status = tg.StatusFailed
				}
				s.fail(err)
				return
			}
			if opts.SendAt.IsZero() && t.Loaded {
				s.merge(t, sent)
			}
		}
	})
}

// Resend retries a failed optimistic message.
func (s *Store) Resend(id tg.ChatID, temp tg.MessageID) {
	t := s.Transcript(id)
	m, ok := t.Message(temp)
	if !ok || m.Status != tg.StatusFailed {
		return
	}
	t.Messages = slices.Delete(t.Messages, t.Index(temp), t.Index(temp)+1)
	opts := tg.SendOptions{Entities: m.Entities}
	if m.ReplyTo != nil {
		opts.ReplyTo = m.ReplyTo.ID
	}
	s.Send(id, m.Body, opts)
}

// SendFiles posts files as one album with a caption.
func (s *Store) SendFiles(id tg.ChatID, files []tg.UploadFile, caption string, opts tg.SendOptions) {
	_, opts.ClientID = s.nextClientID()
	t := s.Transcript(id)
	s.do(func(ctx context.Context, repo tg.Repository) error {
		sent, err := repo.SendMedia(ctx, id, files, caption, opts)
		if err == nil && t.Loaded {
			s.rt.Post(func() {
				for _, m := range sent {
					s.merge(t, m)
				}
			})
		}
		return err
	}, nil)
}

// SendSticker posts a sticker.
func (s *Store) SendSticker(id tg.ChatID, sticker tg.Sticker, opts tg.SendOptions) {
	t := s.Transcript(id)
	s.do(func(ctx context.Context, repo tg.Repository) error {
		m, err := repo.SendSticker(ctx, id, sticker, opts)
		if err == nil && t.Loaded {
			s.rt.Post(func() { s.merge(t, m) })
		}
		return err
	}, nil)
}

// Edit rewrites an outgoing message.
func (s *Store) Edit(id tg.ChatID, message tg.MessageID, body string, entities []tg.Entity) {
	t := s.Transcript(id)
	if i := t.Index(message); i >= 0 {
		t.Messages[i].Body, t.Messages[i].Entities = tg.TrimOutgoing(body, entities)
		t.Messages[i].EditedAt = s.rt.Clock()
	}
	s.do(func(ctx context.Context, repo tg.Repository) error {
		return repo.EditMessage(ctx, id, message, body, entities)
	}, nil)
}

// Delete removes messages, for the account or for everyone.
func (s *Store) Delete(id tg.ChatID, ids []tg.MessageID, scope tg.DeleteScope) {
	t := s.Transcript(id)
	t.Messages = slices.DeleteFunc(t.Messages, func(m tg.Message) bool { return slices.Contains(ids, m.ID) })
	s.do(func(ctx context.Context, repo tg.Repository) error { return repo.DeleteMessages(ctx, id, ids, scope) }, nil)
}

// Forward sends copies of messages to another chat.
func (s *Store) Forward(from tg.ChatID, ids []tg.MessageID, to tg.ChatID, hideSender bool, done func()) {
	s.do(func(ctx context.Context, repo tg.Repository) error {
		return repo.ForwardMessages(ctx, from, ids, to, hideSender)
	}, done)
}

// Pin pins or unpins a message.
func (s *Store) Pin(id tg.ChatID, message tg.MessageID, pinned, notify bool) {
	t := s.Transcript(id)
	if i := t.Index(message); i >= 0 {
		t.Messages[i].Pinned = pinned
	}
	s.do(func(ctx context.Context, repo tg.Repository) error {
		return repo.PinMessage(ctx, id, message, pinned, !notify)
	}, nil)
}

// React toggles a reaction.
func (s *Store) React(id tg.ChatID, message tg.MessageID, emoji string) {
	t := s.Transcript(id)
	chosen := true
	if m, ok := t.Message(message); ok {
		chosen = !slices.ContainsFunc(m.Reactions, func(r tg.Reaction) bool { return r.Emoji == emoji && r.Chosen })
	}
	s.do(func(ctx context.Context, repo tg.Repository) error {
		return repo.SetReaction(ctx, id, message, emoji, chosen)
	}, nil)
}

// Vote answers a poll; no options retracts the vote.
func (s *Store) Vote(id tg.ChatID, message tg.MessageID, options []int) {
	s.do(func(ctx context.Context, repo tg.Repository) error { return repo.VotePoll(ctx, id, message, options) }, nil)
}

// Translate fetches and shows a message's translation.
func (s *Store) Translate(id tg.ChatID, message tg.MessageID, language string, failed string) {
	t := s.Transcript(id)
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	s.rt.Go(func(ctx context.Context) func() {
		text, err := repo.Translate(ctx, id, message, language)
		return func() {
			if err != nil {
				s.Notify(failed, true)
				return
			}
			t.Translations[message] = text
		}
	})
}

// HideTranslation stops showing a translation.
func (s *Store) HideTranslation(id tg.ChatID, message tg.MessageID) {
	delete(s.Transcript(id).Translations, message)
}

// Download fetches a file.
func (s *Store) Download(file tg.FileID) {
	if file == 0 {
		return
	}
	if d, ok := s.Downloads[file]; ok && (d.State == tg.TransferRunning || d.State == tg.TransferDone) {
		return
	}
	s.Downloads[file] = tg.MediaDownload{FileID: file, State: tg.TransferRunning}
	s.do(func(ctx context.Context, repo tg.Repository) error { return repo.Download(ctx, file) }, nil)
}

// CancelDownload stops a file download.
func (s *Store) CancelDownload(file tg.FileID) {
	delete(s.Downloads, file)
	s.do(func(ctx context.Context, repo tg.Repository) error { return repo.CancelDownload(ctx, file) }, nil)
}

// View marks the shown messages read.
func (s *Store) View(id tg.ChatID, ids []tg.MessageID) {
	c, ok := s.chats[id]
	if !ok || len(ids) == 0 || slices.Max(ids) <= c.LastReadMessageID {
		return
	}
	s.do(func(ctx context.Context, repo tg.Repository) error { return repo.ViewMessages(ctx, id, ids) }, nil)
}

// editChat changes a chat optimistically, then asks Telegram.
func (s *Store) editChat(id tg.ChatID, edit func(*tg.Chat), call func(ctx context.Context, repo tg.Repository) error) {
	if c, ok := s.chats[id]; ok {
		edit(&c)
		s.chats[id] = c
		s.orderDirty = true
	}
	s.do(call, nil)
}

// SetPinned pins a chat to the top of the list.
func (s *Store) SetPinned(id tg.ChatID, pinned bool) {
	s.editChat(id, func(c *tg.Chat) { c.Pinned = pinned }, func(ctx context.Context, r tg.Repository) error { return r.SetChatPinned(ctx, id, pinned) })
}

// Mute mutes for d (negative: forever, zero: unmute).
func (s *Store) Mute(id tg.ChatID, d time.Duration) {
	s.editChat(id, func(c *tg.Chat) { c.Muted = d != 0 }, func(ctx context.Context, r tg.Repository) error { return r.MuteChat(ctx, id, d) })
}

// SetRead marks a chat read or unread.
func (s *Store) SetRead(id tg.ChatID, read bool) {
	s.editChat(id, func(c *tg.Chat) {
		if read {
			c.UnreadCount, c.MarkedUnread = 0, false
		} else {
			c.MarkedUnread = true
		}
	}, func(ctx context.Context, r tg.Repository) error { return r.SetChatRead(ctx, id, read) })
}

// SetArchived moves a chat to or from the Archive.
func (s *Store) SetArchived(id tg.ChatID, archived bool) {
	s.editChat(id, func(c *tg.Chat) {
		if archived {
			c.FolderID = tg.ArchiveFolderID
		} else {
			c.FolderID = 0
		}
	}, func(ctx context.Context, r tg.Repository) error { return r.SetChatArchived(ctx, id, archived) })
}

// ClearHistory deletes a chat's messages.
func (s *Store) ClearHistory(id tg.ChatID, forEveryone bool) {
	if t, ok := s.transcripts[id]; ok {
		t.Messages = nil
	}
	s.do(func(ctx context.Context, r tg.Repository) error { return r.ClearHistory(ctx, id, forEveryone) }, nil)
}

// Leave leaves a group or channel, or deletes a direct chat.
func (s *Store) Leave(id tg.ChatID) {
	delete(s.chats, id)
	s.orderDirty = true
	if s.Selected == id {
		s.Selected = 0
	}
	s.do(func(ctx context.Context, r tg.Repository) error { return r.LeaveChat(ctx, id) }, nil)
}

// SaveDraft stores the composer's text as the chat's draft.
func (s *Store) SaveDraft(id tg.ChatID, text string) {
	if c, ok := s.chats[id]; ok && c.DraftPreview == strings.TrimSpace(text) {
		return
	}
	s.do(func(ctx context.Context, r tg.Repository) error { return r.SaveDraft(ctx, id, text) }, nil)
}

// SetTyping reports the account typing.
func (s *Store) SetTyping(id tg.ChatID, typing bool) {
	c, ok := s.chats[id]
	if !ok || !c.CanSendMessages {
		return
	}
	s.do(func(ctx context.Context, r tg.Repository) error { return r.SetTyping(ctx, id, typing) }, nil)
}

// AddToFolder puts a chat in a Telegram folder or takes it out.
func (s *Store) AddToFolder(id tg.ChatID, folder int, add bool) {
	s.editChat(id, func(c *tg.Chat) {
		c.FolderIDs = slices.DeleteFunc(c.FolderIDs, func(f int) bool { return f == folder })
		if add {
			c.FolderIDs = append(c.FolderIDs, folder)
		}
	}, func(ctx context.Context, r tg.Repository) error { return r.AddChatToFolder(ctx, id, folder, add) })
}

// OpenPrivate opens (or creates) the direct chat with a user and selects it.
func (s *Store) OpenPrivate(user tg.UserID) {
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	s.rt.Go(func(ctx context.Context) func() {
		c, err := repo.OpenPrivateChat(ctx, user)
		return func() {
			if err != nil {
				s.fail(err)
				return
			}
			s.upsertChat(c)
			s.Select(c.ID)
		}
	})
}

// OpenSaved selects Saved Messages.
func (s *Store) OpenSaved() {
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	s.rt.Go(func(ctx context.Context) func() {
		c, err := repo.OpenSavedMessages(ctx)
		return func() {
			if err != nil {
				s.fail(err)
				return
			}
			s.upsertChat(c)
			s.Tab = TabAll
			s.Select(c.ID)
		}
	})
}

// Adopt shows a chat created elsewhere (a new group, a secret chat) and
// selects it.
func (s *Store) Adopt(c tg.Chat) {
	s.upsertChat(c)
	s.Select(c.ID)
}

// Neighbor returns the chat after (or before) the selected one in the
// visible list, for the next/previous chat shortcuts.
func (s *Store) Neighbor(step int) (tg.ChatID, bool) {
	list := s.Visible()
	if len(list) == 0 {
		return 0, false
	}
	i := slices.IndexFunc(list, func(c tg.Chat) bool { return c.ID == s.Selected })
	switch {
	case i < 0 && step > 0:
		return list[0].ID, true
	case i < 0:
		return list[len(list)-1].ID, true
	}
	j := i + step
	if j < 0 || j >= len(list) {
		return 0, false
	}
	return list[j].ID, true
}

// Now is the runtime's clock, for relative times.
func (s *Store) Now() time.Time { return s.rt.Clock() }

// SendScheduledNowAction delivers a scheduled message now.
func (s *Store) SendScheduledNowAction(id tg.ChatID, message tg.MessageID) {
	s.do(func(ctx context.Context, r tg.Repository) error { return r.SendScheduledNow(ctx, id, message) }, nil)
}

// RescheduleAction moves a scheduled message.
func (s *Store) RescheduleAction(id tg.ChatID, message tg.MessageID, at time.Time) {
	s.do(func(ctx context.Context, r tg.Repository) error { return r.Reschedule(ctx, id, message, at) }, nil)
}

// ForwardToSaved forwards messages to Saved Messages.
func (s *Store) ForwardToSaved(from tg.ChatID, ids []tg.MessageID) {
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	s.rt.Go(func(ctx context.Context) func() {
		saved, err := repo.OpenSavedMessages(ctx)
		if err == nil {
			err = repo.ForwardMessages(ctx, from, ids, saved.ID, false)
		}
		return func() { s.fail(err) }
	})
}

// Report reports a chat as spam.
func (s *Store) Report(id tg.ChatID) {
	s.do(func(ctx context.Context, r tg.Repository) error { return r.ReportChat(ctx, id, "spam") }, nil)
}

// SendPoll posts a poll.
func (s *Store) SendPoll(id tg.ChatID, poll tg.PollInput) {
	t := s.Transcript(id)
	s.do(func(ctx context.Context, repo tg.Repository) error {
		m, err := repo.SendPoll(ctx, id, poll, tg.SendOptions{})
		if err == nil && t.Loaded {
			s.rt.Post(func() { s.merge(t, m) })
		}
		return err
	}, nil)
}

// ClickEmoji asks Telegram for an animated emoji's burst and plays it.
func (s *Store) ClickEmoji(id tg.ChatID, message tg.MessageID) {
	repo := s.rt.Repo()
	if repo == nil {
		return
	}
	s.rt.Go(func(ctx context.Context) func() {
		effect, err := repo.ClickAnimatedEmoji(ctx, id, message)
		return func() {
			if err == nil && effect != nil {
				s.Effects[message] = *effect
			}
		}
	})
}
