package compose

import (
	"fmt"
	"slices"
	"strings"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// pollDialog creates a poll or a quiz.
type pollDialog struct {
	shown     bool
	chat      tg.ChatID
	question  string
	options   []string
	anonymous bool
	multiple  bool
	quiz      bool
	correct   int
	err       copy.Key
}

func (p *pollDialog) open(chat tg.ChatID) {
	*p = pollDialog{shown: true, chat: chat, options: []string{"", ""}, anonymous: true}
}

// Validate returns the poll input or the problem with it.
func (p *pollDialog) validate() (tg.PollInput, copy.Key) {
	in := tg.PollInput{Question: strings.TrimSpace(p.question), Anonymous: p.anonymous, MultipleAnswers: p.multiple && !p.quiz, Kind: tg.PollRegular, CorrectOption: p.correct}
	if p.quiz {
		in.Kind = tg.PollQuiz
	}
	for _, o := range p.options {
		if o = strings.TrimSpace(o); o != "" {
			in.Options = append(in.Options, o)
		}
	}
	switch {
	case in.Question == "":
		return in, copy.PollNeedsQuestion
	case len(in.Options) < tg.PollOptionsMin || len(in.Options) > tg.PollOptionsMax:
		return in, copy.PollNeedsOptions
	case p.quiz && (p.correct < 0 || p.correct >= len(in.Options) || strings.TrimSpace(p.options[p.correct]) == ""):
		return in, copy.PollQuizNeedsAnswer
	}
	return in, ""
}

func (p *pollDialog) render(c *ui.Context, env Env, chat tg.ChatID) {
	if !p.shown || p.chat != chat {
		return
	}
	t := env.Tokens
	kit.Dialog(c, t, &p.shown, 420, copy.T(copy.NewPoll), "", func() {
		kit.Field(ui.TextInput(c.Key("question"), &p.question).AutoFocus().Placeholder(copy.T(copy.PollQuestionPlaceholder)).Label(copy.T(copy.PollQuestion)), t)
		kit.SectionTitle(c, t, copy.T(copy.PollOptions))
		ui.Column(c).Gap(6).Children(func() {
			for i := range p.options {
				ui.Row(c.Key(i)).Gap(6).AlignItems(ui.Center).Children(func() {
					if p.quiz {
						ui.Radio(c, &p.correct, i, "").Label(copy.T(copy.PollCorrectAnswer))
					}
					kit.Field(ui.TextInput(c.Key("option"), &p.options[i]).Placeholder(copy.F(copy.PollOptionPlaceholder, i+1)).Label(copy.F(copy.PollOptionPlaceholder, i+1)).Grow(1), t)
					if len(p.options) > tg.PollOptionsMin {
						index := i
						kit.IconButton(c.Key("remove"), t, icons.Minus, copy.T(copy.Remove)).OnClick(func() {
							p.options = slices.Delete(p.options, index, index+1)
							p.correct = min(p.correct, len(p.options)-1)
						})
					}
				})
			}
			if len(p.options) < tg.PollOptionsMax {
				kit.SizedButton(c.Key("add"), t, kit.Ghost, kit.SizeSmall, icons.Plus, copy.T(copy.AddPollOption), true).OnClick(func() { p.options = append(p.options, "") })
			}
		})
		kit.Toggle(c, t, &p.anonymous, copy.T(copy.PollAnonymousVoting))
		if !p.quiz {
			kit.Toggle(c, t, &p.multiple, copy.T(copy.PollMultipleAnswers))
		}
		kit.Toggle(c, t, &p.quiz, copy.T(copy.PollQuizMode))
		if p.err != "" {
			ui.Text(c, copy.T(p.err)).FontSize(theme.Callout).TextColor(t.Danger)
		}
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { p.shown = false })
		kit.Button(c.Key("create"), t, kit.Primary, copy.T(copy.Create), true).OnClick(func() {
			in, problem := p.validate()
			if problem != "" {
				p.err = problem
				return
			}
			env.Store.SendPoll(p.chat, in)
			p.shown = false
		})
	})
}

// scheduleDialog picks when to send.
type scheduleDialog struct {
	shown bool
	chat  tg.ChatID
	at    time.Time
}

func (d *scheduleDialog) openFor(chat tg.ChatID, _ bool, now time.Time) {
	*d = scheduleDialog{shown: true, chat: chat, at: now.Add(time.Hour).Truncate(time.Minute)}
}

func (d *scheduleDialog) render(c *ui.Context, env Env, chat tg.ChatID, cp *Composer) {
	if !d.shown || d.chat != chat {
		return
	}
	t := env.Tokens
	kit.Dialog(c, t, &d.shown, 340, copy.T(copy.ScheduleMessage), "", func() {
		kit.DateTime(c, t, &d.at, copy.T(copy.ScheduleFor))
		if !d.at.After(env.Runtime.Clock()) {
			ui.Text(c, copy.T(copy.SchedulePast)).FontSize(theme.Callout).TextColor(t.Danger)
		}
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { d.shown = false })
		kit.Button(c.Key("schedule"), t, kit.Primary, copy.T(copy.ScheduleConfirm), d.at.After(env.Runtime.Clock())).OnClick(func() {
			state := env.Store.Composer(chat)
			cp.send(env, chat, state, state.Text, tg.SendOptions{SendAt: d.at})
			d.shown = false
			env.Store.Notify(copy.T(copy.ScheduledMessages), false)
		})
	})
}

// renderPanel is the emoji and sticker panel above the field.
func (cp *Composer) renderPanel(c *ui.Context, env Env, ch tg.Chat) {
	t, s := env.Tokens, env.Store
	panel := kit.Card(c.Key("panel"), t).Height(300).Gap(0).
		Transition(t.Transition(theme.Settle, &ui.Motion{Y: 10, Opacity: 0}, &ui.Motion{Y: 6, Opacity: 0}))
	panel.Children(func() {
		ui.Row(c).Padding(8, 10).Gap(8).AlignItems(ui.Center).Children(func() {
			kit.Segmented(c, t, &cp.panelTab, []string{copy.T(copy.Emoji), copy.T(copy.Stickers)})
			ui.Spacer(c)
			if cp.panelTab == 0 {
				kit.SearchBox(c, t, &cp.emojiQuery, copy.T(copy.SearchEmoji)).Width(180)
			}
		})
		ui.Box(c).Height(1).Background(t.Hairline)
		if cp.panelTab == 0 {
			cp.emojiGrid(c, env, ch)
			return
		}
		if !ch.CanSendStickers {
			kit.Empty(c, t, icons.Sticker, copy.T(copy.StickersDisabledNote))
			return
		}
		cp.stickerGrid(c, env, ch)
	})
	_ = s
}

var emojiCategoryTitles = map[string]copy.Key{
	"smileys": copy.EmojiSmileys, "people": copy.EmojiPeople, "animals": copy.EmojiNature, "food": copy.EmojiFood,
	"activity": copy.EmojiActivity, "travel": copy.EmojiTravel, "objects": copy.EmojiObjects, "symbols": copy.EmojiSymbols,
}

func (cp *Composer) emojiGrid(c *ui.Context, env Env, ch tg.Chat) {
	t, s := env.Tokens, env.Store
	q := strings.ToLower(strings.TrimSpace(cp.emojiQuery))
	insert := func(glyph string) {
		state := s.Composer(ch.ID)
		state.Text += glyph
		if env.Runtime.Preferences != nil {
			recent := env.Prefs.RecentEmojis
			env.Runtime.Go(func(ctx_ ctxT) func() {
				_, _ = env.Runtime.Preferences.Update(ctx_, func(p *prefsT) { p.RecentEmojis = pushRecent(recent, glyph) })
				return nil
			})
		}
	}
	ui.Scroll(c).Grow(1).Children(func() {
		ui.Column(c).Padding(6, 8).Gap(6).Children(func() {
			cell := func(glyph string) {
				b := ui.ButtonBase(c.Key(glyph)).Size(34, 34).Radius(theme.RadiusMD).Justify(ui.Center).AlignItems(ui.Center).Label(glyph)
				if b.Hovered() {
					b.Background(t.Subtle)
				}
				b.Children(func() { ui.Text(c, glyph).FontSize(22) })
				g := glyph
				b.OnClick(func() { insert(g) })
			}
			if q == "" && len(env.Prefs.RecentEmojis) > 0 {
				kit.SectionTitle(c, t, copy.T(copy.EmojiRecent))
				ui.Row(c.Key("recent")).Wrap().Children(func() {
					for _, g := range env.Prefs.RecentEmojis {
						cell(g)
					}
				})
			}
			for _, cat := range emojiCategoriesOrdered() {
				var glyphs []string
				for _, e := range emojiIn(cat) {
					if q == "" || strings.Contains(e.Name, q) {
						glyphs = append(glyphs, e.Glyph)
					}
				}
				if len(glyphs) == 0 {
					continue
				}
				if q == "" {
					kit.SectionTitle(c.Key("t"+cat), t, copy.T(emojiCategoryTitles[cat]))
				}
				ui.Row(c.Key(cat)).Wrap().Children(func() {
					for _, g := range glyphs {
						cell(g)
					}
				})
			}
		})
	})
}

func (cp *Composer) stickerGrid(c *ui.Context, env Env, ch tg.Chat) {
	t, s := env.Tokens, env.Store
	if cp.stickers == nil {
		if !cp.loadingCat {
			cp.loadingCat = true
			cp.loadStickers(env)
		}
		ui.Row(c).Grow(1).Justify(ui.Center).AlignItems(ui.Center).Children(func() { ui.Spinner(c) })
		return
	}
	cat := cp.stickers
	ui.Scroll(c).Grow(1).Children(func() {
		ui.Column(c).Padding(6, 8).Gap(8).Children(func() {
			grid := func(key string, title copy.Key, label string, stickers []tg.Sticker) {
				if len(stickers) == 0 {
					return
				}
				if title != "" {
					kit.SectionTitle(c.Key("t"+key), t, copy.T(title))
				} else {
					kit.SectionTitle(c.Key("t"+key), t, label)
				}
				ui.Row(c.Key(key)).Wrap().Gap(4).Children(func() {
					for _, st := range stickers {
						b := ui.ButtonBase(c.Key(st.ID)).Size(64, 64).Radius(theme.RadiusLG).Justify(ui.Center).AlignItems(ui.Center).Label(st.Emoji)
						if b.Hovered() {
							b.Background(t.Subtle)
						}
						sticker := st
						b.Children(func() {
							if bm := env.Images.File(sticker.Path); bm != nil {
								ui.Image(c, bm).Size(56, 56).Fit(ui.Contain)
							} else {
								s.Download(sticker.FileID)
								if d, ok := s.Downloads[sticker.FileID]; ok && d.Path != "" {
									sticker.Path = d.Path
								}
								ui.Text(c, sticker.Emoji).FontSize(28)
							}
						})
						b.OnClick(func() {
							if d, ok := s.Downloads[sticker.FileID]; ok {
								sticker.Path = d.Path
							}
							s.SendSticker(ch.ID, sticker, tg.SendOptions{ReplyTo: s.Composer(ch.ID).ReplyTo})
							s.Composer(ch.ID).ReplyTo = 0
							cp.panel = false
						})
					}
				})
			}
			resolve := func(list []tg.Sticker) []tg.Sticker {
				out := slices.Clone(list)
				for i := range out {
					if d, ok := s.Downloads[out[i].FileID]; ok && d.Path != "" {
						out[i].Path = d.Path
					}
				}
				return out
			}
			grid("recent", copy.RecentStickers, "", resolve(cat.Recent))
			grid("favorites", copy.FavoriteStickers, "", resolve(cat.Favorites))
			for _, set := range cat.Sets {
				full, ok := cp.stickerSet[set.ID]
				if !ok {
					cp.loadSet(env, set.ID)
					continue
				}
				grid(fmt.Sprint(set.ID), "", set.Title, resolve(full.Stickers))
			}
			if len(cat.Recent)+len(cat.Favorites)+len(cat.Sets) == 0 {
				kit.Empty(c, t, icons.Sticker, copy.T(copy.NoStickers))
			}
		})
	})
}
