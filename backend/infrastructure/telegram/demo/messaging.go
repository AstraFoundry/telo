package demo

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// replies are the demo's automatic answers by chat.
var replies = map[tg.ChatID]string{DesignChat: "Looks good — shipping it.", MinaChat: "On it.", AronChat: "Thanks!", OffsiteChat: "Booked."}

func (r *Repository) later(d time.Duration, f func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.timers = append(r.timers, time.AfterFunc(d, f))
}

func (r *Repository) chatLocked(id tg.ChatID) (tg.Chat, bool) {
	if i := r.chatIndex(id); i >= 0 {
		return r.chats[i], true
	}
	return tg.Chat{}, false
}

// appendMessage stores an outgoing message and moves the chat up.
func (r *Repository) appendMessage(m tg.Message) (tg.Chat, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.setChat(m.ChatID, func(c *tg.Chat) {
		c.Preview, c.UpdatedAt, c.DraftPreview = preview(m), m.SentAt, ""
		if !c.Pinned {
			c.ListOrder = r.topOrder()
		}
		if !m.Outgoing {
			c.UnreadCount++
		} else {
			c.LastReadMessageID = m.ID
			c.UnreadCount = 0
		}
	})
	if !ok {
		return tg.Chat{}, tg.ErrNotFound
	}
	r.messages[m.ChatID] = append(r.messages[m.ChatID], m)
	delete(r.drafts, m.ChatID)
	return c, nil
}

// preview is a message's chat-list line.
func preview(m tg.Message) string {
	if m.Body != "" {
		return m.Body
	}
	switch {
	case m.Poll != nil:
		return "📊 " + m.Poll.Question
	case m.Media == nil:
		return ""
	case m.Media.Kind == tg.MediaSticker && m.Media.Sticker != nil:
		return m.Media.Sticker.Emoji + " Sticker"
	}
	return map[tg.MediaKind]string{tg.MediaPhoto: "Photo", tg.MediaVideo: "Video", tg.MediaFile: "File", tg.MediaVoice: "Voice message",
		tg.MediaAudio: "Audio", tg.MediaAnimation: "GIF", tg.MediaVideoNote: "Video message"}[m.Media.Kind]
}

func (r *Repository) nextMessageID() tg.MessageID {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextMsg++
	return r.nextMsg
}

func (r *Repository) requireChat(id tg.ChatID, kind tg.ContentKind) (tg.Chat, error) {
	r.mu.Lock()
	c, ok := r.chatLocked(id)
	r.mu.Unlock()
	if !ok {
		return tg.Chat{}, tg.ErrNotFound
	}
	return c, tg.RequireSend(c, kind)
}

// outgoing builds an outgoing message with its options applied.
func (r *Repository) outgoing(chat tg.ChatID, body string, opts tg.SendOptions) tg.Message {
	m := msg(chat, r.nextMessageID(), AccountID, body, r.opts.Now())
	m.ClientID, m.Status = opts.ClientID, tg.StatusSent
	m.Entities = tg.ValidEntities(body, opts.Entities)
	m.IsolatedEmoji = 0
	if len(m.Entities) == 0 {
		m.IsolatedEmoji = tg.IsolatedEmojiCount(body)
	}
	if opts.ReplyTo != 0 {
		r.mu.Lock()
		for _, x := range r.messages[chat] {
			if x.ID == opts.ReplyTo {
				m.ReplyTo = &tg.ReplyTo{ID: x.ID, SenderName: x.SenderName, Body: x.Body, Entities: x.Entities}
			}
		}
		r.mu.Unlock()
	}
	return m
}

// deliver stores an outgoing message (or schedules it) and publishes it.
func (r *Repository) deliver(m tg.Message, opts tg.SendOptions) (tg.Message, error) {
	if !opts.SendAt.IsZero() {
		m.ScheduledAt, m.SentAt = opts.SendAt, opts.SendAt
		r.mu.Lock()
		r.scheduled[m.ChatID] = append(r.scheduled[m.ChatID], m)
		r.mu.Unlock()
		r.emit(tg.ScheduledChanged{ChatID: m.ChatID})
		return m, nil
	}
	c, err := r.appendMessage(m)
	if err != nil {
		return tg.Message{}, err
	}
	r.emit(tg.MessageUpserted{Message: m}, tg.ChatUpserted{Chat: c})
	r.scheduleReply(m)
	return m, nil
}

func (r *Repository) scheduleReply(sent tg.Message) {
	text, ok := replies[sent.ChatID]
	if !ok || r.opts.ReplyAfter <= 0 {
		return
	}
	r.later(r.opts.ReplyAfter, func() {
		r.mu.Lock()
		c, _ := r.chatLocked(sent.ChatID)
		r.mu.Unlock()
		r.emit(tg.TypingChanged{ChatID: c.ID, Typing: true})
		r.later(r.opts.ReplyAfter, func() {
			from := c.UserID
			if c.Kind == tg.ChatGroup {
				from = Lev
			}
			m := msg(c.ID, r.nextMessageID(), from, text, r.opts.Now())
			m.Status = tg.StatusSent
			chat, err := r.appendMessage(m)
			if err != nil {
				return
			}
			r.emit(tg.TypingChanged{ChatID: c.ID}, tg.MessageUpserted{Message: m}, tg.ChatUpserted{Chat: chat},
				tg.MessagesRead{ChatID: c.ID, MaxID: sent.ID, Outbox: true})
		})
	})
}

func (r *Repository) SendMessage(_ context.Context, chat tg.ChatID, body string, opts tg.SendOptions) (tg.Message, error) {
	if _, err := r.requireChat(chat, tg.ContentText); err != nil {
		return tg.Message{}, err
	}
	body, opts.Entities = tg.TrimOutgoing(body, opts.Entities)
	if body == "" {
		return tg.Message{}, fmt.Errorf("demo: empty message")
	}
	return r.deliver(r.outgoing(chat, body, opts), opts)
}

func mediaKindOf(f tg.UploadFile) tg.MediaKind {
	switch {
	case f.Voice:
		return tg.MediaVoice
	case strings.HasPrefix(f.MIMEType, "image/") && f.MIMEType != "image/gif":
		return tg.MediaPhoto
	case f.MIMEType == "image/gif":
		return tg.MediaAnimation
	case strings.HasPrefix(f.MIMEType, "video/"):
		return tg.MediaVideo
	case strings.HasPrefix(f.MIMEType, "audio/"):
		return tg.MediaAudio
	}
	return tg.MediaFile
}

func (r *Repository) SendMedia(_ context.Context, chat tg.ChatID, files []tg.UploadFile, caption string, opts tg.SendOptions) ([]tg.Message, error) {
	if _, err := r.requireChat(chat, tg.ContentMedia); err != nil {
		return nil, err
	}
	if len(files) > tg.MaxAlbumFiles {
		return nil, tg.ErrTooManyFiles
	}
	var album int64
	if len(files) > 1 {
		album = time.Now().UnixNano()
	}
	var out []tg.Message
	for i, f := range files {
		if f.Size > tg.MaxUploadBytes {
			return nil, tg.ErrFileTooLarge
		}
		body := ""
		if i == 0 {
			body = strings.TrimSpace(caption)
		}
		m := r.outgoing(chat, body, opts)
		m.ClientID = ""
		if i == 0 {
			m.ClientID = opts.ClientID
		}
		id := r.files.uploaded(f)
		m.Media = &tg.Media{Kind: mediaKindOf(f), FileID: id, Path: f.Path, FileName: f.Name, MIMEType: f.MIMEType, Size: f.Size, Duration: f.Duration}
		m.AlbumID = album
		sent, err := r.deliver(m, opts)
		if err != nil {
			return out, err
		}
		r.mu.Lock()
		r.downloads[id] = f.Path
		r.mu.Unlock()
		out = append(out, sent)
	}
	return out, nil
}

func (r *Repository) SendSticker(_ context.Context, chat tg.ChatID, s tg.Sticker, opts tg.SendOptions) (tg.Message, error) {
	if _, err := r.requireChat(chat, tg.ContentStickers); err != nil {
		return tg.Message{}, err
	}
	m := r.outgoing(chat, "", opts)
	m.Media = &tg.Media{Kind: tg.MediaSticker, FileID: s.FileID, Path: s.Path, Width: s.Width, Height: s.Height,
		Sticker: &tg.MessageSticker{Emoji: s.Emoji, Role: tg.RoleSticker, Format: s.Format, SetID: s.SetID}}
	r.mu.Lock()
	r.recent = append([]tg.Sticker{s}, slices.DeleteFunc(slices.Clone(r.recent), func(x tg.Sticker) bool { return x.ID == s.ID })...)
	r.mu.Unlock()
	defer r.emit(tg.StickersChanged{})
	return r.deliver(m, opts)
}

func (r *Repository) SendPoll(_ context.Context, chat tg.ChatID, p tg.PollInput, opts tg.SendOptions) (tg.Message, error) {
	if _, err := r.requireChat(chat, tg.ContentText); err != nil {
		return tg.Message{}, err
	}
	question := strings.TrimSpace(p.Question)
	var options []tg.PollOption
	for _, o := range p.Options {
		if o = strings.TrimSpace(o); o != "" {
			options = append(options, tg.PollOption{Text: o})
		}
	}
	if question == "" || len(options) < tg.PollOptionsMin || len(options) > tg.PollOptionsMax {
		return tg.Message{}, fmt.Errorf("demo: a poll needs a question and %d–%d options", tg.PollOptionsMin, tg.PollOptionsMax)
	}
	m := r.outgoing(chat, "", opts)
	m.Poll = &tg.Poll{ID: time.Now().UnixNano(), Question: question, Options: options, Anonymous: p.Anonymous, Kind: p.Kind, MultipleAnswers: p.MultipleAnswers && p.Kind == tg.PollRegular}
	if p.Kind == tg.PollQuiz {
		m.Poll.CorrectOptionIDs = []int{p.CorrectOption}
	}
	return r.deliver(m, opts)
}

// editMessage changes a stored message and publishes it.
func (r *Repository) editMessage(chat tg.ChatID, id tg.MessageID, edit func(*tg.Message) error) error {
	r.mu.Lock()
	ms := r.messages[chat]
	i := slices.IndexFunc(ms, func(m tg.Message) bool { return m.ID == id })
	if i < 0 {
		r.mu.Unlock()
		return tg.ErrNotFound
	}
	if err := edit(&ms[i]); err != nil {
		r.mu.Unlock()
		return err
	}
	m := ms[i]
	r.mu.Unlock()
	r.emit(tg.MessageUpserted{Message: m, Edited: true})
	return nil
}

func (r *Repository) EditMessage(_ context.Context, chat tg.ChatID, id tg.MessageID, body string, entities []tg.Entity) error {
	body, entities = tg.TrimOutgoing(body, entities)
	return r.editMessage(chat, id, func(m *tg.Message) error {
		if !m.Outgoing {
			return fmt.Errorf("demo: only your own messages can be edited")
		}
		m.Body, m.Entities, m.EditedAt = body, tg.ValidEntities(body, entities), r.opts.Now()
		m.IsolatedEmoji = tg.IsolatedEmojiCount(body)
		return nil
	})
}

func (r *Repository) DeleteMessages(_ context.Context, chat tg.ChatID, ids []tg.MessageID, _ tg.DeleteScope) error {
	r.mu.Lock()
	r.messages[chat] = slices.DeleteFunc(r.messages[chat], func(m tg.Message) bool { return slices.Contains(ids, m.ID) })
	r.scheduled[chat] = slices.DeleteFunc(r.scheduled[chat], func(m tg.Message) bool { return slices.Contains(ids, m.ID) })
	var last tg.Message
	if ms := r.messages[chat]; len(ms) > 0 {
		last = ms[len(ms)-1]
	}
	c, ok := r.setChat(chat, func(c *tg.Chat) { c.Preview = preview(last) })
	r.mu.Unlock()
	r.emit(tg.MessagesDeleted{ChatID: chat, IDs: ids}, tg.ScheduledChanged{ChatID: chat})
	if ok {
		r.emit(tg.ChatUpserted{Chat: c})
	}
	return nil
}

func (r *Repository) ForwardMessages(_ context.Context, from tg.ChatID, ids []tg.MessageID, to tg.ChatID, hide bool) error {
	if _, err := r.requireChat(to, tg.ContentText); err != nil {
		return err
	}
	r.mu.Lock()
	var picked []tg.Message
	for _, m := range r.messages[from] {
		if slices.Contains(ids, m.ID) {
			picked = append(picked, m)
		}
	}
	r.mu.Unlock()
	if len(picked) == 0 {
		return tg.ErrNotFound
	}
	for _, src := range picked {
		m := r.outgoing(to, src.Body, tg.SendOptions{Entities: src.Entities})
		m.Media, m.Poll, m.ReplyTo = src.Media, src.Poll, nil
		if !hide {
			m.Forward = &tg.Forward{SenderName: src.SenderName, SenderID: src.SenderID, MessageID: src.ID}
		}
		if _, err := r.deliver(m, tg.SendOptions{}); err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) PinMessage(_ context.Context, chat tg.ChatID, id tg.MessageID, pinned, _ bool) error {
	if err := r.editMessage(chat, id, func(m *tg.Message) error { m.Pinned = pinned; return nil }); err != nil {
		return err
	}
	r.emit(tg.PinnedChanged{ChatID: chat})
	return nil
}

func (r *Repository) SendScheduledNow(_ context.Context, chat tg.ChatID, id tg.MessageID) error {
	r.mu.Lock()
	i := slices.IndexFunc(r.scheduled[chat], func(m tg.Message) bool { return m.ID == id })
	if i < 0 {
		r.mu.Unlock()
		return tg.ErrNotFound
	}
	m := r.scheduled[chat][i]
	r.scheduled[chat] = slices.Delete(r.scheduled[chat], i, i+1)
	r.mu.Unlock()
	m.ScheduledAt, m.SentAt = time.Time{}, r.opts.Now()
	r.emit(tg.ScheduledChanged{ChatID: chat})
	_, err := r.deliver(m, tg.SendOptions{})
	return err
}

func (r *Repository) Reschedule(_ context.Context, chat tg.ChatID, id tg.MessageID, at time.Time) error {
	r.mu.Lock()
	ms := r.scheduled[chat]
	i := slices.IndexFunc(ms, func(m tg.Message) bool { return m.ID == id })
	if i < 0 {
		r.mu.Unlock()
		return tg.ErrNotFound
	}
	ms[i].ScheduledAt, ms[i].SentAt = at, at
	r.mu.Unlock()
	r.emit(tg.ScheduledChanged{ChatID: chat})
	return nil
}

func (r *Repository) MessageLink(_ context.Context, chat tg.ChatID, id tg.MessageID) (string, error) {
	switch chat {
	case ProductChat:
		return fmt.Sprintf("https://t.me/telonotes/%d", id), nil
	case DesignChat:
		return fmt.Sprintf("https://t.me/c/2001/%d", id), nil
	}
	return "", fmt.Errorf("demo: private chats have no message links")
}

func (r *Repository) SetReaction(_ context.Context, chat tg.ChatID, id tg.MessageID, emoji string, chosen bool) error {
	var reactions []tg.Reaction
	err := r.editMessage(chat, id, func(m *tg.Message) error {
		i := slices.IndexFunc(m.Reactions, func(x tg.Reaction) bool { return x.Emoji == emoji })
		switch {
		case chosen && i < 0:
			m.Reactions = append(m.Reactions, tg.Reaction{Emoji: emoji, Count: 1, Chosen: true})
		case chosen && !m.Reactions[i].Chosen:
			m.Reactions[i].Count++
			m.Reactions[i].Chosen = true
		case !chosen && i >= 0 && m.Reactions[i].Chosen:
			m.Reactions[i].Count--
			m.Reactions[i].Chosen = false
			if m.Reactions[i].Count == 0 {
				m.Reactions = slices.Delete(m.Reactions, i, i+1)
			}
		}
		reactions = slices.Clone(m.Reactions)
		return nil
	})
	if err == nil {
		r.emit(tg.ReactionsChanged{ChatID: chat, MessageID: id, Reactions: reactions})
	}
	return err
}

func (r *Repository) AvailableReactions(context.Context, tg.ChatID, tg.MessageID) ([]string, error) {
	return slices.Clone(availableReactions), nil
}

func (r *Repository) AnswerCallback(_ context.Context, chat tg.ChatID, id tg.MessageID, button string) (tg.CallbackAnswer, error) {
	if chat != BotChat {
		return tg.CallbackAnswer{}, tg.ErrNotFound
	}
	switch fmt.Sprintf("%d/%s", id, button) {
	case "1/0:0":
		return tg.CallbackAnswer{URL: "https://example.com/telo-bot/dashboard"}, nil
	case "1/0:1":
		return tg.CallbackAnswer{}, nil
	case "2/0:0":
		return tg.CallbackAnswer{Text: "Deploy 482 approved.", Alert: true}, nil
	case "2/0:1":
		return tg.CallbackAnswer{Text: "You'll get build updates here."}, nil
	}
	return tg.CallbackAnswer{}, tg.ErrNotFound
}

func (r *Repository) VotePoll(_ context.Context, chat tg.ChatID, id tg.MessageID, options []int) error {
	return r.editMessage(chat, id, func(m *tg.Message) error {
		p := m.Poll
		if p == nil {
			return tg.ErrNotFound
		}
		if p.Closed {
			return fmt.Errorf("demo: the poll is closed")
		}
		voted := slices.ContainsFunc(p.Options, func(o tg.PollOption) bool { return o.Chosen })
		for i := range p.Options {
			if p.Options[i].Chosen {
				p.Options[i].Chosen = false
				p.Options[i].VoterCount--
			}
		}
		if voted {
			p.TotalVoterCount--
		}
		if len(options) > 0 {
			p.TotalVoterCount++
			for _, o := range options {
				if o >= 0 && o < len(p.Options) {
					p.Options[o].Chosen = true
					p.Options[o].VoterCount++
				}
			}
			if p.Kind == tg.PollQuiz && len(p.CorrectOptionIDs) == 0 {
				p.CorrectOptionIDs = []int{1}
			}
		}
		for i := range p.Options {
			if p.TotalVoterCount > 0 {
				p.Options[i].Percentage = p.Options[i].VoterCount * 100 / p.TotalVoterCount
			} else {
				p.Options[i].Percentage = 0
			}
		}
		return nil
	})
}

func (r *Repository) StopPoll(_ context.Context, chat tg.ChatID, id tg.MessageID) error {
	return r.editMessage(chat, id, func(m *tg.Message) error {
		if m.Poll == nil || !m.Outgoing {
			return fmt.Errorf("demo: only your own polls can be stopped")
		}
		m.Poll.Closed = true
		return nil
	})
}

func (r *Repository) ClickAnimatedEmoji(_ context.Context, chat tg.ChatID, id tg.MessageID) (*tg.AnimatedEmojiEffect, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.messages[chat] {
		if m.ID == id && m.Media != nil && m.Media.Sticker != nil && m.Media.Sticker.Role == tg.RoleEmoji {
			s := r.files.stickerItem(0, m.Media.Sticker.Emoji)
			s.Width, s.Height = 512, 512
			return &tg.AnimatedEmojiEffect{ChatID: chat, MessageID: id, Sticker: s}, nil
		}
	}
	return nil, nil
}

// translations stand in for Telegram's translation service.
var translations = map[string]string{
	"The conversation list should stay compact at desktop widths.": "La lista de conversaciones debe ser compacta en pantallas de escritorio.",
	"Ship both with the next build.":                               "Envía ambos con la próxima versión.",
}

func (r *Repository) Translate(_ context.Context, chat tg.ChatID, id tg.MessageID, language string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.messages[chat] {
		if m.ID == id {
			if t, ok := translations[m.Body]; ok {
				return t, nil
			}
			return "[" + language + "] " + m.Body, nil
		}
	}
	return "", tg.ErrNotFound
}

func (r *Repository) ViewMessages(_ context.Context, chat tg.ChatID, ids []tg.MessageID) error {
	if len(ids) == 0 {
		return nil
	}
	maxID := slices.Max(ids)
	r.mu.Lock()
	c, ok := r.setChat(chat, func(c *tg.Chat) {
		if maxID <= c.LastReadMessageID {
			return
		}
		unread := 0
		for _, m := range r.messages[chat] {
			if !m.Outgoing && m.ID > maxID {
				unread++
			}
		}
		c.LastReadMessageID, c.UnreadCount = maxID, unread
		if unread == 0 {
			c.UnreadMentions = 0
		}
	})
	r.mu.Unlock()
	if ok {
		r.emit(tg.MessagesRead{ChatID: chat, MaxID: maxID}, tg.ChatUpserted{Chat: c})
	}
	return nil
}

func (r *Repository) SearchGlobal(_ context.Context, query string) (tg.GlobalSearchResult, error) {
	q := strings.ToLower(strings.TrimSpace(query))
	var out tg.GlobalSearchResult
	if q == "" {
		return out, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.sorted() {
		if strings.Contains(strings.ToLower(c.Title), q) {
			out.Chats = append(out.Chats, c)
		}
		ms := r.messages[c.ID]
		for i := len(ms) - 1; i >= 0; i-- {
			if strings.Contains(strings.ToLower(ms[i].Body), q) {
				out.Messages = append(out.Messages, ms[i])
			}
		}
	}
	return out, nil
}

func (r *Repository) SearchChat(_ context.Context, chat tg.ChatID, query string, before tg.MessageID, limit int) (tg.SearchPage, error) {
	q := strings.ToLower(strings.TrimSpace(query))
	r.mu.Lock()
	defer r.mu.Unlock()
	var page tg.SearchPage
	ms := r.messages[chat]
	for i := len(ms) - 1; i >= 0; i-- {
		if q != "" && strings.Contains(strings.ToLower(ms[i].Body), q) {
			page.TotalCount++
			if (before == 0 || ms[i].ID < before) && (limit <= 0 || len(page.MessageIDs) < limit) {
				page.MessageIDs = append(page.MessageIDs, ms[i].ID)
			}
		}
	}
	return page, nil
}

func (r *Repository) Download(_ context.Context, file tg.FileID) error {
	r.mu.Lock()
	if p, ok := r.downloads[file]; ok {
		r.mu.Unlock()
		r.emit(tg.DownloadProgressed{Download: tg.MediaDownload{FileID: file, State: tg.TransferDone, Path: p}})
		return nil
	}
	r.mu.Unlock()
	path, size, err := r.files.materialize(file)
	if err != nil {
		r.emit(tg.DownloadProgressed{Download: tg.MediaDownload{FileID: file, State: tg.TransferFailed, Err: err.Error()}})
		return err
	}
	r.mu.Lock()
	r.downloads[file] = path
	r.mu.Unlock()
	r.emit(tg.DownloadProgressed{Download: tg.MediaDownload{FileID: file, State: tg.TransferDone, Downloaded: size, Total: size, Path: path}})
	return nil
}

func (r *Repository) CancelDownload(_ context.Context, file tg.FileID) error {
	r.emit(tg.DownloadProgressed{Download: tg.MediaDownload{FileID: file, State: tg.TransferCancelled}})
	return nil
}
