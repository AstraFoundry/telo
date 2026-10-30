package live

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib/tdapi"
)

func unix(sec int32) time.Time {
	if sec == 0 {
		return time.Time{}
	}
	return time.Unix(int64(sec), 0)
}

func downloaded(f *tdapi.File) string {
	if f != nil && f.Local != nil && f.Local.IsDownloadingCompleted {
		return f.Local.Path
	}
	return ""
}

func fileID(f *tdapi.File) tg.FileID {
	if f == nil {
		return 0
	}
	return tg.FileID(f.ID)
}

func mini(m *tdapi.Minithumbnail) []byte {
	if m == nil {
		return nil
	}
	return m.Data
}

func hexColor(rgb int32) string { return fmt.Sprintf("#%06X", rgb&0xffffff) }

// placeholderLocked is the lettered disc of a peer without a picture, in
// the colors TDLib's accent color id names; s.mu is held.
func (s *Session) placeholderLocked(title string, accent int32) *tg.AvatarPlaceholder {
	if c, ok := s.accents[accent]; ok && len(c.LightThemeColors) > 0 {
		p := tg.Placeholder(title, int(c.BuiltInAccentColorID))
		p.LightColors, p.DarkColors = nil, nil
		for _, v := range c.LightThemeColors {
			p.LightColors = append(p.LightColors, hexColor(v))
		}
		for _, v := range c.DarkThemeColors {
			p.DarkColors = append(p.DarkColors, hexColor(v))
		}
		return p
	}
	return tg.Placeholder(title, int(accent))
}

func (s *Session) avatarLocked(small *tdapi.File, m *tdapi.Minithumbnail, title string, accent int32) tg.Avatar {
	a := tg.Avatar{Minithumbnail: mini(m), Placeholder: s.placeholderLocked(title, accent)}
	if small != nil {
		a.Path = downloaded(s.fileState(small))
		a.Pending = a.Path == ""
	}
	return a
}

func userName(u *tdapi.User) string {
	if u == nil {
		return ""
	}
	return strings.TrimSpace(u.FirstName + " " + u.LastName)
}

func username(u *tdapi.Usernames) string {
	if u == nil || len(u.ActiveUsernames) == 0 {
		return ""
	}
	return u.ActiveUsernames[0]
}

func (s *Session) userAvatarLocked(u *tdapi.User) tg.Avatar {
	if u == nil {
		return tg.Avatar{Placeholder: tg.Placeholder("", 0)}
	}
	var small *tdapi.File
	var m *tdapi.Minithumbnail
	if u.ProfilePhoto != nil {
		small, m = u.ProfilePhoto.Small, u.ProfilePhoto.Minithumbnail
	}
	return s.avatarLocked(small, m, userName(u), u.AccentColorID)
}

func (s *Session) userAvatar(id int64) tg.Avatar {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.userAvatarLocked(s.users[id])
}

func online(u *tdapi.User) bool {
	if u == nil {
		return false
	}
	_, ok := u.Status.(*tdapi.UserStatusOnline)
	return ok
}

func (s *Session) currentUser() tg.CurrentUser {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.users[s.myID]
	if u == nil {
		return tg.CurrentUser{ID: tg.UserID(s.myID)}
	}
	name := userName(u)
	out := tg.CurrentUser{ID: tg.UserID(u.ID), DisplayName: name, FirstName: u.FirstName, LastName: u.LastName,
		Username: username(u.Usernames), Phone: u.PhoneNumber, Initials: tg.Initials(name), Avatar: s.userAvatarLocked(u)}
	if info := s.userInfo[u.ID]; info != nil && info.Bio != nil {
		out.Bio = info.Bio.Text
	}
	return out
}

// kindLocked names what a chat is; s.mu is held.
func (s *Session) kindLocked(c *tdapi.Chat) tg.ChatKind {
	switch t := c.Type.(type) {
	case *tdapi.ChatTypeSecret:
		return tg.ChatSecret
	case *tdapi.ChatTypeBasicGroup:
		return tg.ChatGroup
	case *tdapi.ChatTypeSupergroup:
		if t.IsChannel {
			return tg.ChatChannel
		}
		return tg.ChatGroup
	case *tdapi.ChatTypePrivate:
		if t.UserID == s.myID {
			return tg.ChatSaved
		}
	}
	return tg.ChatDirect
}

func peerUser(c *tdapi.Chat) int64 {
	switch t := c.Type.(type) {
	case *tdapi.ChatTypePrivate:
		return t.UserID
	case *tdapi.ChatTypeSecret:
		return t.UserID
	}
	return 0
}

// permissionsLocked tells what the account may post, as TDLib's own rule
// in getChatPermissions: the member status, else the chat's defaults.
func (s *Session) permissionsLocked(c *tdapi.Chat) (text, stickers, media bool) {
	defaults := func(p *tdapi.ChatPermissions) (bool, bool, bool) {
		if p == nil {
			return true, true, true
		}
		return p.CanSendBasicMessages, p.CanSendOtherMessages,
			p.CanSendPhotos || p.CanSendVideos || p.CanSendDocuments || p.CanSendAudios || p.CanSendVoiceNotes
	}
	status := func(st tdapi.ChatMemberStatus) (bool, bool, bool, bool) {
		switch st := st.(type) {
		case *tdapi.ChatMemberStatusCreator:
			return true, true, true, true
		case *tdapi.ChatMemberStatusAdministrator:
			return true, true, true, true
		case *tdapi.ChatMemberStatusRestricted:
			t, k, m := defaults(st.Permissions)
			return t, k, m, true
		case *tdapi.ChatMemberStatusLeft, *tdapi.ChatMemberStatusBanned:
			return false, false, false, true
		}
		return false, false, false, false
	}
	switch t := c.Type.(type) {
	case *tdapi.ChatTypeSecret:
		sc := s.secret[t.SecretChatID]
		ready := sc != nil
		if ready {
			_, ready = sc.State.(*tdapi.SecretChatStateReady)
		}
		return ready, ready, ready
	case *tdapi.ChatTypePrivate:
		if u := s.users[t.UserID]; u != nil {
			if _, deleted := u.Type.(*tdapi.UserTypeDeleted); deleted {
				return false, false, false
			}
		}
		return defaults(c.Permissions)
	case *tdapi.ChatTypeBasicGroup:
		if g := s.basic[t.BasicGroupID]; g != nil {
			if tx, k, m, decided := status(g.Status); decided {
				return tx, k, m
			}
		}
		return defaults(c.Permissions)
	case *tdapi.ChatTypeSupergroup:
		g := s.super[t.SupergroupID]
		if g == nil {
			return defaults(c.Permissions)
		}
		if t.IsChannel {
			switch st := g.Status.(type) {
			case *tdapi.ChatMemberStatusCreator:
				return true, true, true
			case *tdapi.ChatMemberStatusAdministrator:
				ok := st.Rights != nil && st.Rights.CanPostMessages
				return ok, ok, ok
			}
			return false, false, false
		}
		if tx, k, m, decided := status(g.Status); decided {
			return tx, k, m
		}
		return defaults(c.Permissions)
	}
	return defaults(c.Permissions)
}

func (s *Session) chat(id int64) (tg.Chat, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.chats[id]
	if c == nil {
		return tg.Chat{}, false
	}
	return s.chatLocked(c), true
}

// chatLocked maps a chat; s.mu is held.
func (s *Session) chatLocked(c *tdapi.Chat) tg.Chat {
	kind := s.kindLocked(c)
	text, stickers, media := s.permissionsLocked(c)
	out := tg.Chat{
		ID: tg.ChatID(c.ID), Title: c.Title, Kind: kind, UnreadCount: int(c.UnreadCount), UnreadMentions: int(c.UnreadMentionCount),
		LastReadMessageID: tg.MessageID(c.LastReadInboxMessageID), LastReadOutboxID: tg.MessageID(c.LastReadOutboxMessageID),
		MarkedUnread: c.IsMarkedAsUnread, CanSendMessages: text, CanSendStickers: stickers, CanSendMedia: media,
		CanDeleteForAll: c.CanBeDeletedForAllUsers, Initials: tg.Initials(c.Title), DraftPreview: draftText(c.DraftMessage),
		AutoDeleteSeconds: int(c.MessageAutoDeleteTime), UserID: tg.UserID(peerUser(c)),
	}
	if c.NotificationSettings != nil {
		out.Muted = c.NotificationSettings.MuteFor > 0
	}
	var small *tdapi.File
	var m *tdapi.Minithumbnail
	if c.Photo != nil {
		small, m = c.Photo.Small, c.Photo.Minithumbnail
	}
	out.Avatar = s.avatarLocked(small, m, c.Title, c.AccentColorID)
	if c.LastMessage != nil {
		last := s.messageLocked(c.LastMessage)
		out.LastMessage = &last
		out.Preview, out.UpdatedAt = last.Body, last.SentAt
	}
	if until, ok := s.typing[c.ID]; ok && time.Now().Before(until) {
		out.Typing = true
	}
	if kind == tg.ChatDirect || kind == tg.ChatSecret {
		out.Online = online(s.users[peerUser(c)])
	}
	for _, p := range c.Positions {
		switch l := p.List.(type) {
		case *tdapi.ChatListMain:
			out.Pinned, out.ListOrder = p.IsPinned, int64(p.Order)
		case *tdapi.ChatListArchive:
			out.FolderID, out.ListOrder = tg.ArchiveFolderID, int64(p.Order)
			out.Pinned = p.IsPinned
		case *tdapi.ChatListFolder:
			out.FolderIDs = append(out.FolderIDs, int(l.ChatFolderID))
		}
	}
	for _, l := range c.ChatLists {
		if f, ok := l.(*tdapi.ChatListFolder); ok && !slices.Contains(out.FolderIDs, int(f.ChatFolderID)) {
			out.FolderIDs = append(out.FolderIDs, int(f.ChatFolderID))
		}
	}
	switch t := c.Type.(type) {
	case *tdapi.ChatTypeSecret:
		out.SecretState = tg.SecretPending
		if sc := s.secret[t.SecretChatID]; sc != nil {
			switch sc.State.(type) {
			case *tdapi.SecretChatStateReady:
				out.SecretState = tg.SecretReady
			case *tdapi.SecretChatStateClosed:
				out.SecretState = tg.SecretClosed
			}
		}
	case *tdapi.ChatTypeBasicGroup:
		if g := s.basic[t.BasicGroupID]; g != nil {
			out.MemberCount = int(g.MemberCount)
		}
	case *tdapi.ChatTypeSupergroup:
		if g := s.super[t.SupergroupID]; g != nil {
			out.MemberCount = int(g.MemberCount)
		}
	}
	if _, ok := c.BlockList.(*tdapi.BlockListMain); ok {
		out.Blocked = true
	}
	return out
}

func draftText(d *tdapi.DraftMessage) string {
	if d == nil {
		return ""
	}
	if t, ok := d.Content.(*tdapi.DraftMessageContentText); ok && t.Text != nil {
		return t.Text.Text
	}
	return ""
}

func (s *Session) folderTabs() []tg.Folder {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]tg.Folder, 0, len(s.folders))
	for _, f := range s.folders {
		title := ""
		if f.Name != nil && f.Name.Text != nil {
			title = f.Name.Text.Text
		}
		out = append(out, tg.Folder{ID: int(f.ID), Title: title, Kind: tg.FolderNative})
	}
	return out
}

// senderLocked names a message's sender and its picture; s.mu is held.
func (s *Session) senderLocked(sender tdapi.MessageSender) (string, int64, tg.Avatar) {
	switch v := sender.(type) {
	case *tdapi.MessageSenderUser:
		u := s.users[v.UserID]
		return userName(u), v.UserID, s.userAvatarLocked(u)
	case *tdapi.MessageSenderChat:
		c := s.chats[v.ChatID]
		if c == nil {
			return "", v.ChatID, tg.Avatar{Placeholder: tg.Placeholder("", 0)}
		}
		var small *tdapi.File
		var m *tdapi.Minithumbnail
		if c.Photo != nil {
			small, m = c.Photo.Small, c.Photo.Minithumbnail
		}
		return c.Title, v.ChatID, s.avatarLocked(small, m, c.Title, c.AccentColorID)
	}
	return "", 0, tg.Avatar{Placeholder: tg.Placeholder("", 0)}
}

func (s *Session) message(m *tdapi.Message) tg.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.messageLocked(m)
}

// messageLocked maps a message; s.mu is held.
func (s *Session) messageLocked(m *tdapi.Message) tg.Message {
	name, sender, avatar := s.senderLocked(m.SenderID)
	out := tg.Message{
		ID: tg.MessageID(m.ID), ChatID: tg.ChatID(m.ChatID), SenderName: name, SenderID: sender, SenderAvatar: avatar,
		AlbumID: int64(m.MediaAlbumID), SentAt: unix(m.Date), EditedAt: unix(m.EditDate), Outgoing: m.IsOutgoing, Pinned: m.IsPinned,
		CanForward: m.CanBeSaved, Status: tg.StatusSent,
	}
	if c := s.chats[m.ChatID]; c != nil {
		out.CanDeleteForAll = c.CanBeDeletedForAllUsers || m.IsOutgoing
		if m.IsOutgoing && m.ID <= c.LastReadOutboxMessageID {
			out.Status = tg.StatusRead
		}
		out.CanEdit = m.IsOutgoing && m.ID > 0 && time.Since(unix(m.Date)) < 48*time.Hour && editable(m.Content)
		if s.kindLocked(c) == tg.ChatSaved {
			out.CanEdit = editable(m.Content)
		}
	}
	switch st := m.SendingState.(type) {
	case *tdapi.MessageSendingStatePending:
		out.Status = tg.StatusSending
		out.ClientID = s.pending[m.ID]
		if out.ClientID == "" {
			out.ClientID = strconv.Itoa(int(st.SendingID))
		}
	case *tdapi.MessageSendingStateFailed:
		out.Status = tg.StatusFailed
		out.ClientID = s.pending[m.ID]
	}
	if st, ok := m.SchedulingState.(*tdapi.MessageSchedulingStateSendAtDate); ok {
		out.ScheduledAt = unix(st.SendDate)
	}
	if info := m.InteractionInfo; info != nil {
		out.Views = int(info.ViewCount)
		if info.Reactions != nil {
			for _, r := range info.Reactions.Reactions {
				if e, ok := r.Type.(*tdapi.ReactionTypeEmoji); ok {
					out.Reactions = append(out.Reactions, tg.Reaction{Emoji: e.Emoji, Count: int(r.TotalCount), Chosen: r.IsChosen})
				}
			}
		}
	}
	if f := m.ForwardInfo; f != nil {
		out.Forward = s.forwardLocked(f)
	}
	if r, ok := m.ReplyTo.(*tdapi.MessageReplyToMessage); ok {
		out.ReplyTo = s.replyLocked(m.ChatID, r)
	}
	if k, ok := m.ReplyMarkup.(*tdapi.ReplyMarkupInlineKeyboard); ok {
		out.Keyboard = keyboard(k)
	}
	s.contentLocked(&out, m.Content)
	if m.IsOutgoing {
		u := s.users[s.myID]
		out.SenderName, out.SenderID = userName(u), s.myID
	}
	return out
}

func editable(c tdapi.MessageContent) bool {
	switch c.(type) {
	case *tdapi.MessageText, *tdapi.MessagePhoto, *tdapi.MessageVideo, *tdapi.MessageDocument, *tdapi.MessageAudio, *tdapi.MessageAnimation, *tdapi.MessageVoiceNote:
		return true
	}
	return false
}

func (s *Session) forwardLocked(f *tdapi.MessageForwardInfo) *tg.Forward {
	out := &tg.Forward{}
	switch o := f.Origin.(type) {
	case *tdapi.MessageOriginUser:
		out.SenderName, out.SenderID = userName(s.users[o.SenderUserID]), o.SenderUserID
	case *tdapi.MessageOriginHiddenUser:
		out.SenderName = o.SenderName
	case *tdapi.MessageOriginChat:
		if c := s.chats[o.SenderChatID]; c != nil {
			out.SenderName = c.Title
		}
		out.SenderID, out.PostAuthor = o.SenderChatID, o.AuthorSignature
	case *tdapi.MessageOriginChannel:
		if c := s.chats[o.ChatID]; c != nil {
			out.SenderName = c.Title
		}
		out.SenderID, out.MessageID, out.PostAuthor = o.ChatID, tg.MessageID(o.MessageID), o.AuthorSignature
	}
	return out
}

// replyLocked describes the replied message from what TDLib carries or
// the cache; s.mu is held.
func (s *Session) replyLocked(chat int64, r *tdapi.MessageReplyToMessage) *tg.ReplyTo {
	out := &tg.ReplyTo{ID: tg.MessageID(r.MessageID)}
	if r.ChatID != 0 && r.ChatID != chat {
		// A reply to another chat's message shows its origin only.
		out.ID = 0
	}
	if r.Quote != nil && r.Quote.Text != nil {
		out.Quote = r.Quote.Text.Text
	}
	if r.Origin != nil {
		f := s.forwardLocked(&tdapi.MessageForwardInfo{Origin: r.Origin})
		out.SenderName = f.SenderName
	}
	if r.Content != nil {
		var m tg.Message
		s.contentLocked(&m, r.Content)
		out.Body, out.Entities = m.Body, m.Entities
	}
	return out
}

func keyboard(k *tdapi.ReplyMarkupInlineKeyboard) *tg.Keyboard {
	out := &tg.Keyboard{}
	for i, row := range k.Rows {
		var r []tg.Button
		for j, b := range row {
			btn := tg.Button{ID: fmt.Sprintf("%d:%d", i, j), Text: b.Text, Kind: tg.ButtonUnsupported}
			switch t := b.Type.(type) {
			case *tdapi.InlineKeyboardButtonTypeCallback:
				btn.Kind = tg.ButtonCallback
			case *tdapi.InlineKeyboardButtonTypeURL:
				btn.Kind, btn.URL = tg.ButtonURL, t.URL
			case *tdapi.InlineKeyboardButtonTypeCopyText:
				btn.Kind, btn.CopyText = tg.ButtonCopy, t.Text
			}
			r = append(r, btn)
		}
		out.Rows = append(out.Rows, r)
	}
	return out
}

func formatted(m *tg.Message, t *tdapi.FormattedText) {
	if t == nil {
		return
	}
	m.Body, m.Entities = t.Text, entities(t.Entities)
	if len(t.Entities) == 0 {
		m.IsolatedEmoji = tg.IsolatedEmojiCount(t.Text)
	}
}

func entities(in []*tdapi.TextEntity) []tg.Entity {
	var out []tg.Entity
	for _, e := range in {
		x := tg.Entity{Offset: int(e.Offset), Length: int(e.Length)}
		switch t := e.Type.(type) {
		case *tdapi.TextEntityTypeBold:
			x.Type = tg.EntityBold
		case *tdapi.TextEntityTypeItalic:
			x.Type = tg.EntityItalic
		case *tdapi.TextEntityTypeUnderline:
			x.Type = tg.EntityUnderline
		case *tdapi.TextEntityTypeStrikethrough:
			x.Type = tg.EntityStrikethrough
		case *tdapi.TextEntityTypeSpoiler:
			x.Type = tg.EntitySpoiler
		case *tdapi.TextEntityTypeCode:
			x.Type = tg.EntityCode
		case *tdapi.TextEntityTypePre:
			x.Type = tg.EntityPre
		case *tdapi.TextEntityTypePreCode:
			x.Type, x.Language = tg.EntityPre, t.Language
		case *tdapi.TextEntityTypeMention:
			x.Type = tg.EntityMention
		case *tdapi.TextEntityTypeHashtag:
			x.Type = tg.EntityHashtag
		case *tdapi.TextEntityTypeCashtag:
			x.Type = tg.EntityCashtag
		case *tdapi.TextEntityTypeBotCommand:
			x.Type = tg.EntityBotCommand
		case *tdapi.TextEntityTypeURL:
			x.Type = tg.EntityURL
		case *tdapi.TextEntityTypeEmailAddress:
			x.Type = tg.EntityEmail
		case *tdapi.TextEntityTypePhoneNumber:
			x.Type = tg.EntityPhone
		case *tdapi.TextEntityTypeBankCardNumber:
			x.Type = tg.EntityBankCard
		case *tdapi.TextEntityTypeTextURL:
			x.Type, x.URL = tg.EntityTextLink, t.URL
		case *tdapi.TextEntityTypeMentionName:
			x.Type, x.UserID = tg.EntityTextMention, tg.UserID(t.UserID)
		case *tdapi.TextEntityTypeCustomEmoji:
			x.Type, x.CustomEmojiID = tg.EntityCustomEmoji, int64(t.CustomEmojiID)
		case *tdapi.TextEntityTypeBlockQuote:
			x.Type = tg.EntityBlockquote
		case *tdapi.TextEntityTypeExpandableBlockQuote:
			x.Type, x.Collapsed = tg.EntityBlockquote, true
		default:
			continue
		}
		out = append(out, x)
	}
	return out
}

// inputEntities is the inverse of entities, for sending and editing.
func inputEntities(in []tg.Entity) []*tdapi.TextEntity {
	var out []*tdapi.TextEntity
	for _, e := range in {
		var t tdapi.TextEntityType
		switch e.Type {
		case tg.EntityBold:
			t = &tdapi.TextEntityTypeBold{}
		case tg.EntityItalic:
			t = &tdapi.TextEntityTypeItalic{}
		case tg.EntityUnderline:
			t = &tdapi.TextEntityTypeUnderline{}
		case tg.EntityStrikethrough:
			t = &tdapi.TextEntityTypeStrikethrough{}
		case tg.EntitySpoiler:
			t = &tdapi.TextEntityTypeSpoiler{}
		case tg.EntityCode:
			t = &tdapi.TextEntityTypeCode{}
		case tg.EntityPre:
			if e.Language != "" {
				t = &tdapi.TextEntityTypePreCode{Language: e.Language}
			} else {
				t = &tdapi.TextEntityTypePre{}
			}
		case tg.EntityTextLink:
			t = &tdapi.TextEntityTypeTextURL{URL: e.URL}
		case tg.EntityTextMention:
			t = &tdapi.TextEntityTypeMentionName{UserID: int64(e.UserID)}
		case tg.EntityCustomEmoji:
			t = &tdapi.TextEntityTypeCustomEmoji{CustomEmojiID: tdapi.Int64(e.CustomEmojiID)}
		case tg.EntityBlockquote:
			if e.Collapsed {
				t = &tdapi.TextEntityTypeExpandableBlockQuote{}
			} else {
				t = &tdapi.TextEntityTypeBlockQuote{}
			}
		default:
			// Mentions, hashtags and links TDLib finds in the text itself.
			continue
		}
		out = append(out, &tdapi.TextEntity{Offset: int32(e.Offset), Length: int32(e.Length), Type: t})
	}
	return out
}

func largest(sizes []*tdapi.PhotoSize) *tdapi.PhotoSize {
	var best *tdapi.PhotoSize
	for _, p := range sizes {
		if best == nil || p.Width*p.Height > best.Width*best.Height {
			best = p
		}
	}
	return best
}

func (s *Session) fileMediaLocked(kind tg.MediaKind, f *tdapi.File) *tg.Media {
	f = s.fileState(f)
	m := &tg.Media{Kind: kind, FileID: fileID(f), Path: downloaded(f)}
	if f != nil {
		m.Size = max(f.Size, f.ExpectedSize)
	}
	return m
}

func (s *Session) thumbnailLocked(m *tg.Media, t *tdapi.Thumbnail) {
	if t == nil || t.File == nil {
		return
	}
	f := s.fileState(t.File)
	m.ThumbnailFileID, m.ThumbnailPath = fileID(f), downloaded(f)
}

func (s *Session) photoLocked(p *tdapi.Photo) *tg.Media {
	if p == nil {
		return nil
	}
	size := largest(p.Sizes)
	if size == nil {
		return nil
	}
	m := s.fileMediaLocked(tg.MediaPhoto, size.Photo)
	m.Width, m.Height, m.MIMEType, m.Minithumbnail = int(size.Width), int(size.Height), "image/jpeg", mini(p.Minithumbnail)
	return m
}

func (s *Session) sticker(st *tdapi.Sticker) tg.Sticker {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stickerLocked(st)
}

func (s *Session) stickerLocked(st *tdapi.Sticker) tg.Sticker {
	if st == nil {
		return tg.Sticker{}
	}
	f := s.fileState(st.Sticker)
	out := tg.Sticker{ID: int64(st.ID), FileID: fileID(f), Path: downloaded(f), Emoji: st.Emoji, Format: stickerFormat(st.Format),
		Width: int(st.Width), Height: int(st.Height), SetID: int64(st.SetID)}
	if st.Thumbnail != nil {
		out.ThumbnailPath = downloaded(s.fileState(st.Thumbnail.File))
	}
	return out
}

func stickerFormat(f tdapi.StickerFormat) tg.StickerFormat {
	switch f.(type) {
	case *tdapi.StickerFormatTgs:
		return tg.StickerAnimated
	case *tdapi.StickerFormatWebm:
		return tg.StickerVideo
	}
	return tg.StickerStatic
}

func (s *Session) stickerMediaLocked(st *tdapi.Sticker, role tg.StickerRole, emoji string) *tg.Media {
	m := s.fileMediaLocked(tg.MediaSticker, st.Sticker)
	m.Width, m.Height = int(st.Width), int(st.Height)
	format := stickerFormat(st.Format)
	switch format {
	case tg.StickerAnimated:
		m.MIMEType = "application/x-tgsticker"
	case tg.StickerVideo:
		m.MIMEType = "video/webm"
	default:
		m.MIMEType = "image/webp"
	}
	s.thumbnailLocked(m, st.Thumbnail)
	m.Sticker = &tg.MessageSticker{Emoji: emoji, Role: role, Format: format, SetID: int64(st.SetID)}
	return m
}

// contentLocked maps a message's content into m; s.mu is held.
func (s *Session) contentLocked(m *tg.Message, c tdapi.MessageContent) {
	switch c := c.(type) {
	case *tdapi.MessageText:
		formatted(m, c.Text)
		if p := c.LinkPreview; p != nil {
			wp := &tg.WebPage{URL: p.URL, DisplayURL: p.DisplayURL, SiteName: p.SiteName, Title: p.Title}
			if p.Description != nil {
				wp.Description = p.Description.Text
			}
			switch t := p.Type.(type) {
			case *tdapi.LinkPreviewTypePhoto:
				wp.Photo = s.photoLocked(t.Photo)
			case *tdapi.LinkPreviewTypeArticle:
				wp.Photo = s.photoLocked(t.Photo)
			case *tdapi.LinkPreviewTypeVideo:
				wp.Photo = s.photoLocked(t.Cover)
			}
			m.Media = &tg.Media{Kind: tg.MediaWebPage, WebPage: wp}
		}
	case *tdapi.MessagePhoto:
		formatted(m, c.Caption)
		m.Media = s.photoLocked(c.Photo)
		if m.Media != nil {
			m.Media.Spoiler = c.HasSpoiler
		}
	case *tdapi.MessageVideo:
		formatted(m, c.Caption)
		v := c.Video
		md := s.fileMediaLocked(tg.MediaVideo, v.Video)
		md.FileName, md.MIMEType, md.Width, md.Height = v.FileName, v.MIMEType, int(v.Width), int(v.Height)
		md.Duration, md.Spoiler, md.Minithumbnail = time.Duration(v.Duration)*time.Second, c.HasSpoiler, mini(v.Minithumbnail)
		s.thumbnailLocked(md, v.Thumbnail)
		m.Media = md
	case *tdapi.MessageAnimation:
		formatted(m, c.Caption)
		a := c.Animation
		md := s.fileMediaLocked(tg.MediaAnimation, a.Animation)
		md.FileName, md.MIMEType, md.Width, md.Height = a.FileName, a.MIMEType, int(a.Width), int(a.Height)
		md.Duration, md.Spoiler, md.Minithumbnail = time.Duration(a.Duration)*time.Second, c.HasSpoiler, mini(a.Minithumbnail)
		s.thumbnailLocked(md, a.Thumbnail)
		m.Media = md
	case *tdapi.MessageDocument:
		formatted(m, c.Caption)
		d := c.Document
		md := s.fileMediaLocked(tg.MediaFile, d.Document)
		md.FileName, md.MIMEType, md.Minithumbnail = d.FileName, d.MIMEType, mini(d.Minithumbnail)
		s.thumbnailLocked(md, d.Thumbnail)
		m.Media = md
	case *tdapi.MessageAudio:
		formatted(m, c.Caption)
		a := c.Audio
		md := s.fileMediaLocked(tg.MediaAudio, a.Audio)
		md.FileName, md.MIMEType, md.Duration, md.Title, md.Performer = a.FileName, a.MIMEType, time.Duration(a.Duration)*time.Second, a.Title, a.Performer
		m.Media = md
	case *tdapi.MessageVoiceNote:
		formatted(m, c.Caption)
		v := c.VoiceNote
		md := s.fileMediaLocked(tg.MediaVoice, v.Voice)
		md.MIMEType, md.Duration, md.Waveform = v.MIMEType, time.Duration(v.Duration)*time.Second, v.Waveform
		m.Media = md
	case *tdapi.MessageVideoNote:
		v := c.VideoNote
		md := s.fileMediaLocked(tg.MediaVideoNote, v.Video)
		md.MIMEType, md.Width, md.Height = "video/mp4", int(v.Length), int(v.Length)
		md.Duration, md.Minithumbnail, md.Waveform = time.Duration(v.Duration)*time.Second, mini(v.Minithumbnail), v.Waveform
		s.thumbnailLocked(md, v.Thumbnail)
		m.Media = md
	case *tdapi.MessageSticker:
		m.Media = s.stickerMediaLocked(c.Sticker, tg.RoleSticker, c.Sticker.Emoji)
	case *tdapi.MessageAnimatedEmoji:
		m.Body = c.Emoji
		m.IsolatedEmoji = tg.IsolatedEmojiCount(c.Emoji)
		if c.AnimatedEmoji != nil && c.AnimatedEmoji.Sticker != nil {
			m.Media = s.stickerMediaLocked(c.AnimatedEmoji.Sticker, tg.RoleEmoji, c.Emoji)
		}
	case *tdapi.MessageDice:
		m.Body = c.Emoji
		m.IsolatedEmoji = 1
	case *tdapi.MessagePoll:
		m.Poll = poll(c.Poll)
		if c.Description != nil {
			m.Poll.Explanation = c.Description.Text
		}
	case *tdapi.MessageCall:
		m.Call = call(c, m.Outgoing)
	case *tdapi.MessageGroupCall:
		m.Call = &tg.MessageCall{Video: c.IsVideo, Status: tg.CallGroup, Active: c.IsActive, Duration: time.Duration(c.Duration) * time.Second}
	case *tdapi.MessageContact:
		ct := c.Contact
		m.Media = &tg.Media{Kind: tg.MediaContact, Contact: &tg.SharedContact{Name: strings.TrimSpace(ct.FirstName + " " + ct.LastName), Phone: ct.PhoneNumber, UserID: tg.UserID(ct.UserID)}}
	case *tdapi.MessageLocation:
		if c.Location != nil {
			m.Media = &tg.Media{Kind: tg.MediaLocation, Location: &tg.Location{Latitude: c.Location.Latitude, Longitude: c.Location.Longitude}}
		}
	case *tdapi.MessageVenue:
		if v := c.Venue; v != nil && v.Location != nil {
			m.Media = &tg.Media{Kind: tg.MediaLocation, Location: &tg.Location{Latitude: v.Location.Latitude, Longitude: v.Location.Longitude, Title: v.Title, Address: v.Address}}
		}
	case *tdapi.MessageBasicGroupChatCreate:
		m.Service, m.Body = tg.ServiceChatCreated, c.Title
	case *tdapi.MessageSupergroupChatCreate:
		m.Service, m.Body = tg.ServiceChatCreated, c.Title
	case *tdapi.MessageChatChangeTitle:
		m.Service, m.Body = tg.ServiceTitleChanged, c.Title
	case *tdapi.MessageChatChangePhoto, *tdapi.MessageChatDeletePhoto:
		m.Service = tg.ServicePhotoChanged
	case *tdapi.MessageChatAddMembers:
		m.Service = tg.ServiceMembersAdded
		if len(c.MemberUserIDs) == 1 && c.MemberUserIDs[0] == m.SenderID {
			m.Service = tg.ServiceMemberJoined
		}
	case *tdapi.MessageChatJoinByLink, *tdapi.MessageChatJoinByRequest:
		m.Service = tg.ServiceMemberJoined
	case *tdapi.MessageChatDeleteMember:
		m.Service = tg.ServiceMemberLeft
	case *tdapi.MessagePinMessage:
		m.Service = tg.ServicePinned
	case *tdapi.MessageScreenshotTaken:
		m.Service = tg.ServiceScreenshot
	case *tdapi.MessageChatSetMessageAutoDeleteTime:
		m.Service = tg.ServiceAutoDelete
	case *tdapi.MessageContactRegistered:
		m.Service = tg.ServiceJoinedTelegram
	case *tdapi.MessageCustomServiceAction:
		m.Service, m.Body = tg.ServiceCustom, c.Text
	case *tdapi.MessageExpiredPhoto, *tdapi.MessageExpiredVideo:
		m.Unsupported = true
	default:
		m.Unsupported = true
	}
}

func poll(p *tdapi.Poll) *tg.Poll {
	out := &tg.Poll{ID: int64(p.ID), TotalVoterCount: int(p.TotalVoterCount), Anonymous: p.IsAnonymous, Closed: p.IsClosed,
		Kind: tg.PollRegular, MultipleAnswers: p.AllowsMultipleAnswers}
	if p.Question != nil {
		out.Question = p.Question.Text
	}
	ids := make([]string, len(p.Options))
	for i, o := range p.Options {
		ids[i] = o.ID
		opt := tg.PollOption{VoterCount: int(o.VoterCount), Percentage: int(o.VotePercentage), Chosen: o.IsChosen}
		if o.Text != nil {
			opt.Text = o.Text.Text
		}
		out.Options = append(out.Options, opt)
	}
	if q, ok := p.Type.(*tdapi.PollTypeQuiz); ok {
		out.Kind, out.MultipleAnswers = tg.PollQuiz, false
		// The quiz's answer shows once the account voted or the poll closed;
		// TDLib sends no ids before.
		for _, id := range q.CorrectOptionIDs {
			out.CorrectOptionIDs = append(out.CorrectOptionIDs, int(id))
		}
		if q.Explanation != nil {
			out.Explanation = q.Explanation.Text
		}
	}
	return out
}

func call(c *tdapi.MessageCall, outgoing bool) *tg.MessageCall {
	_, missed := c.DiscardReason.(*tdapi.CallDiscardReasonMissed)
	_, declined := c.DiscardReason.(*tdapi.CallDiscardReasonDeclined)
	status := tg.CallIncoming
	switch {
	case missed && outgoing:
		status = tg.CallCancelled
	case missed:
		status = tg.CallMissed
	case declined && !outgoing:
		status = tg.CallDeclined
	case outgoing:
		status = tg.CallOutgoing
	}
	out := &tg.MessageCall{Video: c.IsVideo, Status: status}
	if !missed && !declined {
		out.Duration = time.Duration(c.Duration) * time.Second
	}
	return out
}
