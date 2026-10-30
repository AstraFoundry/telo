package live

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib/tdapi"
)

// notFound turns TDLib's 404 into the domain's.
func notFound(err error) error {
	var e *tdapi.Error
	if errors.As(err, &e) && e.Code == 404 {
		return tg.ErrNotFound
	}
	return err
}

func (s *Session) CurrentUser(ctx context.Context) (tg.CurrentUser, error) {
	me, err := s.td.GetMe(ctx, &tdapi.GetMeRequest{})
	if err != nil {
		return tg.CurrentUser{}, err
	}
	s.mu.Lock()
	s.myID = me.ID
	s.users[me.ID] = me
	s.watchUserPhoto(me)
	s.mu.Unlock()
	if info, err := s.td.GetUserFullInfo(ctx, &tdapi.GetUserFullInfoRequest{UserID: me.ID}); err == nil {
		s.mu.Lock()
		s.userInfo[me.ID] = info
		s.mu.Unlock()
	}
	return s.currentUser(), nil
}

// chatPageSize is how many chats each TDLib loadChats asks for.
const chatPageSize = 100

// ChatPage loads the main list and the archive from TDLib until the page
// is full or both are exhausted, and returns the chats in list order; the
// cursor counts the chats already returned.
func (s *Session) ChatPage(ctx context.Context, cursor string, limit int) (tg.ChatPage, error) {
	start := 0
	if cursor != "" {
		n, err := strconv.Atoi(cursor)
		if err != nil {
			return tg.ChatPage{}, err
		}
		start = n
	}
	if limit <= 0 {
		limit = chatPageSize
	}
	for {
		s.mu.Lock()
		have, done := s.listedLocked(), s.mainLoaded && s.archiveLoaded
		s.mu.Unlock()
		if len(have) >= start+limit || done {
			break
		}
		if err := s.loadMore(ctx); err != nil {
			return tg.ChatPage{}, err
		}
	}
	s.mu.Lock()
	all := s.listedLocked()
	done := s.mainLoaded && s.archiveLoaded
	s.mu.Unlock()
	end := min(len(all), start+limit)
	page := tg.ChatPage{Items: all[min(start, len(all)):end]}
	if end < len(all) || !done {
		page.NextCursor = strconv.Itoa(end)
	}
	return page, nil
}

// loadMore asks TDLib for the next chats of the lists not exhausted yet;
// a 404 means the list is complete.
func (s *Session) loadMore(ctx context.Context) error {
	for _, list := range []struct {
		l    tdapi.ChatList
		done *bool
	}{{&tdapi.ChatListMain{}, &s.mainLoaded}, {&tdapi.ChatListArchive{}, &s.archiveLoaded}} {
		s.mu.Lock()
		done := *list.done
		s.mu.Unlock()
		if done {
			continue
		}
		_, err := s.td.LoadChats(ctx, &tdapi.LoadChatsRequest{ChatList: list.l, Limit: chatPageSize})
		if tdapi.IsError(err, 404, "") {
			s.mu.Lock()
			*list.done = true
			s.mu.Unlock()
			continue
		}
		return err
	}
	return nil
}

// listedLocked returns the listed chats, pinned first, then by order;
// s.mu is held.
func (s *Session) listedLocked() []tg.Chat {
	var out []tg.Chat
	for _, c := range s.chats {
		if inList(c) {
			out = append(out, s.chatLocked(c))
		}
	}
	slices.SortFunc(out, func(a, b tg.Chat) int {
		if a.Pinned != b.Pinned {
			if a.Pinned {
				return -1
			}
			return 1
		}
		switch {
		case a.ListOrder > b.ListOrder:
			return -1
		case a.ListOrder < b.ListOrder:
			return 1
		}
		return 0
	})
	return out
}

func (s *Session) Chat(ctx context.Context, id tg.ChatID) (tg.Chat, error) {
	if c, ok := s.chat(int64(id)); ok {
		return c, nil
	}
	c, err := s.td.GetChat(ctx, &tdapi.GetChatRequest{ChatID: int64(id)})
	if err != nil {
		return tg.Chat{}, notFound(err)
	}
	s.mu.Lock()
	s.chats[c.ID] = c
	out := s.chatLocked(c)
	s.mu.Unlock()
	return out, nil
}

func (s *Session) OpenChat(ctx context.Context, id tg.ChatID, open bool) error {
	if open {
		_, err := s.td.OpenChat(ctx, &tdapi.OpenChatRequest{ChatID: int64(id)})
		return err
	}
	_, err := s.td.CloseChat(ctx, &tdapi.CloseChatRequest{ChatID: int64(id)})
	return err
}

func (s *Session) openPrivate(ctx context.Context, user int64) (tg.Chat, error) {
	c, err := s.td.CreatePrivateChat(ctx, &tdapi.CreatePrivateChatRequest{UserID: user})
	if err != nil {
		return tg.Chat{}, notFound(err)
	}
	return s.Chat(ctx, tg.ChatID(c.ID))
}

func (s *Session) OpenSavedMessages(ctx context.Context) (tg.Chat, error) {
	s.mu.Lock()
	me := s.myID
	s.mu.Unlock()
	return s.openPrivate(ctx, me)
}

func (s *Session) OpenPrivateChat(ctx context.Context, user tg.UserID) (tg.Chat, error) {
	return s.openPrivate(ctx, int64(user))
}

func (s *Session) CreateSecretChat(ctx context.Context, user tg.UserID) (tg.Chat, error) {
	c, err := s.td.CreateNewSecretChat(ctx, &tdapi.CreateNewSecretChatRequest{UserID: int64(user)})
	if err != nil {
		return tg.Chat{}, err
	}
	return s.Chat(ctx, tg.ChatID(c.ID))
}

func (s *Session) CreateGroup(ctx context.Context, in tg.CreateGroupInput) (tg.Chat, error) {
	ids := make([]int64, len(in.UserIDs))
	for i, u := range in.UserIDs {
		ids[i] = int64(u)
	}
	c, err := s.td.CreateNewBasicGroupChat(ctx, &tdapi.CreateNewBasicGroupChatRequest{UserIDs: ids, Title: in.Title})
	if err != nil {
		return tg.Chat{}, err
	}
	return s.Chat(ctx, tg.ChatID(c.ChatID))
}

func (s *Session) CreateChannel(ctx context.Context, in tg.CreateChannelInput) (tg.Chat, error) {
	c, err := s.td.CreateNewSupergroupChat(ctx, &tdapi.CreateNewSupergroupChatRequest{Title: in.Title, IsChannel: true, Description: in.Description})
	if err != nil {
		return tg.Chat{}, err
	}
	return s.Chat(ctx, tg.ChatID(c.ID))
}

// listOf is the list a chat is pinned in: the archive or the main list.
func (s *Session) listOf(id tg.ChatID) tdapi.ChatList {
	if c, ok := s.chat(int64(id)); ok && c.FolderID == tg.ArchiveFolderID {
		return &tdapi.ChatListArchive{}
	}
	return &tdapi.ChatListMain{}
}

func (s *Session) SetChatPinned(ctx context.Context, id tg.ChatID, pinned bool) error {
	_, err := s.td.ToggleChatIsPinned(ctx, &tdapi.ToggleChatIsPinnedRequest{ChatList: s.listOf(id), ChatID: int64(id), IsPinned: pinned})
	return err
}

// muteForever is the mute TDLib reads as forever (over a year).
const muteForever = 366 * 24 * 3600

func (s *Session) MuteChat(ctx context.Context, id tg.ChatID, d time.Duration) error {
	s.mu.Lock()
	c := s.chats[int64(id)]
	var settings tdapi.ChatNotificationSettings
	if c != nil && c.NotificationSettings != nil {
		settings = *c.NotificationSettings
	}
	s.mu.Unlock()
	settings.UseDefaultMuteFor = false
	switch {
	case d < 0:
		settings.MuteFor = muteForever
	default:
		settings.MuteFor = int32(d / time.Second)
	}
	_, err := s.td.SetChatNotificationSettings(ctx, &tdapi.SetChatNotificationSettingsRequest{ChatID: int64(id), NotificationSettings: &settings})
	return err
}

func (s *Session) SetChatRead(ctx context.Context, id tg.ChatID, read bool) error {
	if !read {
		_, err := s.td.ToggleChatIsMarkedAsUnread(ctx, &tdapi.ToggleChatIsMarkedAsUnreadRequest{ChatID: int64(id), IsMarkedAsUnread: true})
		return err
	}
	s.mu.Lock()
	c := s.chats[int64(id)]
	var last int64
	marked := false
	if c != nil {
		marked = c.IsMarkedAsUnread
		if c.LastMessage != nil {
			last = c.LastMessage.ID
		}
	}
	s.mu.Unlock()
	if marked {
		if _, err := s.td.ToggleChatIsMarkedAsUnread(ctx, &tdapi.ToggleChatIsMarkedAsUnreadRequest{ChatID: int64(id)}); err != nil {
			return err
		}
	}
	if last != 0 {
		if _, err := s.td.ViewMessages(ctx, &tdapi.ViewMessagesRequest{ChatID: int64(id), MessageIDs: []int64{last}, ForceRead: true}); err != nil {
			return err
		}
	}
	_, err := s.td.ReadAllChatMentions(ctx, &tdapi.ReadAllChatMentionsRequest{ChatID: int64(id)})
	return err
}

func (s *Session) SetChatArchived(ctx context.Context, id tg.ChatID, archived bool) error {
	var list tdapi.ChatList = &tdapi.ChatListMain{}
	if archived {
		list = &tdapi.ChatListArchive{}
	}
	_, err := s.td.AddChatToList(ctx, &tdapi.AddChatToListRequest{ChatID: int64(id), ChatList: list})
	return err
}

func (s *Session) ClearHistory(ctx context.Context, id tg.ChatID, forEveryone bool) error {
	_, err := s.td.DeleteChatHistory(ctx, &tdapi.DeleteChatHistoryRequest{ChatID: int64(id), Revoke: forEveryone})
	return err
}

func (s *Session) LeaveChat(ctx context.Context, id tg.ChatID) error {
	s.mu.Lock()
	c := s.chats[int64(id)]
	var kind tg.ChatKind
	var secretID int32
	if c != nil {
		kind = s.kindLocked(c)
		if t, ok := c.Type.(*tdapi.ChatTypeSecret); ok {
			secretID = t.SecretChatID
		}
	}
	s.mu.Unlock()
	switch kind {
	case tg.ChatGroup, tg.ChatChannel:
		_, err := s.td.LeaveChat(ctx, &tdapi.LeaveChatRequest{ChatID: int64(id)})
		return err
	case tg.ChatSecret:
		if _, err := s.td.CloseSecretChat(ctx, &tdapi.CloseSecretChatRequest{SecretChatID: secretID}); err != nil {
			return err
		}
	}
	_, err := s.td.DeleteChatHistory(ctx, &tdapi.DeleteChatHistoryRequest{ChatID: int64(id), RemoveFromChatList: true})
	return err
}

func (s *Session) SetTyping(ctx context.Context, id tg.ChatID, typing bool) error {
	var action tdapi.ChatAction = &tdapi.ChatActionTyping{}
	if !typing {
		action = &tdapi.ChatActionCancel{}
	}
	_, err := s.td.SendChatAction(ctx, &tdapi.SendChatActionRequest{ChatID: int64(id), Action: action})
	return err
}

func (s *Session) SaveDraft(ctx context.Context, id tg.ChatID, text string) error {
	var draft *tdapi.DraftMessage
	if text != "" {
		draft = &tdapi.DraftMessage{Content: &tdapi.DraftMessageContentText{Text: &tdapi.FormattedText{Text: text}}}
	}
	_, err := s.td.SetChatDraftMessage(ctx, &tdapi.SetChatDraftMessageRequest{ChatID: int64(id), DraftMessage: draft})
	return err
}

func (s *Session) SetAutoDelete(ctx context.Context, id tg.ChatID, seconds int) error {
	_, err := s.td.SetChatMessageAutoDeleteTime(ctx, &tdapi.SetChatMessageAutoDeleteTimeRequest{ChatID: int64(id), MessageAutoDeleteTime: int32(seconds)})
	return err
}

func (s *Session) Folders(context.Context) ([]tg.Folder, error) { return s.folderTabs(), nil }

func (s *Session) FolderDetails(ctx context.Context, id int) (tg.FolderDetails, error) {
	f, err := s.td.GetChatFolder(ctx, &tdapi.GetChatFolderRequest{ChatFolderID: int32(id)})
	if err != nil {
		return tg.FolderDetails{}, notFound(err)
	}
	out := tg.FolderDetails{ID: id, IncludeContacts: f.IncludeContacts, IncludeNonContacts: f.IncludeNonContacts,
		IncludeGroups: f.IncludeGroups, IncludeChannels: f.IncludeChannels, IncludeBots: f.IncludeBots,
		ExcludeMuted: f.ExcludeMuted, ExcludeRead: f.ExcludeRead, ExcludeArchived: f.ExcludeArchived}
	if f.Name != nil && f.Name.Text != nil {
		out.Title = f.Name.Text.Text
	}
	for _, c := range append(slices.Clone(f.PinnedChatIDs), f.IncludedChatIDs...) {
		out.IncludedChatIDs = append(out.IncludedChatIDs, tg.ChatID(c))
	}
	return out, nil
}

func folderOf(in tg.FolderInput, base *tdapi.ChatFolder) *tdapi.ChatFolder {
	f := &tdapi.ChatFolder{}
	if base != nil {
		*f = *base
	}
	f.Name = &tdapi.ChatFolderName{Text: &tdapi.FormattedText{Text: in.Title}}
	f.PinnedChatIDs = slices.DeleteFunc(slices.Clone(f.PinnedChatIDs), func(id int64) bool {
		return !slices.Contains(in.ChatIDs, tg.ChatID(id))
	})
	f.IncludedChatIDs = nil
	for _, id := range in.ChatIDs {
		if !slices.Contains(f.PinnedChatIDs, int64(id)) {
			f.IncludedChatIDs = append(f.IncludedChatIDs, int64(id))
		}
	}
	return f
}

func folderInfo(f *tdapi.ChatFolderInfo) tg.Folder {
	out := tg.Folder{ID: int(f.ID), Kind: tg.FolderNative}
	if f.Name != nil && f.Name.Text != nil {
		out.Title = f.Name.Text.Text
	}
	return out
}

func (s *Session) CreateFolder(ctx context.Context, in tg.FolderInput) (tg.Folder, error) {
	f, err := s.td.CreateChatFolder(ctx, &tdapi.CreateChatFolderRequest{Folder: folderOf(in, nil)})
	if err != nil {
		return tg.Folder{}, err
	}
	return folderInfo(f), nil
}

func (s *Session) EditFolder(ctx context.Context, id int, in tg.FolderInput) (tg.Folder, error) {
	base, err := s.td.GetChatFolder(ctx, &tdapi.GetChatFolderRequest{ChatFolderID: int32(id)})
	if err != nil {
		return tg.Folder{}, notFound(err)
	}
	f, err := s.td.EditChatFolder(ctx, &tdapi.EditChatFolderRequest{ChatFolderID: int32(id), Folder: folderOf(in, base)})
	if err != nil {
		return tg.Folder{}, err
	}
	return folderInfo(f), nil
}

func (s *Session) DeleteFolder(ctx context.Context, id int) error {
	_, err := s.td.DeleteChatFolder(ctx, &tdapi.DeleteChatFolderRequest{ChatFolderID: int32(id)})
	return err
}

func (s *Session) AddChatToFolder(ctx context.Context, chat tg.ChatID, folder int, add bool) error {
	base, err := s.td.GetChatFolder(ctx, &tdapi.GetChatFolderRequest{ChatFolderID: int32(folder)})
	if err != nil {
		return notFound(err)
	}
	id := int64(chat)
	if add {
		if !slices.Contains(base.IncludedChatIDs, id) && !slices.Contains(base.PinnedChatIDs, id) {
			base.IncludedChatIDs = append(base.IncludedChatIDs, id)
		}
		base.ExcludedChatIDs = slices.DeleteFunc(base.ExcludedChatIDs, func(x int64) bool { return x == id })
	} else {
		base.IncludedChatIDs = slices.DeleteFunc(base.IncludedChatIDs, func(x int64) bool { return x == id })
		base.PinnedChatIDs = slices.DeleteFunc(base.PinnedChatIDs, func(x int64) bool { return x == id })
	}
	_, err = s.td.EditChatFolder(ctx, &tdapi.EditChatFolderRequest{ChatFolderID: int32(folder), Folder: base})
	return err
}
