package live

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib/tdapi"
)

// history reads messages older than from (0: the newest), newest first,
// until limit or the start of the chat; TDLib may answer a call with
// fewer than asked while it fetches from the server.
func (s *Session) history(ctx context.Context, chat tg.ChatID, from tg.MessageID, offset, limit int) ([]*tdapi.Message, bool, error) {
	var out []*tdapi.Message
	next := int64(from)
	for len(out) < limit {
		page, err := s.td.GetChatHistory(ctx, &tdapi.GetChatHistoryRequest{ChatID: int64(chat), FromMessageID: next, Offset: int32(offset), Limit: int32(min(100, limit-len(out)-offset))})
		if err != nil {
			return nil, false, notFound(err)
		}
		offset = 0
		fresh := slices.DeleteFunc(page.Messages, func(m *tdapi.Message) bool {
			return slices.ContainsFunc(out, func(x *tdapi.Message) bool { return x.ID == m.ID })
		})
		if len(fresh) == 0 {
			return out, true, nil
		}
		out = append(out, fresh...)
		next = out[len(out)-1].ID
	}
	return out, false, nil
}

func (s *Session) page(ms []*tdapi.Message, exhausted bool) tg.MessagePage {
	slices.SortFunc(ms, func(a, b *tdapi.Message) int { return int(b.ID - a.ID) })
	s.mu.Lock()
	defer s.mu.Unlock()
	page := tg.MessagePage{}
	for _, m := range ms {
		page.Items = append(page.Items, s.messageLocked(m))
	}
	if !exhausted && len(ms) > 0 {
		page.NextCursor = tg.MessageID(ms[len(ms)-1].ID)
	}
	return page
}

func (s *Session) Messages(ctx context.Context, chat tg.ChatID, before tg.MessageID, limit int) (tg.MessagePage, error) {
	if limit <= 0 {
		limit = 50
	}
	ms, exhausted, err := s.history(ctx, chat, before, 0, limit)
	if err != nil {
		return tg.MessagePage{}, err
	}
	return s.page(ms, exhausted), nil
}

func (s *Session) MessagesAround(ctx context.Context, chat tg.ChatID, around tg.MessageID, limit int) (tg.MessagePage, error) {
	if limit <= 0 {
		limit = 50
	}
	// An offset of -limit/2 from the message reads that many newer ones too.
	ms, exhausted, err := s.history(ctx, chat, around, -limit/2, limit)
	if err != nil {
		return tg.MessagePage{}, err
	}
	return s.page(ms, exhausted), nil
}

func (s *Session) MessageAtDate(ctx context.Context, chat tg.ChatID, at time.Time) (tg.MessageID, error) {
	m, err := s.td.GetChatMessageByDate(ctx, &tdapi.GetChatMessageByDateRequest{ChatID: int64(chat), Date: int32(at.Unix())})
	if err != nil {
		return 0, notFound(err)
	}
	return tg.MessageID(m.ID), nil
}

func mediaFilter(kind tg.MediaKind) tdapi.SearchMessagesFilter {
	switch kind {
	case tg.MediaPhoto, tg.MediaVideo:
		return &tdapi.SearchMessagesFilterPhotoAndVideo{}
	case tg.MediaFile:
		return &tdapi.SearchMessagesFilterDocument{}
	case tg.MediaAudio:
		return &tdapi.SearchMessagesFilterAudio{}
	case tg.MediaVoice, tg.MediaVideoNote:
		return &tdapi.SearchMessagesFilterVoiceAndVideoNote{}
	case tg.MediaWebPage:
		return &tdapi.SearchMessagesFilterURL{}
	case tg.MediaAnimation:
		return &tdapi.SearchMessagesFilterAnimation{}
	}
	return &tdapi.SearchMessagesFilterEmpty{}
}

func (s *Session) SharedMedia(ctx context.Context, chat tg.ChatID, kind tg.MediaKind, before tg.MessageID, limit int) (tg.MessagePage, error) {
	found, err := s.td.SearchChatMessages(ctx, &tdapi.SearchChatMessagesRequest{ChatID: int64(chat), FromMessageID: int64(before), Limit: int32(limit), Filter: mediaFilter(kind)})
	if err != nil {
		return tg.MessagePage{}, notFound(err)
	}
	page := s.page(found.Messages, found.NextFromMessageID == 0)
	return page, nil
}

func (s *Session) PinnedMessages(ctx context.Context, chat tg.ChatID) ([]tg.Message, error) {
	found, err := s.td.SearchChatMessages(ctx, &tdapi.SearchChatMessagesRequest{ChatID: int64(chat), Limit: 100, Filter: &tdapi.SearchMessagesFilterPinned{}})
	if err != nil {
		return nil, notFound(err)
	}
	return s.page(found.Messages, true).Items, nil
}

func (s *Session) ScheduledMessages(ctx context.Context, chat tg.ChatID) ([]tg.Message, error) {
	ms, err := s.td.GetChatScheduledMessages(ctx, &tdapi.GetChatScheduledMessagesRequest{ChatID: int64(chat)})
	if err != nil {
		return nil, notFound(err)
	}
	out := s.page(ms.Messages, true).Items
	slices.Reverse(out)
	return out, nil
}

func (s *Session) sendOptions(opts tg.SendOptions) *tdapi.MessageSendOptions {
	o := &tdapi.MessageSendOptions{DisableNotification: opts.Silent}
	if !opts.SendAt.IsZero() {
		o.SchedulingState = &tdapi.MessageSchedulingStateSendAtDate{SendDate: int32(opts.SendAt.Unix())}
	}
	return o
}

func replyTo(id tg.MessageID) tdapi.InputMessageReplyTo {
	if id == 0 {
		return nil
	}
	return &tdapi.InputMessageReplyToMessage{MessageID: int64(id)}
}

// track remembers the client id of a message TDLib is sending, which its
// later updates carry back.
func (s *Session) track(m *tdapi.Message, client string) tg.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	if client != "" {
		s.pending[m.ID] = client
	}
	return s.messageLocked(m)
}

func (s *Session) SendMessage(ctx context.Context, chat tg.ChatID, body string, opts tg.SendOptions) (tg.Message, error) {
	c, err := s.Chat(ctx, chat)
	if err != nil {
		return tg.Message{}, err
	}
	if err := tg.RequireSend(c, tg.ContentText); err != nil {
		return tg.Message{}, err
	}
	body, ents := tg.TrimOutgoing(body, opts.Entities)
	if body == "" {
		return tg.Message{}, tg.ErrEmptyMessage
	}
	m, err := s.td.SendMessage(ctx, &tdapi.SendMessageRequest{ChatID: int64(chat), ReplyTo: replyTo(opts.ReplyTo), Options: s.sendOptions(opts),
		InputMessageContent: &tdapi.InputMessageText{Text: &tdapi.FormattedText{Text: body, Entities: inputEntities(ents)}, ClearDraft: true}})
	if err != nil {
		return tg.Message{}, err
	}
	return s.track(m, opts.ClientID), nil
}

// content builds the input of one file: a photo, a video, a GIF, a song,
// a voice note, or a document for anything else.
func content(f tg.UploadFile, caption *tdapi.FormattedText) tdapi.InputMessageContent {
	file := &tdapi.InputFileLocal{Path: f.Path}
	switch {
	case f.Voice:
		return &tdapi.InputMessageVoiceNote{VoiceNote: &tdapi.InputVoiceNote{VoiceNote: file, Duration: int32(f.Duration / time.Second)}, Caption: caption}
	case f.MIMEType == "image/gif":
		return &tdapi.InputMessageAnimation{Animation: &tdapi.InputAnimation{Animation: file}, Caption: caption}
	case strings.HasPrefix(f.MIMEType, "image/") && f.MIMEType != "image/svg+xml":
		return &tdapi.InputMessagePhoto{Photo: &tdapi.InputPhoto{Photo: file}, Caption: caption}
	case strings.HasPrefix(f.MIMEType, "video/"):
		return &tdapi.InputMessageVideo{Video: &tdapi.InputVideo{Video: file, SupportsStreaming: true}, Caption: caption}
	case strings.HasPrefix(f.MIMEType, "audio/"):
		return &tdapi.InputMessageAudio{Audio: &tdapi.InputAudio{Audio: file}, Caption: caption}
	}
	return &tdapi.InputMessageDocument{Document: &tdapi.InputDocument{Document: file}, Caption: caption}
}

func (s *Session) SendMedia(ctx context.Context, chat tg.ChatID, files []tg.UploadFile, caption string, opts tg.SendOptions) ([]tg.Message, error) {
	c, err := s.Chat(ctx, chat)
	if err != nil {
		return nil, err
	}
	if err := tg.RequireSend(c, tg.ContentMedia); err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, tg.ErrEmptyMessage
	}
	if len(files) > tg.MaxAlbumFiles {
		return nil, tg.ErrTooManyFiles
	}
	for _, f := range files {
		if f.Size > tg.MaxUploadBytes {
			return nil, tg.ErrFileTooLarge
		}
	}
	body, ents := tg.TrimOutgoing(caption, opts.Entities)
	text := &tdapi.FormattedText{Text: body, Entities: inputEntities(ents)}
	if len(files) == 1 {
		m, err := s.td.SendMessage(ctx, &tdapi.SendMessageRequest{ChatID: int64(chat), ReplyTo: replyTo(opts.ReplyTo), Options: s.sendOptions(opts), InputMessageContent: content(files[0], text)})
		if err != nil {
			return nil, err
		}
		return []tg.Message{s.track(m, opts.ClientID)}, nil
	}
	inputs := make([]tdapi.InputMessageContent, len(files))
	for i, f := range files {
		var cap *tdapi.FormattedText
		if i == 0 {
			cap = text
		}
		inputs[i] = content(f, cap)
	}
	ms, err := s.td.SendMessageAlbum(ctx, &tdapi.SendMessageAlbumRequest{ChatID: int64(chat), ReplyTo: replyTo(opts.ReplyTo), Options: s.sendOptions(opts), InputMessageContents: inputs})
	if err != nil {
		return nil, err
	}
	out := make([]tg.Message, len(ms.Messages))
	for i, m := range ms.Messages {
		client := ""
		if i == 0 {
			client = opts.ClientID
		}
		out[i] = s.track(m, client)
	}
	return out, nil
}

func (s *Session) SendSticker(ctx context.Context, chat tg.ChatID, sticker tg.Sticker, opts tg.SendOptions) (tg.Message, error) {
	c, err := s.Chat(ctx, chat)
	if err != nil {
		return tg.Message{}, err
	}
	if err := tg.RequireSend(c, tg.ContentStickers); err != nil {
		return tg.Message{}, err
	}
	m, err := s.td.SendMessage(ctx, &tdapi.SendMessageRequest{ChatID: int64(chat), ReplyTo: replyTo(opts.ReplyTo), Options: s.sendOptions(opts),
		InputMessageContent: &tdapi.InputMessageSticker{Sticker: &tdapi.InputSticker{Sticker: &tdapi.InputFileID{ID: int32(sticker.FileID)}, Width: int32(sticker.Width), Height: int32(sticker.Height)}, Emoji: sticker.Emoji}})
	if err != nil {
		return tg.Message{}, err
	}
	return s.track(m, opts.ClientID), nil
}

func (s *Session) SendPoll(ctx context.Context, chat tg.ChatID, p tg.PollInput, opts tg.SendOptions) (tg.Message, error) {
	in := &tdapi.InputMessagePoll{Question: &tdapi.FormattedText{Text: p.Question}, IsAnonymous: p.Anonymous, AllowsMultipleAnswers: p.MultipleAnswers}
	for _, o := range p.Options {
		in.Options = append(in.Options, &tdapi.InputPollOption{Text: &tdapi.FormattedText{Text: o}})
	}
	if p.Kind == tg.PollQuiz {
		in.Type, in.AllowsMultipleAnswers = &tdapi.InputPollTypeQuiz{CorrectOptionIDs: []int32{int32(p.CorrectOption)}}, false
	} else {
		in.Type = &tdapi.InputPollTypeRegular{}
	}
	m, err := s.td.SendMessage(ctx, &tdapi.SendMessageRequest{ChatID: int64(chat), ReplyTo: replyTo(opts.ReplyTo), Options: s.sendOptions(opts), InputMessageContent: in})
	if err != nil {
		return tg.Message{}, err
	}
	return s.track(m, opts.ClientID), nil
}

func (s *Session) EditMessage(ctx context.Context, chat tg.ChatID, id tg.MessageID, body string, ents []tg.Entity) error {
	body, ents = tg.TrimOutgoing(body, ents)
	text := &tdapi.FormattedText{Text: body, Entities: inputEntities(ents)}
	m, err := s.td.GetMessage(ctx, &tdapi.GetMessageRequest{ChatID: int64(chat), MessageID: int64(id)})
	if err != nil {
		return notFound(err)
	}
	if _, ok := m.Content.(*tdapi.MessageText); ok {
		if body == "" {
			return tg.ErrEmptyMessage
		}
		_, err = s.td.EditMessageText(ctx, &tdapi.EditMessageTextRequest{ChatID: int64(chat), MessageID: int64(id), InputMessageContent: &tdapi.InputMessageText{Text: text}})
		return err
	}
	_, err = s.td.EditMessageCaption(ctx, &tdapi.EditMessageCaptionRequest{ChatID: int64(chat), MessageID: int64(id), Caption: text})
	return err
}

func messageIDs(ids []tg.MessageID) []int64 {
	out := make([]int64, len(ids))
	for i, id := range ids {
		out[i] = int64(id)
	}
	return out
}

func (s *Session) DeleteMessages(ctx context.Context, chat tg.ChatID, ids []tg.MessageID, scope tg.DeleteScope) error {
	_, err := s.td.DeleteMessages(ctx, &tdapi.DeleteMessagesRequest{ChatID: int64(chat), MessageIDs: messageIDs(ids), Revoke: scope == tg.DeleteForEveryone})
	return err
}

func (s *Session) ForwardMessages(ctx context.Context, from tg.ChatID, ids []tg.MessageID, to tg.ChatID, hideSender bool) error {
	_, err := s.td.ForwardMessages(ctx, &tdapi.ForwardMessagesRequest{ChatID: int64(to), FromChatID: int64(from), MessageIDs: messageIDs(ids), SendCopy: hideSender})
	return err
}

func (s *Session) PinMessage(ctx context.Context, chat tg.ChatID, id tg.MessageID, pinned, silent bool) error {
	if pinned {
		_, err := s.td.PinChatMessage(ctx, &tdapi.PinChatMessageRequest{ChatID: int64(chat), MessageID: int64(id), DisableNotification: silent})
		return err
	}
	_, err := s.td.UnpinChatMessage(ctx, &tdapi.UnpinChatMessageRequest{ChatID: int64(chat), MessageID: int64(id)})
	return err
}

func (s *Session) SendScheduledNow(ctx context.Context, chat tg.ChatID, id tg.MessageID) error {
	_, err := s.td.EditMessageSchedulingState(ctx, &tdapi.EditMessageSchedulingStateRequest{ChatID: int64(chat), MessageID: int64(id)})
	return err
}

func (s *Session) Reschedule(ctx context.Context, chat tg.ChatID, id tg.MessageID, at time.Time) error {
	_, err := s.td.EditMessageSchedulingState(ctx, &tdapi.EditMessageSchedulingStateRequest{ChatID: int64(chat), MessageID: int64(id),
		SchedulingState: &tdapi.MessageSchedulingStateSendAtDate{SendDate: int32(at.Unix())}})
	return err
}

func (s *Session) MessageLink(ctx context.Context, chat tg.ChatID, id tg.MessageID) (string, error) {
	l, err := s.td.GetMessageLink(ctx, &tdapi.GetMessageLinkRequest{ChatID: int64(chat), MessageID: int64(id)})
	if err != nil {
		return "", err
	}
	return l.Link, nil
}

func (s *Session) SetReaction(ctx context.Context, chat tg.ChatID, id tg.MessageID, emoji string, chosen bool) error {
	r := &tdapi.ReactionTypeEmoji{Emoji: emoji}
	if chosen {
		_, err := s.td.AddMessageReaction(ctx, &tdapi.AddMessageReactionRequest{ChatID: int64(chat), MessageID: int64(id), ReactionType: r, UpdateRecentReactions: true})
		return err
	}
	_, err := s.td.RemoveMessageReaction(ctx, &tdapi.RemoveMessageReactionRequest{ChatID: int64(chat), MessageID: int64(id), ReactionType: r})
	return err
}

func (s *Session) AvailableReactions(ctx context.Context, chat tg.ChatID, id tg.MessageID) ([]string, error) {
	r, err := s.td.GetMessageAvailableReactions(ctx, &tdapi.GetMessageAvailableReactionsRequest{ChatID: int64(chat), MessageID: int64(id), RowSize: 8})
	if err != nil {
		return nil, err
	}
	var out []string
	for _, group := range [][]*tdapi.AvailableReaction{r.TopReactions, r.RecentReactions, r.PopularReactions} {
		for _, a := range group {
			if e, ok := a.Type.(*tdapi.ReactionTypeEmoji); ok && !a.NeedsPremium && !slices.Contains(out, e.Emoji) {
				out = append(out, e.Emoji)
			}
		}
	}
	return out, nil
}

// button finds an inline button by the id the mapping gave it.
func button(m *tdapi.Message, id string) (*tdapi.InlineKeyboardButton, error) {
	k, ok := m.ReplyMarkup.(*tdapi.ReplyMarkupInlineKeyboard)
	row, col, found := strings.Cut(id, ":")
	if !ok || !found {
		return nil, tg.ErrNotFound
	}
	i, err1 := strconv.Atoi(row)
	j, err2 := strconv.Atoi(col)
	if err1 != nil || err2 != nil || i >= len(k.Rows) || j >= len(k.Rows[i]) {
		return nil, tg.ErrNotFound
	}
	return k.Rows[i][j], nil
}

func (s *Session) AnswerCallback(ctx context.Context, chat tg.ChatID, id tg.MessageID, btn string) (tg.CallbackAnswer, error) {
	m, err := s.td.GetMessage(ctx, &tdapi.GetMessageRequest{ChatID: int64(chat), MessageID: int64(id)})
	if err != nil {
		return tg.CallbackAnswer{}, notFound(err)
	}
	b, err := button(m, btn)
	if err != nil {
		return tg.CallbackAnswer{}, err
	}
	cb, ok := b.Type.(*tdapi.InlineKeyboardButtonTypeCallback)
	if !ok {
		return tg.CallbackAnswer{}, fmt.Errorf("live: button %s is not a callback", btn)
	}
	a, err := s.td.GetCallbackQueryAnswer(ctx, &tdapi.GetCallbackQueryAnswerRequest{ChatID: int64(chat), MessageID: int64(id), Payload: &tdapi.CallbackQueryPayloadData{Data: cb.Data}})
	if err != nil {
		return tg.CallbackAnswer{}, err
	}
	return tg.CallbackAnswer{Text: a.Text, Alert: a.ShowAlert, URL: a.URL}, nil
}

func (s *Session) VotePoll(ctx context.Context, chat tg.ChatID, id tg.MessageID, options []int) error {
	ids := make([]int32, len(options))
	for i, o := range options {
		ids[i] = int32(o)
	}
	_, err := s.td.SetPollAnswer(ctx, &tdapi.SetPollAnswerRequest{ChatID: int64(chat), MessageID: int64(id), OptionIDs: ids})
	return err
}

func (s *Session) StopPoll(ctx context.Context, chat tg.ChatID, id tg.MessageID) error {
	_, err := s.td.StopPoll(ctx, &tdapi.StopPollRequest{ChatID: int64(chat), MessageID: int64(id)})
	return err
}

func (s *Session) ClickAnimatedEmoji(ctx context.Context, chat tg.ChatID, id tg.MessageID) (*tg.AnimatedEmojiEffect, error) {
	st, err := s.td.ClickAnimatedEmojiMessage(ctx, &tdapi.ClickAnimatedEmojiMessageRequest{ChatID: int64(chat), MessageID: int64(id)})
	if tdapi.IsError(err, 404, "") {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &tg.AnimatedEmojiEffect{ChatID: chat, MessageID: id, Sticker: s.sticker(st)}, nil
}

func (s *Session) Translate(ctx context.Context, chat tg.ChatID, id tg.MessageID, language string) (string, error) {
	t, err := s.td.TranslateMessageText(ctx, &tdapi.TranslateMessageTextRequest{ChatID: int64(chat), MessageID: int64(id), ToLanguageCode: language})
	if err != nil {
		return "", err
	}
	return t.Text, nil
}

func (s *Session) ViewMessages(ctx context.Context, chat tg.ChatID, ids []tg.MessageID) error {
	_, err := s.td.ViewMessages(ctx, &tdapi.ViewMessagesRequest{ChatID: int64(chat), MessageIDs: messageIDs(ids), ForceRead: true})
	return err
}

func (s *Session) SearchGlobal(ctx context.Context, query string) (tg.GlobalSearchResult, error) {
	q := strings.TrimSpace(query)
	var out tg.GlobalSearchResult
	if q == "" {
		return out, nil
	}
	seen := map[int64]bool{}
	for _, search := range []func() (*tdapi.Chats, error){
		func() (*tdapi.Chats, error) {
			return s.td.SearchChats(ctx, &tdapi.SearchChatsRequest{Query: q, Limit: 20})
		},
		func() (*tdapi.Chats, error) {
			return s.td.SearchChatsOnServer(ctx, &tdapi.SearchChatsOnServerRequest{Query: q, Limit: 20})
		},
	} {
		chats, err := search()
		if err != nil {
			return out, err
		}
		for _, id := range chats.ChatIDs {
			if seen[id] {
				continue
			}
			seen[id] = true
			if c, err := s.Chat(ctx, tg.ChatID(id)); err == nil {
				out.Chats = append(out.Chats, c)
			}
		}
	}
	found, err := s.td.SearchMessages(ctx, &tdapi.SearchMessagesRequest{Query: q, Limit: 50})
	if err != nil {
		return out, err
	}
	s.mu.Lock()
	for _, m := range found.Messages {
		out.Messages = append(out.Messages, s.messageLocked(m))
	}
	s.mu.Unlock()
	return out, nil
}

func (s *Session) SearchChat(ctx context.Context, chat tg.ChatID, query string, before tg.MessageID, limit int) (tg.SearchPage, error) {
	found, err := s.td.SearchChatMessages(ctx, &tdapi.SearchChatMessagesRequest{ChatID: int64(chat), Query: strings.TrimSpace(query), FromMessageID: int64(before), Limit: int32(limit)})
	if err != nil {
		return tg.SearchPage{}, notFound(err)
	}
	page := tg.SearchPage{TotalCount: int(found.TotalCount), NextCursor: tg.MessageID(found.NextFromMessageID)}
	for _, m := range found.Messages {
		page.MessageIDs = append(page.MessageIDs, tg.MessageID(m.ID))
	}
	return page, nil
}

func (s *Session) Calls(ctx context.Context, cursor string) (tg.CallPage, error) {
	found, err := s.td.SearchCallMessages(ctx, &tdapi.SearchCallMessagesRequest{Offset: cursor, Limit: 50})
	if err != nil {
		return tg.CallPage{}, err
	}
	page := tg.CallPage{NextCursor: found.NextOffset}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range found.Messages {
		msg := s.messageLocked(m)
		if msg.Call == nil {
			continue
		}
		rec := tg.CallRecord{ChatID: msg.ChatID, MessageID: msg.ID, Status: msg.Call.Status, Video: msg.Call.Video, OccurredAt: msg.SentAt, Duration: msg.Call.Duration}
		if c := s.chats[m.ChatID]; c != nil {
			ch := s.chatLocked(c)
			rec.Title, rec.Avatar = ch.Title, ch.Avatar
		}
		page.Items = append(page.Items, rec)
	}
	return page, nil
}

func (s *Session) ResolveLink(ctx context.Context, link string) (tg.Chat, tg.MessageID, error) {
	kind, err := s.td.GetInternalLinkType(ctx, &tdapi.GetInternalLinkTypeRequest{Link: link})
	if err != nil {
		return tg.Chat{}, 0, notFound(err)
	}
	switch k := kind.(type) {
	case *tdapi.InternalLinkTypePublicChat:
		c, err := s.td.SearchPublicChat(ctx, &tdapi.SearchPublicChatRequest{Username: k.ChatUsername})
		if err != nil {
			return tg.Chat{}, 0, notFound(err)
		}
		ch, err := s.Chat(ctx, tg.ChatID(c.ID))
		return ch, 0, err
	case *tdapi.InternalLinkTypeMessage:
		info, err := s.td.GetMessageLinkInfo(ctx, &tdapi.GetMessageLinkInfoRequest{URL: k.URL})
		if err != nil {
			return tg.Chat{}, 0, notFound(err)
		}
		ch, err := s.Chat(ctx, tg.ChatID(info.ChatID))
		var id tg.MessageID
		if info.Message != nil {
			id = tg.MessageID(info.Message.ID)
		}
		return ch, id, err
	}
	return tg.Chat{}, 0, tg.ErrNotFound
}
