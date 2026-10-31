package demo

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// Options tune the demo workspace.
type Options struct {
	// CacheDir is where "downloaded" files are written.
	CacheDir string
	// ReplyAfter is how long a chat waits before answering a sent
	// message; zero disables auto-replies, as tests want.
	ReplyAfter time.Duration
	// Now returns the current time; it defaults to time.Now.
	Now func() time.Time
}

// Repository is the in-memory workspace.
type Repository struct {
	opts   Options
	files  *assets
	mu     sync.Mutex
	subs   map[int]func(tg.Event)
	nextID int

	user      tg.CurrentUser
	chats     []tg.Chat
	messages  map[tg.ChatID][]tg.Message
	scheduled map[tg.ChatID][]tg.Message
	folders   []tg.Folder
	details   map[int]tg.FolderDetails
	drafts    map[tg.ChatID]string
	contacts  map[tg.UserID]bool
	blocked   map[tg.ChatID]bool
	sessions  []tg.Session
	privacy   map[tg.PrivacyKey]tg.PrivacyRule
	proxies   []tg.Proxy
	scopes    map[tg.NotificationScope]tg.ScopeSettings
	stickers  tg.StickerSet
	recent    []tg.Sticker
	favorites []tg.Sticker
	installed map[int64]bool
	archived  []tg.StickerSetSummary
	downloads map[tg.FileID]string
	network   tg.NetworkUsage
	nextMsg   tg.MessageID
	nextChat  tg.ChatID
	nextProxy int32
	timers    []*time.Timer
}

var _ tg.Repository = (*Repository)(nil)

// New builds the workspace from the fixtures.
func New(opts Options) *Repository {
	if opts.Now == nil {
		opts.Now = time.Now
	}
	files := newAssets(opts.CacheDir)
	r := &Repository{
		opts: opts, files: files, subs: map[int]func(tg.Event){},
		user: tg.CurrentUser{ID: AccountID, DisplayName: "Ada Park", FirstName: "Ada", LastName: "Park", Username: "adapark",
			Bio: "Building Telo.", Phone: "+351 912 000 123", Initials: "AP", Avatar: tg.Avatar{Placeholder: tg.Placeholder("Ada Park", 3)}},
		chats:     seedChats(),
		messages:  seedMessages(files),
		scheduled: map[tg.ChatID][]tg.Message{},
		folders:   []tg.Folder{{ID: WorkFolder, Title: "Work", Kind: tg.FolderNative}},
		details:   map[int]tg.FolderDetails{WorkFolder: {ID: WorkFolder, Title: "Work", IncludedChatIDs: []tg.ChatID{DesignChat, ProductChat}}},
		drafts:    map[tg.ChatID]string{},
		contacts:  map[tg.UserID]bool{},
		blocked:   map[tg.ChatID]bool{},
		sessions:  seedSessions(),
		privacy: map[tg.PrivacyKey]tg.PrivacyRule{
			tg.PrivacyPhoneNumber: {Audience: tg.AudienceContacts}, tg.PrivacyLastSeen: {Audience: tg.AudienceEveryone},
			tg.PrivacyProfilePhoto: {Audience: tg.AudienceEveryone}, tg.PrivacyBio: {Audience: tg.AudienceEveryone},
			tg.PrivacyForwards: {Audience: tg.AudienceEveryone}, tg.PrivacyCalls: {Audience: tg.AudienceContacts},
			tg.PrivacyVoiceNotes: {Audience: tg.AudienceEveryone}, tg.PrivacyGroupInvites: {Audience: tg.AudienceContacts, Deny: []tg.UserID{Bot}},
		},
		scopes: map[tg.NotificationScope]tg.ScopeSettings{
			tg.ScopePrivate: {ShowPreview: true}, tg.ScopeGroups: {ShowPreview: true}, tg.ScopeChannels: {Muted: true, ShowPreview: true},
		},
		installed: map[int64]bool{demoStickerSet: true},
		downloads: map[tg.FileID]string{},
		network:   tg.NetworkUsage{Since: ago(14 * 24 * time.Hour), Sent: 48 << 20, Received: 1310 << 20},
		nextMsg:   1000, nextChat: 50000, nextProxy: 1,
	}
	for id, p := range peers {
		r.contacts[id] = p.contact
	}
	r.blocked[-777] = true
	for chat, last := range lastRead {
		r.setChat(chat, func(c *tg.Chat) { c.LastReadMessageID = last })
	}
	for _, c := range r.chats {
		if c.LastReadMessageID == 0 && c.UnreadCount == 0 {
			if ms := r.messages[c.ID]; len(ms) > 0 {
				r.setChat(c.ID, func(x *tg.Chat) { x.LastReadMessageID = ms[len(ms)-1].ID })
			}
		}
	}
	pack := []tg.Sticker{files.stickerItem(1, "👋"), files.stickerItem(2, "🎉"), files.stickerItem(3, "🔥"), files.stickerItem(4, "👍"), files.stickerItem(5, "❤️")}
	r.stickers = tg.StickerSet{StickerSetSummary: tg.StickerSetSummary{ID: demoStickerSet, Title: "Telo Pack", ShortName: "TeloPack", Thumbnail: &pack[0]}, Stickers: pack, Installed: true}
	r.recent = []tg.Sticker{pack[1]}
	r.favorites = []tg.Sticker{pack[0]}
	r.archived = []tg.StickerSetSummary{{ID: 77002, Title: "Retro Office", ShortName: "RetroOffice", Archived: true}}
	r.proxies = []tg.Proxy{{ID: 1, Server: "proxy.example.net", Port: 1080, Kind: tg.ProxySOCKS5}}
	r.nextProxy = 2
	r.scheduled[DesignChat] = []tg.Message{func() tg.Message {
		m := msg(DesignChat, 900, AccountID, "Reminder: retro at 10.", Base.Add(18*time.Hour))
		m.ScheduledAt = m.SentAt
		return m
	}()}
	return r
}

// Close stops pending auto-replies.
func (r *Repository) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, t := range r.timers {
		t.Stop()
	}
}

// Subscribe delivers events until unsubscribed.
func (r *Repository) Subscribe(f func(tg.Event)) func() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextID++
	id := r.nextID
	r.subs[id] = f
	return func() {
		r.mu.Lock()
		delete(r.subs, id)
		r.mu.Unlock()
	}
}

func (r *Repository) emit(events ...tg.Event) {
	r.mu.Lock()
	subs := make([]func(tg.Event), 0, len(r.subs))
	for _, f := range r.subs {
		subs = append(subs, f)
	}
	r.mu.Unlock()
	for _, e := range events {
		for _, f := range subs {
			f(e)
		}
	}
}

func (r *Repository) chatIndex(id tg.ChatID) int {
	return slices.IndexFunc(r.chats, func(c tg.Chat) bool { return c.ID == id })
}

// setChat edits a chat in place; callers hold r.mu or run in New.
func (r *Repository) setChat(id tg.ChatID, edit func(*tg.Chat)) (tg.Chat, bool) {
	i := r.chatIndex(id)
	if i < 0 {
		return tg.Chat{}, false
	}
	edit(&r.chats[i])
	return r.chats[i], true
}

// update edits a chat and publishes it.
func (r *Repository) update(id tg.ChatID, edit func(*tg.Chat)) error {
	r.mu.Lock()
	c, ok := r.setChat(id, edit)
	r.mu.Unlock()
	if !ok {
		return tg.ErrNotFound
	}
	r.emit(tg.ChatUpserted{Chat: c})
	return nil
}

func (r *Repository) CurrentUser(context.Context) (tg.CurrentUser, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.user, nil
}

func (r *Repository) UpdateName(_ context.Context, n tg.ProfileName) (tg.CurrentUser, error) {
	r.mu.Lock()
	r.user.FirstName, r.user.LastName = strings.TrimSpace(n.FirstName), strings.TrimSpace(n.LastName)
	r.user.DisplayName = strings.TrimSpace(r.user.FirstName + " " + r.user.LastName)
	r.user.Initials = tg.Initials(r.user.DisplayName)
	u := r.user
	r.mu.Unlock()
	r.emit(tg.CurrentUserChanged{User: u})
	return u, nil
}

func (r *Repository) UpdateBio(_ context.Context, bio string) error {
	r.mu.Lock()
	r.user.Bio = strings.TrimSpace(bio)
	u := r.user
	r.mu.Unlock()
	r.emit(tg.CurrentUserChanged{User: u})
	return nil
}

func (r *Repository) CheckUsername(_ context.Context, name string) (tg.UsernameAvailability, error) {
	name = strings.TrimPrefix(strings.TrimSpace(name), "@")
	switch {
	case len(name) < 5 || strings.ContainsAny(name, " -."):
		return tg.UsernameInvalid, nil
	case slices.ContainsFunc([]string{"mina", "aron", "lev", "priya", "telobot", "durov"}, func(s string) bool { return strings.EqualFold(s, name) }):
		return tg.UsernameTaken, nil
	}
	return tg.UsernameAvailable, nil
}

func (r *Repository) SetUsername(ctx context.Context, name string) (tg.CurrentUser, error) {
	if a, _ := r.CheckUsername(ctx, name); a != tg.UsernameAvailable && strings.TrimSpace(name) != "" {
		return tg.CurrentUser{}, fmt.Errorf("demo: username %s is %s", name, a)
	}
	r.mu.Lock()
	r.user.Username = strings.TrimPrefix(strings.TrimSpace(name), "@")
	u := r.user
	r.mu.Unlock()
	r.emit(tg.CurrentUserChanged{User: u})
	return u, nil
}

func (r *Repository) SetProfilePhoto(_ context.Context, f tg.UploadFile) (tg.CurrentUser, error) {
	r.mu.Lock()
	r.user.Avatar = tg.Avatar{Path: f.Path, Placeholder: r.user.Avatar.Placeholder}
	u := r.user
	r.mu.Unlock()
	r.emit(tg.CurrentUserChanged{User: u}, tg.AvatarChanged{UserID: u.ID, ChatID: SavedChat, Avatar: u.Avatar})
	return u, nil
}

// sorted returns the chats in list order: pinned first, then by order.
func (r *Repository) sorted() []tg.Chat {
	out := slices.Clone(r.chats)
	slices.SortStableFunc(out, func(a, b tg.Chat) int { return cmp.Compare(b.ListOrder, a.ListOrder) })
	return out
}

func (r *Repository) ChatPage(_ context.Context, cursor string, limit int) (tg.ChatPage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	all := r.sorted()
	start := 0
	if cursor != "" {
		n, err := strconv.Atoi(cursor)
		if err != nil {
			return tg.ChatPage{}, fmt.Errorf("demo: bad cursor %q", cursor)
		}
		start = n
	}
	if limit <= 0 {
		limit = 50
	}
	end := min(len(all), start+limit)
	page := tg.ChatPage{Items: all[min(start, len(all)):end]}
	if end < len(all) {
		page.NextCursor = strconv.Itoa(end)
	}
	return page, nil
}

func (r *Repository) Chat(_ context.Context, id tg.ChatID) (tg.Chat, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if i := r.chatIndex(id); i >= 0 {
		return r.chats[i], nil
	}
	return tg.Chat{}, tg.ErrNotFound
}

func (r *Repository) OpenChat(context.Context, tg.ChatID, bool) error { return nil }

func (r *Repository) OpenSavedMessages(ctx context.Context) (tg.Chat, error) {
	return r.Chat(ctx, SavedChat)
}

func (r *Repository) OpenPrivateChat(ctx context.Context, user tg.UserID) (tg.Chat, error) {
	r.mu.Lock()
	for _, c := range r.chats {
		if c.Kind == tg.ChatDirect && c.UserID == user {
			r.mu.Unlock()
			return c, nil
		}
	}
	p, ok := peers[user]
	if !ok {
		r.mu.Unlock()
		return tg.Chat{}, tg.ErrNotFound
	}
	c := tg.Chat{ID: tg.ChatID(user), Title: p.name, Kind: tg.ChatDirect, UserID: user, UpdatedAt: r.opts.Now(), CanSendMessages: true, CanSendStickers: true,
		CanSendMedia: true, CanDeleteForAll: true, Initials: tg.Initials(p.name), Avatar: tg.Avatar{Placeholder: tg.Placeholder(p.name, p.accent)}, Online: p.online, ListOrder: r.topOrder()}
	r.chats = append(r.chats, c)
	r.mu.Unlock()
	r.emit(tg.ChatUpserted{Chat: c})
	return c, nil
}

// topOrder is an order above every unpinned chat.
func (r *Repository) topOrder() int64 {
	var top int64
	for _, c := range r.chats {
		if !c.Pinned && c.ListOrder > top {
			top = c.ListOrder
		}
	}
	return top + 1
}

func (r *Repository) newChat(title string, kind tg.ChatKind, user tg.UserID) tg.Chat {
	r.mu.Lock()
	r.nextChat++
	id := -r.nextChat
	if kind == tg.ChatSecret {
		id = r.nextChat
	}
	c := tg.Chat{ID: id, Title: title, Kind: kind, UserID: user, UpdatedAt: r.opts.Now(), CanSendMessages: true, CanSendStickers: kind != tg.ChatChannel || true,
		CanSendMedia: true, CanDeleteForAll: true, Initials: tg.Initials(title), Avatar: tg.Avatar{Placeholder: tg.Placeholder(title, int(r.nextChat%7))}, ListOrder: r.topOrder()}
	if kind == tg.ChatSecret {
		c.SecretState = tg.SecretPending
	}
	r.chats = append(r.chats, c)
	r.messages[id] = nil
	r.mu.Unlock()
	r.emit(tg.ChatUpserted{Chat: c})
	return c
}

func (r *Repository) CreateSecretChat(_ context.Context, user tg.UserID) (tg.Chat, error) {
	p, ok := peers[user]
	if !ok {
		return tg.Chat{}, tg.ErrNotFound
	}
	c := r.newChat(p.name, tg.ChatSecret, user)
	r.later(300*time.Millisecond, func() { _ = r.update(c.ID, func(x *tg.Chat) { x.SecretState = tg.SecretReady }) })
	return c, nil
}

func (r *Repository) CreateGroup(_ context.Context, in tg.CreateGroupInput) (tg.Chat, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return tg.Chat{}, fmt.Errorf("demo: a group needs a title")
	}
	c := r.newChat(title, tg.ChatGroup, 0)
	_ = r.update(c.ID, func(x *tg.Chat) { x.MemberCount = len(in.UserIDs) + 1 })
	return r.Chat(context.Background(), c.ID)
}

func (r *Repository) CreateChannel(_ context.Context, in tg.CreateChannelInput) (tg.Chat, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return tg.Chat{}, fmt.Errorf("demo: a channel needs a title")
	}
	c := r.newChat(title, tg.ChatChannel, 0)
	_ = r.update(c.ID, func(x *tg.Chat) { x.MemberCount = 1 })
	return r.Chat(context.Background(), c.ID)
}

func (r *Repository) SetChatPinned(_ context.Context, id tg.ChatID, pinned bool) error {
	return r.update(id, func(c *tg.Chat) {
		c.Pinned = pinned
		if pinned {
			c.ListOrder += 1 << 40
		} else if c.ListOrder > 1<<40 {
			c.ListOrder -= 1 << 40
		}
	})
}

func (r *Repository) MuteChat(_ context.Context, id tg.ChatID, d time.Duration) error {
	if id == SavedChat {
		return fmt.Errorf("demo: Saved Messages can't be muted")
	}
	return r.update(id, func(c *tg.Chat) { c.Muted = d != 0 })
}

func (r *Repository) SetChatRead(_ context.Context, id tg.ChatID, read bool) error {
	return r.update(id, func(c *tg.Chat) {
		if read {
			c.UnreadCount, c.UnreadMentions, c.MarkedUnread = 0, 0, false
			if ms := r.messages[id]; len(ms) > 0 {
				c.LastReadMessageID = ms[len(ms)-1].ID
			}
		} else {
			c.MarkedUnread = true
		}
	})
}

func (r *Repository) SetChatArchived(_ context.Context, id tg.ChatID, archived bool) error {
	return r.update(id, func(c *tg.Chat) {
		if archived {
			c.FolderID = tg.ArchiveFolderID
		} else if c.FolderID == tg.ArchiveFolderID {
			c.FolderID = 0
			if len(c.FolderIDs) > 0 {
				c.FolderID = c.FolderIDs[0]
			}
		}
	})
}

func (r *Repository) ClearHistory(_ context.Context, id tg.ChatID, _ bool) error {
	r.mu.Lock()
	var ids []tg.MessageID
	for _, m := range r.messages[id] {
		ids = append(ids, m.ID)
	}
	r.messages[id] = nil
	c, ok := r.setChat(id, func(c *tg.Chat) { c.Preview, c.UnreadCount = "", 0 })
	r.mu.Unlock()
	if !ok {
		return tg.ErrNotFound
	}
	r.emit(tg.MessagesDeleted{ChatID: id, IDs: ids}, tg.ChatUpserted{Chat: c})
	return nil
}

func (r *Repository) LeaveChat(_ context.Context, id tg.ChatID) error {
	r.mu.Lock()
	i := r.chatIndex(id)
	if i < 0 {
		r.mu.Unlock()
		return tg.ErrNotFound
	}
	r.chats = slices.Delete(r.chats, i, i+1)
	delete(r.messages, id)
	r.mu.Unlock()
	r.emit(tg.ChatRemoved{ChatID: id})
	return nil
}

func (r *Repository) SetTyping(context.Context, tg.ChatID, bool) error { return nil }

func (r *Repository) SaveDraft(_ context.Context, id tg.ChatID, text string) error {
	r.mu.Lock()
	r.drafts[id] = text
	r.mu.Unlock()
	return r.update(id, func(c *tg.Chat) { c.DraftPreview = strings.TrimSpace(text) })
}

func (r *Repository) SetAutoDelete(_ context.Context, id tg.ChatID, seconds int) error {
	return r.update(id, func(c *tg.Chat) { c.AutoDeleteSeconds = seconds })
}

func (r *Repository) Folders(context.Context) ([]tg.Folder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.foldersLocked(), nil
}

// foldersLocked counts each folder's unread messages.
func (r *Repository) foldersLocked() []tg.Folder {
	out := slices.Clone(r.folders)
	for i := range out {
		n := 0
		for _, c := range r.chats {
			if slices.Contains(c.FolderIDs, out[i].ID) && c.FolderID != tg.ArchiveFolderID {
				n += c.UnreadCount
			}
		}
		out[i].UnreadCount = n
	}
	return out
}

func (r *Repository) FolderDetails(_ context.Context, id int) (tg.FolderDetails, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	d, ok := r.details[id]
	if !ok {
		return tg.FolderDetails{}, tg.ErrNotFound
	}
	return d, nil
}

func (r *Repository) applyFolder(id int, in tg.FolderInput) {
	for i := range r.chats {
		c := &r.chats[i]
		c.FolderIDs = slices.DeleteFunc(c.FolderIDs, func(f int) bool { return f == id })
		if slices.Contains(in.ChatIDs, c.ID) {
			c.FolderIDs = append(c.FolderIDs, id)
		}
	}
}

func (r *Repository) CreateFolder(_ context.Context, in tg.FolderInput) (tg.Folder, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return tg.Folder{}, fmt.Errorf("demo: a folder needs a name")
	}
	r.mu.Lock()
	id := 3
	for _, f := range r.folders {
		id = max(id, f.ID+1)
	}
	f := tg.Folder{ID: id, Title: title, Kind: tg.FolderNative}
	r.folders = append(r.folders, f)
	r.details[id] = tg.FolderDetails{ID: id, Title: title, IncludedChatIDs: slices.Clone(in.ChatIDs)}
	r.applyFolder(id, in)
	folders := r.foldersLocked()
	r.mu.Unlock()
	r.emit(tg.FoldersChanged{Folders: folders})
	return f, nil
}

func (r *Repository) EditFolder(_ context.Context, id int, in tg.FolderInput) (tg.Folder, error) {
	r.mu.Lock()
	i := slices.IndexFunc(r.folders, func(f tg.Folder) bool { return f.ID == id })
	if i < 0 {
		r.mu.Unlock()
		return tg.Folder{}, tg.ErrNotFound
	}
	r.folders[i].Title = strings.TrimSpace(in.Title)
	d := r.details[id]
	d.Title, d.IncludedChatIDs = r.folders[i].Title, slices.Clone(in.ChatIDs)
	r.details[id] = d
	r.applyFolder(id, in)
	f := r.folders[i]
	folders := r.foldersLocked()
	r.mu.Unlock()
	r.emit(tg.FoldersChanged{Folders: folders})
	return f, nil
}

func (r *Repository) DeleteFolder(_ context.Context, id int) error {
	r.mu.Lock()
	r.folders = slices.DeleteFunc(r.folders, func(f tg.Folder) bool { return f.ID == id })
	delete(r.details, id)
	r.applyFolder(id, tg.FolderInput{})
	folders := r.foldersLocked()
	r.mu.Unlock()
	r.emit(tg.FoldersChanged{Folders: folders})
	return nil
}

func (r *Repository) AddChatToFolder(ctx context.Context, chat tg.ChatID, folder int, add bool) error {
	d, err := r.FolderDetails(ctx, folder)
	if err != nil {
		return err
	}
	ids := slices.DeleteFunc(slices.Clone(d.IncludedChatIDs), func(id tg.ChatID) bool { return id == chat })
	if add {
		ids = append(ids, chat)
	}
	_, err = r.EditFolder(ctx, folder, tg.FolderInput{Title: d.Title, ChatIDs: ids})
	return err
}

func (r *Repository) Messages(_ context.Context, chat tg.ChatID, before tg.MessageID, limit int) (tg.MessagePage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ms, ok := r.messages[chat]
	if !ok && r.chatIndex(chat) < 0 {
		return tg.MessagePage{}, tg.ErrNotFound
	}
	if limit <= 0 {
		limit = 50
	}
	end := len(ms)
	if before != 0 {
		end = slices.IndexFunc(ms, func(m tg.Message) bool { return m.ID >= before })
		if end < 0 {
			end = len(ms)
		}
	}
	start := max(0, end-limit)
	page := tg.MessagePage{}
	for i := end - 1; i >= start; i-- {
		page.Items = append(page.Items, ms[i])
	}
	if start > 0 {
		page.NextCursor = ms[start].ID
	}
	return page, nil
}

func (r *Repository) MessagesAround(ctx context.Context, chat tg.ChatID, around tg.MessageID, limit int) (tg.MessagePage, error) {
	r.mu.Lock()
	ms := r.messages[chat]
	i := slices.IndexFunc(ms, func(m tg.Message) bool { return m.ID == around })
	var before tg.MessageID
	if i >= 0 && i+limit/2+1 < len(ms) {
		before = ms[i+limit/2+1].ID
	}
	r.mu.Unlock()
	return r.Messages(ctx, chat, before, limit)
}

func (r *Repository) MessageAtDate(_ context.Context, chat tg.ChatID, at time.Time) (tg.MessageID, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var best tg.MessageID
	for _, m := range r.messages[chat] {
		if !m.SentAt.After(at) {
			best = m.ID
		}
	}
	if best == 0 && len(r.messages[chat]) > 0 {
		best = r.messages[chat][0].ID
	}
	if best == 0 {
		return 0, tg.ErrNotFound
	}
	return best, nil
}

func (r *Repository) SharedMedia(_ context.Context, chat tg.ChatID, kind tg.MediaKind, before tg.MessageID, limit int) (tg.MessagePage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var page tg.MessagePage
	ms := r.messages[chat]
	for i := len(ms) - 1; i >= 0; i-- {
		m := ms[i]
		if before != 0 && m.ID >= before {
			continue
		}
		if m.Media == nil {
			continue
		}
		match := m.Media.Kind == kind
		if kind == tg.MediaPhoto {
			match = m.Media.Kind == tg.MediaPhoto || m.Media.Kind == tg.MediaVideo
		}
		if match {
			page.Items = append(page.Items, m)
		}
	}
	return page, nil
}

func (r *Repository) PinnedMessages(_ context.Context, chat tg.ChatID) ([]tg.Message, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []tg.Message
	ms := r.messages[chat]
	for i := len(ms) - 1; i >= 0; i-- {
		if ms[i].Pinned {
			out = append(out, ms[i])
		}
	}
	return out, nil
}

func (r *Repository) ScheduledMessages(_ context.Context, chat tg.ChatID) ([]tg.Message, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.scheduled[chat]), nil
}

func (r *Repository) Members(_ context.Context, chat tg.ChatID, query string) ([]tg.Member, error) {
	if chat != DesignChat {
		return nil, nil
	}
	var out []tg.Member
	for _, id := range []tg.UserID{Mina, Aron, Lev, Priya} {
		p := peers[id]
		if query != "" && !strings.Contains(strings.ToLower(p.name+" "+p.username), strings.ToLower(query)) {
			continue
		}
		role := "member"
		if id == Mina {
			role = "creator"
		}
		out = append(out, tg.Member{ID: id, DisplayName: p.name, Username: p.username, Avatar: tg.Avatar{Placeholder: tg.Placeholder(p.name, p.accent)}, Role: role, Online: p.online})
	}
	return out, nil
}

func (r *Repository) PeerProfile(_ context.Context, chat tg.ChatID) (tg.PeerProfile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	i := r.chatIndex(chat)
	if i < 0 {
		if p, ok := peers[tg.UserID(chat)]; ok {
			return r.peerProfile(tg.Chat{ID: chat, Title: p.name, Kind: tg.ChatDirect, UserID: p.id}), nil
		}
		return tg.PeerProfile{}, tg.ErrNotFound
	}
	return r.peerProfile(r.chats[i]), nil
}

func (r *Repository) peerProfile(c tg.Chat) tg.PeerProfile {
	pp := tg.PeerProfile{ChatID: c.ID, UserID: c.UserID, Title: c.Title, Kind: c.Kind, Avatar: c.Avatar, MemberCount: c.MemberCount, Blocked: r.blocked[c.ID]}
	if p, ok := peers[c.UserID]; ok {
		pp.Username, pp.Bio, pp.Phone, pp.IsContact, pp.NeedPhonePrivacyException, pp.Online = p.username, p.bio, p.phone, r.contacts[p.id], p.needPhone, p.online
		pp.LastSeen = ago(3 * time.Hour)
		pp.CommonGroups = 1
	}
	switch c.Kind {
	case tg.ChatGroup:
		pp.Description, pp.InviteLink = "Where Telo's interface gets argued into shape.", "https://t.me/+teloDesignDemo"
	case tg.ChatChannel:
		pp.Description, pp.Username = "Release notes and product updates from the Telo team.", "telonotes"
	case tg.ChatSaved:
		pp.Username, pp.Phone, pp.Bio = r.user.Username, r.user.Phone, r.user.Bio
	}
	return pp
}
