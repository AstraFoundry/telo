// Package messageactions is the message context menu and the dialogs it
// opens: reply, quote, edit, copy, copy link, forward with its chat picker,
// pin, select, delete for oneself or everyone, translate, save media,
// sticker sets, polls and scheduled messages, as telegram-macos's message
// menu offers them.
package messageactions

import (
	"context"
	"slices"
	"strings"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Item is a message action and the telegram-macos item it matches.
type Item struct {
	ID       string
	Upstream string
	Title    copy.Key
}

// Items is the registry the parity check reads.
var Items = []Item{
	{"reply", "message-action:messageContextReply1", copy.Reply},
	{"quote", "message-action:chatMessageContextQuote", copy.Quote},
	{"edit", "message-action:messageContextEdit", copy.EditMessage},
	{"cancel-edit", "message-action:chatContextCancelEditing", copy.CancelEdit},
	{"copy", "message-action:chatContextCopyText", copy.CopyText},
	{"copy-selected", "message-action:chatCopySelectedText", copy.CopySelectedText},
	{"copy-plain", "message-action:contextCopy", copy.Copy},
	{"copy-link", "message-action:messageContextCopyMessageLink1", copy.CopyLink},
	{"forward", "message-action:messageContextForward", copy.Forward},
	{"forward-more", "message-action:chatContextForwardMore", copy.ForwardMore},
	{"saved", "message-action:peerSavedMessages", copy.SavedMessages},
	{"pin", "message-action:messageContextPin", copy.PinMessage},
	{"unpin", "message-action:messageContextUnpin", copy.UnpinMessage},
	{"select", "message-action:messageContextSelect", copy.SelectMessage},
	{"delete", "message-action:messageContextDelete", copy.DeleteMessage},
	{"translate", "message-action:chatContextTranslate", copy.Translate},
	{"save-media", "message-action:chatContextSaveMedia", copy.SaveMedia},
	{"sticker-set", "message-action:contextViewStickerSet", copy.ViewStickerSet},
	{"retract", "message-action:chatPollUnvote", copy.PollRetract},
	{"send-now", "message-action:chatContextScheduledSendNow", copy.SendNow},
	{"reschedule", "message-action:chatContextScheduledReschedule", copy.Reschedule},
	{"report", "message-action:messageContextReport", copy.ReportMessage},
	{"edited-at", "message-action:chatContextEditedAt", copy.EditedAt},
	{"sent-at", "message-action:chatMessageMenuSentAt", copy.SentAt},
	{"summarize", "message-action:chatContextSummarize", copy.Summarize},
}

// State is the dialogs the menu opens.
type State struct {
	forward     forwardDialog
	remove      deleteDialog
	reschedule  rescheduleDialog
	StickerSet  int64
	ShowSticker bool
}

type forwardDialog struct {
	open   bool
	from   tg.ChatID
	ids    []tg.MessageID
	query  string
	hide   bool
	picked tg.ChatID
}

type deleteDialog struct {
	open   bool
	chat   tg.ChatID
	ids    []tg.MessageID
	forAll bool
	can    bool
	peer   string
}

type rescheduleDialog struct {
	open bool
	chat tg.ChatID
	id   tg.MessageID
	at   time.Time
}

// Env is what the menu reaches.
type Env struct {
	Tokens  theme.Tokens
	Store   *chat.Store
	Runtime *runtime.Runtime
	Images  *media.Images
	// Clock writes a time for the info lines.
	Clock func(m tg.Message) (sent, edited string)
	// Language is the translation target.
	Language string
	// Selection is the text selected in the message, for Copy Selected
	// Text and Quote.
	Selection string
	// Summarize hands the message to the agent, nil when it is off.
	Summarize func(m tg.Message)
	// FocusComposer moves the keyboard to the composer after Reply.
	FocusComposer func()
}

// Menu fills a message's context menu.
func (s *State) Menu(m *ui.Menu, env Env, msg tg.Message, scheduled bool) {
	st, cid := env.Store, msg.ChatID
	c, _ := st.Chat(cid)
	pending := msg.Pending()
	if scheduled {
		if m.Item(copy.T(copy.SendNow)).Chosen() {
			st.SendScheduledNowAction(cid, msg.ID)
		}
		if m.Item(copy.T(copy.Reschedule)).Chosen() {
			s.reschedule = rescheduleDialog{open: true, chat: cid, id: msg.ID}
		}
		m.Separator()
		if m.Item(copy.T(copy.DeleteMessage)).Chosen() {
			st.Delete(cid, []tg.MessageID{msg.ID}, tg.DeleteForEveryone)
		}
		return
	}
	if !pending && c.CanSendMessages {
		if m.Item(copy.T(copy.Reply)).Chosen() {
			st.Reply(cid, msg.ID, "")
			if env.FocusComposer != nil {
				env.FocusComposer()
			}
		}
		if env.Selection != "" && m.Item(copy.T(copy.Quote)).Chosen() {
			st.Reply(cid, msg.ID, env.Selection)
		}
	}
	if msg.Outgoing && !pending && msg.CanEdit && msg.Poll == nil && msg.Call == nil {
		if st.Composer(cid).Editing == msg.ID {
			if m.Item(copy.T(copy.CancelEdit)).Chosen() {
				st.CancelTarget(cid)
			}
		} else if m.Item(copy.T(copy.EditMessage)).Chosen() {
			st.StartEdit(cid, msg.ID)
		}
	}
	if msg.Body != "" {
		if env.Selection != "" && env.Selection != msg.Body {
			if m.Item(copy.T(copy.CopySelectedText)).Chosen() {
				env.Runtime.Desktop.WriteClipboard(env.Selection)
			}
		}
		if m.Item(copy.T(copy.CopyText)).Chosen() {
			env.Runtime.Desktop.WriteClipboard(msg.Body)
		}
	}
	if !pending && (c.Kind == tg.ChatChannel || c.Kind == tg.ChatGroup) {
		if m.Item(copy.T(copy.CopyLink)).Chosen() {
			s.copyLink(env, msg)
		}
	}
	if msg.Media != nil && msg.Media.Path != "" && msg.Media.Kind != tg.MediaWebPage {
		if m.Item(copy.T(copy.SaveMedia)).Chosen() {
			name := msg.Media.FileName
			if name == "" {
				name = filepathBase(msg.Media.Path)
			}
			if to := env.Runtime.Desktop.SavePath(name); to != "" {
				if err := env.Runtime.Desktop.CopyFile(msg.Media.Path, to); err != nil {
					st.Notify(err.Error(), true)
				}
			}
		}
	}
	if msg.Media != nil && msg.Media.Sticker != nil && msg.Media.Sticker.SetID != 0 {
		if m.Item(copy.T(copy.ViewStickerSet)).Chosen() {
			s.StickerSet, s.ShowSticker = msg.Media.Sticker.SetID, true
		}
	}
	if p := msg.Poll; p != nil && !p.Closed && slices.ContainsFunc(p.Options, func(o tg.PollOption) bool { return o.Chosen }) && p.Kind == tg.PollRegular {
		if m.Item(copy.T(copy.PollRetract)).Chosen() {
			st.Vote(cid, msg.ID, nil)
		}
	}
	if msg.Body != "" && !msg.Outgoing && env.Language != "" {
		if _, shown := st.Transcript(cid).Translations[msg.ID]; shown {
			if m.Item(copy.T(copy.HideTranslation)).Chosen() {
				st.HideTranslation(cid, msg.ID)
			}
		} else if m.Item(copy.T(copy.Translate)).Chosen() {
			st.Translate(cid, msg.ID, env.Language, copy.T(copy.TranslateFailed))
		}
	}
	if env.Summarize != nil && msg.Body != "" {
		if m.Item(copy.T(copy.Summarize)).Chosen() {
			env.Summarize(msg)
		}
	}
	if !pending {
		m.Separator()
		if c.Kind != tg.ChatSecret && msg.CanForward {
			m.Submenu(copy.T(copy.Forward), func(m *ui.Menu) {
				if m.Item(copy.T(copy.SavedMessages)).Chosen() {
					st.ForwardToSaved(cid, []tg.MessageID{msg.ID})
				}
				if m.Item(copy.T(copy.ForwardMore)).Chosen() {
					s.OpenForward(cid, []tg.MessageID{msg.ID})
				}
			})
		}
		if canPin(c) {
			if msg.Pinned {
				if m.Item(copy.T(copy.UnpinMessage)).Chosen() {
					st.Pin(cid, msg.ID, false, false)
				}
			} else if m.Item(copy.T(copy.PinMessage)).Chosen() {
				st.Pin(cid, msg.ID, true, false)
			}
		}
		if m.Item(copy.T(copy.SelectMessage)).Chosen() {
			st.ToggleSelected(cid, msg.ID)
		}
		if !msg.Outgoing && c.Kind != tg.ChatSaved && c.Kind != tg.ChatSecret {
			if m.Item(copy.T(copy.ReportMessage)).Chosen() {
				st.Report(cid)
			}
		}
		if m.Item(copy.T(copy.DeleteMessage)).Chosen() {
			s.OpenDelete(env, cid, []tg.MessageID{msg.ID})
		}
	}
	if env.Clock != nil && !pending {
		m.Separator()
		sent, edited := env.Clock(msg)
		m.Item(copy.F(copy.SentAt, sent)).Disabled(true)
		if edited != "" {
			m.Item(copy.F(copy.EditedAt, edited)).Disabled(true)
		}
	}
}

// canPin tells whether the account may pin in a chat: always in private
// chats and groups the account writes to, in channels when it can post.
func canPin(c tg.Chat) bool {
	return c.Kind == tg.ChatDirect || c.Kind == tg.ChatSaved || c.Kind == tg.ChatSecret || c.CanSendMessages
}

func filepathBase(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}

func (s *State) copyLink(env Env, msg tg.Message) {
	repo := env.Runtime.Repo()
	if repo == nil {
		return
	}
	env.Runtime.Go(func(ctx context.Context) func() {
		link, err := repo.MessageLink(ctx, msg.ChatID, msg.ID)
		return func() {
			if err != nil {
				env.Store.Notify(err.Error(), true)
				return
			}
			env.Runtime.Desktop.WriteClipboard(link)
			env.Store.Notify(copy.T(copy.LinkCopied), false)
		}
	})
}

// OpenForward opens the chat picker for messages.
func (s *State) OpenForward(from tg.ChatID, ids []tg.MessageID) {
	s.forward = forwardDialog{open: true, from: from, ids: ids}
}

// OpenDelete asks how to delete messages.
func (s *State) OpenDelete(env Env, chatID tg.ChatID, ids []tg.MessageID) {
	c, _ := env.Store.Chat(chatID)
	can := c.CanDeleteForAll
	t := env.Store.Transcript(chatID)
	for _, id := range ids {
		if m, ok := t.Message(id); ok && !m.CanDeleteForAll {
			can = false
		}
	}
	s.remove = deleteDialog{open: true, chat: chatID, ids: ids, can: can && c.Kind != tg.ChatSaved, forAll: c.Kind == tg.ChatSecret, peer: c.Title}
}

// Dialogs draws the open dialogs.
func (s *State) Dialogs(c *ui.Context, env Env) {
	t, st := env.Tokens, env.Store
	if s.remove.open {
		body := copy.T(copy.DeleteMessageConfirm)
		if len(s.remove.ids) > 1 {
			body = copy.F(copy.DeleteMessagesConfirm, len(s.remove.ids))
		}
		d := &s.remove
		kit.Dialog(c, t, &d.open, 360, copy.T(copy.DeleteMessage), body, func() {
			if d.can {
				label := copy.T(copy.DeleteForAll)
				if cc, _ := st.Chat(d.chat); cc.Kind == tg.ChatDirect {
					label = copy.F(copy.DeleteForEveryone, d.peer)
				}
				ui.Checkbox(c, &d.forAll, label)
			}
		}, func() {
			kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { d.open = false })
			kit.Button(c.Key("delete"), t, kit.Destructive, copy.T(copy.Delete), true).OnClick(func() {
				scope := tg.DeleteForMe
				if d.forAll {
					scope = tg.DeleteForEveryone
				}
				st.Delete(d.chat, d.ids, scope)
				st.Composer(d.chat).Selected = map[tg.MessageID]bool{}
				d.open = false
			})
		})
	}
	if s.forward.open {
		s.forwardPicker(c, env)
	}
	if s.reschedule.open {
		s.rescheduler(c, env)
	}
}

func (s *State) forwardPicker(c *ui.Context, env Env) {
	t, st := env.Tokens, env.Store
	f := &s.forward
	kit.Dialog(c, t, &f.open, 380, copy.T(copy.ForwardTo), "", func() {
		kit.SearchBox(c, t, &f.query, copy.T(copy.SearchChats))
		q := strings.ToLower(strings.TrimSpace(f.query))
		ui.Scroll(c).Height(300).Children(func() {
			ui.Column(c).Gap(1).Children(func() {
				for _, ch := range st.All() {
					if !ch.CanSendMessages {
						continue
					}
					name := ch.Title
					if ch.Kind == tg.ChatSaved {
						name = copy.T(copy.SavedMessages)
					}
					if q != "" && !strings.Contains(strings.ToLower(name), q) {
						continue
					}
					row := ui.ButtonBase(c.Key(ch.ID)).Height(44).Padding(0, 8).Gap(10).Radius(theme.RadiusLG).AlignItems(ui.Center).Label(name)
					if f.picked == ch.ID {
						row.Background(t.AccentSoft)
					} else if row.Hovered() {
						row.Background(t.Subtle)
					}
					id := ch.ID
					row.Children(func() {
						kit.Avatar(c, t, env.Images, ch.Avatar, name, 32, ch.Kind == tg.ChatSaved)
						ui.Text(c, name).FontSize(theme.Body).Grow(1).SingleLine()
						if f.picked == id {
							ui.Icon(c, icons.Check).FontSize(16).TextColor(t.AccentInk)
						}
					})
					row.OnClick(func() { f.picked = id })
				}
			})
		})
		ui.Checkbox(c, &f.hide, copy.T(copy.ForwardHideSender))
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { f.open = false })
		kit.Button(c.Key("forward"), t, kit.Primary, copy.T(copy.Forward), f.picked != 0).OnClick(func() {
			to := f.picked
			st.Forward(f.from, f.ids, to, f.hide, func() {
				st.Notify(copy.T(copy.Forwarded), false)
			})
			st.Composer(f.from).Selected = map[tg.MessageID]bool{}
			f.open = false
		})
	})
}

func (s *State) rescheduler(c *ui.Context, env Env) {
	r := &s.reschedule
	if r.at.IsZero() {
		r.at = env.Runtime.Clock().Add(time.Hour).Truncate(time.Minute)
	}
	kit.Dialog(c, env.Tokens, &r.open, 340, copy.T(copy.Reschedule), "", func() {
		kit.DateTime(c, env.Tokens, &r.at, copy.T(copy.ScheduleFor))
	}, func() {
		kit.Button(c.Key("cancel"), env.Tokens, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { r.open = false })
		when := r.at
		ok := when.After(env.Runtime.Clock())
		kit.Button(c.Key("save"), env.Tokens, kit.Primary, copy.T(copy.ScheduleConfirm), ok).OnClick(func() {
			env.Store.RescheduleAction(r.chat, r.id, when)
			r.open = false
		})
	})
}
