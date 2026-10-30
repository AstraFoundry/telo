// Package compose is the message composer: the text field with Telegram's
// markdown shortcuts, the reply and edit bar, staged attachments, the
// attach menu, send options (silent, scheduled), mention suggestions, the
// emoji and sticker panel, and the poll dialog.
package compose

import (
	"context"
	"mime"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/shared/config"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// AttachItem is an attach menu entry and the telegram-macos item it
// matches.
type AttachItem struct {
	ID       string
	Upstream string
	Title    copy.Key
}

// AttachItems is the registry the parity check reads.
var AttachItems = []AttachItem{
	{"media", "attach-action:inputAttachPopoverPhotoOrVideo", copy.AttachPhotoOrVideo},
	{"file", "attach-action:inputAttachPopoverFile", copy.AttachFile},
	{"poll", "attach-action:inputAttachPopoverPoll", copy.AttachPoll},
}

// Env is what the composer reaches.
type Env struct {
	Tokens  theme.Tokens
	Store   *chat.Store
	Runtime *runtime.Runtime
	Images  *media.Images
	Prefs   preferences.Preferences
	Mac     bool
	// OpenInfo opens the chat's info, which → does in an empty composer.
	OpenInfo func()
}

// Composer keeps the composer's own state between frames.
type Composer struct {
	Input      ui.Handle
	panel      bool
	panelTab   int
	emojiQuery string
	stickers   *tg.StickerCatalog
	stickerSet map[int64]tg.StickerSet
	loadingCat bool
	poll       pollDialog
	schedule   scheduleDialog
	mentions   []tg.Member
	mentionFor string
	typingAt   time.Time
	lastChat   tg.ChatID
}

// Focus requests the keyboard for the composer.
func (cp *Composer) Focus() { cp.Input.Focus() }

// Render draws the composer of the selected chat.
func (cp *Composer) Render(c *ui.Context, env Env, chatID tg.ChatID) {
	t, s := env.Tokens, env.Store
	ch, ok := s.Chat(chatID)
	if !ok {
		return
	}
	if cp.lastChat != chatID {
		// Leaving a chat stores what was typed as its draft.
		if prev := cp.lastChat; prev != 0 {
			s.SaveDraft(prev, s.Composer(prev).Text)
		}
		cp.lastChat, cp.panel, cp.mentions = chatID, false, nil
	}
	state := s.Composer(chatID)
	if !state.Restored {
		state.Restored = true
		if state.Text == "" && ch.DraftPreview != "" {
			state.Text = ch.DraftPreview
		}
	}
	if len(s.SelectedIDs(chatID)) > 0 {
		return
	}
	if !ch.CanSend(tg.ContentAny) {
		readOnly(c, t, ch)
		return
	}
	ui.Column(c).Padding(0, 12, 12, 12).Gap(6).Children(func() {
		if cp.panel {
			cp.renderPanel(c, env, ch)
		}
		target(c, env, chatID, state)
		if len(state.Files) > 0 {
			files(c, env, state)
		}
		cp.mentionPopup(c, env, ch, state)
		bar := ui.Row(c).Gap(6).Padding(5, 6).Radius(theme.RadiusXL+4).Background(t.Card).Border(1, t.CardBorder).AlignItems(ui.End)
		kit.Raise(bar, t, kit.Raised).Children(func() {
			cp.attachButton(c, env, ch, state)
			cp.field(c, env, ch, state)
			emoji := kit.IconButton(c.Key("emoji"), t, icons.Smiley, copy.T(copy.EmojiAndStickers))
			if cp.panel {
				emoji.TextColor(t.AccentInk)
			}
			emoji.OnClick(func() { cp.panel = !cp.panel })
			cp.sendButton(c, env, ch, state)
		})
	})
	cp.poll.render(c, env, chatID)
	cp.schedule.render(c, env, chatID, cp)
}

// readOnly is the bar of a chat the account cannot write to.
func readOnly(c *ui.Context, t theme.Tokens, ch tg.Chat) {
	key := copy.ReadOnlyChat
	switch {
	case ch.Kind == tg.ChatChannel:
		key = copy.ChannelMuteNote
	case ch.Kind == tg.ChatSecret && ch.SecretState == tg.SecretClosed:
		key = copy.SecretChatClosed
	case ch.Blocked:
		key = copy.BlockedNote
	}
	ui.Row(c).Height(48).Justify(ui.Center).AlignItems(ui.Center).Children(func() {
		ui.Text(c, copy.T(key)).FontSize(theme.Callout).TextColor(t.Muted)
	})
}

// target is the reply or edit bar above the field.
func target(c *ui.Context, env Env, chatID tg.ChatID, state *chat.Composer) {
	t, s := env.Tokens, env.Store
	id, label, icon := state.ReplyTo, "", icons.ArrowBendUpLeft
	if state.Editing != 0 {
		id, icon = state.Editing, icons.PencilSimple
	}
	if id == 0 {
		return
	}
	m, ok := s.Transcript(chatID).Message(id)
	if !ok {
		return
	}
	if state.Editing != 0 {
		label = copy.T(copy.EditingMessage)
	} else {
		label = copy.F(copy.ReplyingTo, m.SenderName)
	}
	body := m.Body
	if state.Quote != "" {
		body = state.Quote
	}
	ui.Row(c.Key("target")).Gap(10).Padding(6, 10).AlignItems(ui.Center).
		Transition(ui.ElementTransition{Animation: &theme.Settle, Enter: &ui.Motion{Y: 8, Opacity: 0}, Exit: &ui.Motion{Opacity: 0}}).Children(func() {
		ui.Icon(c, icon).FontSize(18).TextColor(t.AccentInk)
		ui.Box(c).Width(2).Height(30).Radius(1).Background(t.Accent)
		ui.Column(c).Grow(1).Shrink(1).Gap(1).Children(func() {
			ui.Text(c, label).FontSize(theme.Callout).FontWeight(600).TextColor(t.AccentInk).SingleLine()
			ui.Text(c, strings.Join(strings.Fields(body), " ")).FontSize(theme.Callout).TextColor(t.Muted).SingleLine()
		})
		cancel := copy.CancelReply
		if state.Editing != 0 {
			cancel = copy.CancelEdit
		}
		kit.IconButton(c.Key("cancel-target"), t, icons.X, copy.T(cancel)).OnClick(func() { s.CancelTarget(chatID) })
	})
}

// files is the tray of staged attachments.
func files(c *ui.Context, env Env, state *chat.Composer) {
	t := env.Tokens
	ui.Row(c).Gap(8).Padding(4, 6).Wrap().Children(func() {
		for i, f := range state.Files {
			chip := ui.Row(c.Key(f.Path)).Gap(8).Padding(4, 6, 4, 4).Radius(theme.RadiusLG).Background(t.Subtle).AlignItems(ui.Center)
			chip.Children(func() {
				thumb := ui.Box(c).Size(36, 36).Radius(theme.RadiusMD).Clip().Background(t.Card).Justify(ui.Center).AlignItems(ui.Center)
				thumb.Children(func() {
					if strings.HasPrefix(f.MIMEType, "image/") {
						if b := env.Images.File(f.Path); b != nil {
							ui.Image(c, b).Size(36, 36).Fit(ui.Cover)
							return
						}
					}
					ui.Icon(c, icons.File).FontSize(18).TextColor(t.Muted)
				})
				ui.Column(c).Gap(1).Children(func() {
					ui.Text(c, f.Name).FontSize(theme.Callout).SingleLine().MaxWidth(160)
					ui.Text(c, copy.Bytes(f.Size)).FontSize(theme.Caption).TextColor(t.Muted)
				})
				index := i
				kit.IconButton(c.Key("remove"), t, icons.X, copy.T(copy.RemoveAttachment)).Size(22, 22).OnClick(func() {
					state.Files = slices.Delete(state.Files, index, index+1)
				})
			})
		}
	})
}

// UploadFiles stats picked paths into upload files.
func UploadFiles(paths []string) []tg.UploadFile {
	var out []tg.UploadFile
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil || info.IsDir() {
			continue
		}
		kind := mime.TypeByExtension(strings.ToLower(filepath.Ext(p)))
		if kind == "" {
			kind = "application/octet-stream"
		}
		out = append(out, tg.UploadFile{Path: p, Name: filepath.Base(p), MIMEType: kind, Size: info.Size()})
	}
	return out
}

func (cp *Composer) stage(env Env, state *chat.Composer, paths []string) {
	add := UploadFiles(paths)
	for _, f := range add {
		if f.Size > tg.MaxUploadBytes {
			env.Store.Notify(copy.T(copy.FileTooLarge), true)
			return
		}
	}
	if len(state.Files)+len(add) > tg.MaxAlbumFiles {
		env.Store.Notify(copy.T(copy.TooManyFiles), true)
		return
	}
	state.Files = append(state.Files, add...)
}

func (cp *Composer) attachButton(c *ui.Context, env Env, ch tg.Chat, state *chat.Composer) {
	t := env.Tokens
	attach := kit.IconButton(c.Key("attach"), t, icons.Paperclip, copy.T(copy.Attach))
	if state.Editing != 0 {
		attach.Disabled(true).Opacity(0.4)
		return
	}
	attach.PopoverMenu(func(m *ui.Menu) {
		if m.Item(copy.T(copy.AttachPhotoOrVideo)).Disabled(!ch.CanSendMedia).Chosen() {
			cp.stage(env, state, env.Runtime.Desktop.PickFiles(copy.T(copy.AttachPhotoOrVideo), true, true))
		}
		if m.Item(copy.T(copy.AttachFile)).Disabled(!ch.CanSendMedia).Chosen() {
			cp.stage(env, state, env.Runtime.Desktop.PickFiles(copy.T(copy.AttachFile), true, false))
		}
		if ch.Kind != tg.ChatDirect && ch.Kind != tg.ChatSecret || ch.Kind == tg.ChatSaved {
			if m.Item(copy.T(copy.AttachPoll)).Disabled(!ch.CanSendMessages).Chosen() {
				cp.poll.open(ch.ID)
			}
		}
	})
}

// field is the text area with its keys.
func (cp *Composer) field(c *ui.Context, env Env, ch tg.Chat, state *chat.Composer) {
	s := env.Store
	placeholder := copy.T(copy.MessagePlaceholder)
	if len(state.Files) > 0 {
		placeholder = copy.T(copy.CaptionPlaceholder)
	}
	// Each chat has its own field, which takes the keyboard as the chat
	// opens, as Telegram's does.
	input := ui.TextAreaBase(c.Key(ch.ID), &state.Text).AutoFocus().Lines(1, 10).Grow(1).Padding(6, 4).FontSize(float32(env.Prefs.TextSize)).
		Placeholder(placeholder).Label(copy.T(copy.MessagePlaceholder)).FocusRing(false).Bind(&cp.Input)
	if !ch.CanSendMessages {
		input.Disabled(true)
	}
	if paths := input.DroppedFiles(); paths != nil && ch.CanSendMedia {
		cp.stage(env, state, paths)
	}
	sendWithEnter := env.Prefs.SendWithEnter
	input.OnTextKey(func(k ui.TextKey) bool {
		switch {
		case k.Key == ui.KeyEnter && (sendWithEnter && k.Mods == 0 || !sendWithEnter && k.Mods == ui.Cmd):
			text := k.Text()
			k.SetText("")
			env.Runtime.Post(func() { cp.send(env, ch.ID, state, text, tg.SendOptions{}) })
			return true
		case k.Key == ui.KeyRight && k.Mods == 0 && k.Text() == "" && env.OpenInfo != nil:
			env.Runtime.Post(env.OpenInfo)
			return true
		case k.Key == ui.KeyUp && k.Mods == 0 && k.Text() == "" && state.Editing == 0:
			if m, ok := s.LastOutgoing(ch.ID); ok {
				k.SetText(m.Body)
				env.Runtime.Post(func() { s.StartEdit(ch.ID, m.ID) })
				return true
			}
		case k.Key == ui.KeyEscape && (state.ReplyTo != 0 || state.Editing != 0):
			editing := state.Editing != 0
			if editing {
				k.SetText("")
			}
			env.Runtime.Post(func() { s.CancelTarget(ch.ID) })
			return true
		}
		return false
	})
	// Telegram's markdown shortcuts wrap the selection in markers that the
	// send parses into entities.
	for _, f := range []struct {
		act  config.Action
		mark string
	}{{config.ActBold, "**"}, {config.ActItalic, "__"}, {config.ActMonospace, "`"}, {config.ActStrikethrough, "~~"}} {
		if sc, ok := config.ByAction(f.act); ok {
			for _, b := range sc.Bindings {
				if input.Shortcut(b.Mods, b.Key) {
					wrap(input, &state.Text, f.mark, f.mark)
				}
			}
		}
	}
	if sc, ok := config.ByAction(config.ActLink); ok && input.Shortcut(sc.Bindings[0].Mods, sc.Bindings[0].Key) {
		wrap(input, &state.Text, "[", "](https://)")
	}
	if input.Changed() {
		cp.typing(env, ch.ID)
	}
}

// wrap puts open and close around the selection of input's text.
func wrap(input ui.Element, text *string, open, close string) {
	start, end := input.TextSelection()
	runes := []rune(*text)
	start, end = max(0, min(start, len(runes))), max(0, min(end, len(runes)))
	if start > end {
		start, end = end, start
	}
	*text = string(runes[:start]) + open + string(runes[start:end]) + close + string(runes[end:])
	o := utf8.RuneCountInString(open)
	input.SetTextSelection(start+o, end+o)
}

// typing tells the chat the account is typing, at most every 5 seconds.
func (cp *Composer) typing(env Env, id tg.ChatID) {
	now := env.Runtime.Clock()
	if now.Sub(cp.typingAt) < 5*time.Second {
		return
	}
	cp.typingAt = now
	env.Store.SetTyping(id, true)
}

func (cp *Composer) sendButton(c *ui.Context, env Env, ch tg.Chat, state *chat.Composer) {
	t := env.Tokens
	ready := strings.TrimSpace(state.Text) != "" || len(state.Files) > 0
	icon := icons.PaperPlaneTilt
	if state.Editing != 0 {
		icon = icons.Check
	}
	send := ui.ButtonBase(c.Key("send")).Size(32, 32).Radius(16).Justify(ui.Center).AlignItems(ui.Center).Label(copy.T(copy.SendMessage)).Disabled(!ready)
	if ready {
		send.Background(t.Accent).TextColor(t.AccentText)
	} else {
		send.TextColor(t.Faint)
	}
	kit.Press(send)
	send.Children(func() { ui.Icon(c, icon).FontSize(17) })
	if send.Clicked() {
		if send.ClickModifiers()&ui.Alt != 0 && state.Editing == 0 {
			cp.schedule.openFor(ch.ID, false, env.Runtime.Clock())
		} else {
			cp.send(env, ch.ID, state, state.Text, tg.SendOptions{})
		}
	}
	if state.Editing == 0 {
		send.PopoverMenu(func(m *ui.Menu) {
			if m.Item(copy.T(copy.SendWithoutSound)).Disabled(!ready).Chosen() {
				cp.send(env, ch.ID, state, state.Text, tg.SendOptions{Silent: true})
			}
			if ch.Kind != tg.ChatSecret {
				if m.Item(copy.T(copy.ScheduleMessage)).Disabled(!ready).Chosen() {
					cp.schedule.openFor(ch.ID, false, env.Runtime.Clock())
				}
			}
		})
	}
}

// send posts the composer's text and files with opts, or saves an edit.
func (cp *Composer) send(env Env, id tg.ChatID, state *chat.Composer, text string, opts tg.SendOptions) {
	s := env.Store
	body, entities := tg.ParseMarkdown(text, state.Entities)
	if state.Editing != 0 {
		if strings.TrimSpace(body) != "" {
			s.Edit(id, state.Editing, body, entities)
		}
		state.Editing, state.Text, state.Entities = 0, "", nil
		return
	}
	opts.ReplyTo, opts.Entities = state.ReplyTo, entities
	if len(state.Files) > 0 {
		s.SendFiles(id, state.Files, body, opts)
	} else if strings.TrimSpace(body) != "" {
		s.Send(id, body, opts)
	} else {
		return
	}
	state.Text, state.Entities, state.Files, state.ReplyTo, state.Quote = "", nil, nil, 0, ""
	s.SaveDraft(id, "")
}

// mentionPopup suggests group members while an @word is being typed.
func (cp *Composer) mentionPopup(c *ui.Context, env Env, ch tg.Chat, state *chat.Composer) {
	if ch.Kind != tg.ChatGroup {
		return
	}
	word := currentMention(state.Text)
	if word == "" {
		cp.mentions, cp.mentionFor = nil, ""
		return
	}
	if word != cp.mentionFor {
		cp.mentionFor = word
		query := strings.TrimPrefix(word, "@")
		repo := env.Runtime.Repo()
		if repo != nil {
			env.Runtime.Go(func(ctx context.Context) func() {
				members, err := repo.Members(ctx, ch.ID, query)
				return func() {
					if err == nil && cp.mentionFor == word {
						cp.mentions = members
					}
				}
			})
		}
	}
	if len(cp.mentions) == 0 {
		return
	}
	t := env.Tokens
	card := kit.Card(c, t).Padding(4).Gap(1).MaxHeight(220)
	card.Label(copy.T(copy.Mentions)).Children(func() {
		for _, m := range cp.mentions {
			row := ui.ButtonBase(c.Key(m.ID)).Height(38).Padding(0, 8).Gap(10).Radius(theme.RadiusMD).AlignItems(ui.Center).Label(m.DisplayName)
			if row.Hovered() {
				row.Background(t.Subtle)
			}
			member := m
			row.Children(func() {
				kit.Avatar(c, t, env.Images, member.Avatar, member.DisplayName, 28, false)
				ui.Text(c, member.DisplayName).FontSize(theme.Body).SingleLine()
				if member.Username != "" {
					ui.Text(c, "@"+member.Username).FontSize(theme.Callout).TextColor(t.Muted).SingleLine()
				}
			})
			row.OnClick(func() {
				insert := "@" + member.Username + " "
				if member.Username == "" {
					insert = member.DisplayName + " "
				}
				state.Text = strings.TrimSuffix(state.Text, cp.mentionFor) + insert
				cp.mentions, cp.mentionFor = nil, ""
				cp.Input.Focus()
			})
		}
	})
}

// currentMention is the @word at the end of text, if any.
func currentMention(text string) string {
	i := strings.LastIndexAny(text, " \n")
	word := text[i+1:]
	if strings.HasPrefix(word, "@") && !strings.ContainsAny(word[1:], "@") {
		return word
	}
	return ""
}
