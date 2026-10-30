package conversation

import (
	"slices"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// serviceText words a service message.
func serviceText(m tg.Message) string {
	who := m.SenderName
	switch m.Service {
	case tg.ServiceChatCreated:
		return copy.F(copy.ChatCreated, who)
	case tg.ServiceTitleChanged:
		return copy.F(copy.TitleChanged, who, m.Body)
	case tg.ServicePhotoChanged:
		return copy.F(copy.PhotoChanged, who)
	case tg.ServiceMembersAdded:
		return copy.F(copy.MembersAdded, who)
	case tg.ServiceMemberJoined:
		return copy.F(copy.MemberJoined, who)
	case tg.ServiceMemberLeft:
		return copy.F(copy.MemberLeft, who)
	case tg.ServicePinned:
		return copy.F(copy.MessagePinnedService, who)
	case tg.ServiceScreenshot:
		return copy.F(copy.ScreenshotTaken, who)
	case tg.ServiceAutoDelete:
		return copy.F(copy.AutoDeleteSet, who)
	case tg.ServiceJoinedTelegram:
		return copy.F(copy.JoinedTelegram, who)
	}
	return m.Body
}

// bare tells messages drawn without a bubble: stickers and emoji-only text.
func bare(m tg.Message) bool {
	return m.Media != nil && m.Media.Kind == tg.MediaSticker && m.Body == "" || m.IsolatedEmoji > 0 && m.Media == nil && m.ReplyTo == nil && m.Forward == nil
}

// mediaOnly tells a photo or video that fills its bubble edge to edge.
func mediaOnly(m tg.Message) bool {
	return m.Media != nil && (m.Media.Kind == tg.MediaPhoto || m.Media.Kind == tg.MediaVideo || m.Media.Kind == tg.MediaAnimation) && m.ReplyTo == nil && m.Forward == nil
}

func (v *View) messageRow(c *ui.Context, p Props, ch tg.Chat, r row) {
	t, s := p.Tokens, p.Store
	m := *r.message
	if m.Service != tg.ServiceNone {
		ui.Row(c).Padding(4, 0).Justify(ui.Center).Children(func() {
			ui.Row(c).Padding(3, 10).Radius(theme.RadiusPill).Background(t.Card.Alpha(0.86)).Border(1, t.Hairline).Children(func() {
				ui.Text(c, serviceText(m)).FontSize(theme.Caption + 1).TextColor(t.Muted).MaxLines(2)
			})
		})
		return
	}
	group := ch.Kind == tg.ChatGroup && !m.Outgoing
	selecting := len(s.Composer(ch.ID).Selected) > 0
	selected := s.Composer(ch.ID).Selected[m.ID]
	top := float32(theme.RunGap)
	if r.first {
		top = theme.GroupGap
	}
	line := ui.Row(c).Gap(theme.AvatarGap).AlignItems(ui.End).Padding(top, 0, 0, 0)
	if m.Outgoing {
		line.Justify(ui.End)
	}
	if selected {
		line.Background(t.AccentSoft.Alpha(0.6)).Radius(theme.RadiusMD)
	}
	if v.highlight == m.ID && p.Runtime.Clock().Sub(v.lightAt) < 1500e6 {
		line.Background(line.AnimateColor("light", t.Accent.Alpha(0.16), theme.Settle)).Radius(theme.RadiusMD)
		c.After(1600e6)
	}
	line.Children(func() {
		if selecting {
			box := selected
			if ui.Checkbox(c.Key("pick"), &box, "").Label(copy.T(copy.SelectMessage)).Changed() {
				s.ToggleSelected(ch.ID, m.ID)
			}
		}
		if group {
			slot := ui.Box(c).Size(theme.AvatarSize, theme.AvatarSize).Shrink(0)
			if r.last {
				slot.Children(func() {
					kit.Avatar(c, t, p.Images, m.SenderAvatar, m.SenderName, theme.AvatarSize, false)
				})
			}
		}
		v.bubble(c, p, ch, r, group)
	})
	if line.DoubleClicked() && !m.Pending() && ch.CanSendMessages {
		s.Reply(ch.ID, m.ID, "")
		v.Composer.Focus()
	}
	if selecting && line.Clicked() {
		s.ToggleSelected(ch.ID, m.ID)
	}
}

func (v *View) bubble(c *ui.Context, p Props, ch tg.Chat, r row, group bool) {
	t, s := p.Tokens, p.Store
	m := *r.message
	out := m.Outgoing
	fill, ink, meta := t.BubbleIn, t.BubbleInText, t.Muted
	if out {
		fill, ink, meta = t.BubbleOut, t.BubbleOutText, t.BubbleOutMeta
	}
	linkInk := t.AccentInk
	if out {
		linkInk = t.BubbleOutText
	}
	big, small := float32(theme.RadiusBubble), float32(theme.RadiusBubbleGrouped)
	tl, tr, br, bl := big, big, big, big
	if out {
		if !r.first {
			tr = small
		}
		if !r.last {
			br = small
		}
	} else {
		if !r.first {
			tl = small
		}
		if !r.last {
			bl = small
		}
	}
	bareMsg := bare(m)
	bub := ui.Column(c).MaxWidth(theme.BubbleMaxWidth).Gap(4).Shrink(1)
	if !bareMsg {
		bub.Radius(tl, tr, br, bl).Background(fill).TextColor(ink)
		if mediaOnly(m) && m.Body == "" && len(r.album) == 0 {
			bub.Clip().Shadow(0, 1, 2, 0, t.Shade.Alpha(0.15))
		} else {
			bub.Padding(theme.BubblePadY, theme.BubblePadX)
			if !out && !t.Dark {
				bub.Shadow(0, 1, 1, 0, t.Shade.Alpha(0.06))
			}
		}
	}
	revealed := v.revealed[m.ID]
	if revealed == nil {
		revealed = new(bool)
		v.revealed[m.ID] = revealed
	}
	style := richStyle{size: float32(p.Prefs.TextSize), ink: ink, linkInk: linkInk, codeFill: ink.Alpha(0.09), revealed: revealed, onLink: p.OpenLink}
	bub.Selectable()
	bub.Children(func() {
		if group && r.first && !bareMsg {
			ui.Text(c, m.SenderName).FontSize(theme.Callout).FontWeight(600).TextColor(nameColor(t, m.SenderAvatar)).SingleLine()
		}
		if f := m.Forward; f != nil {
			ui.Text(c, copy.F(copy.ForwardedFrom, f.SenderName)).FontSize(theme.Callout).FontWeight(500).TextColor(ifColor(out, ink, t.AccentInk)).SingleLine()
		}
		if rp := m.ReplyTo; rp != nil {
			v.quote(c, p, ch, *rp, out)
		}
		switch {
		case m.Poll != nil:
			pollCard(c, p, ch, m, ink, meta)
		case m.Call != nil:
			callCard(c, t, m, ink, meta)
		case len(r.album) > 0:
			albumGrid(c, p, r.album)
		case m.Media != nil:
			v.attachment(c, p, m, ink, meta)
		}
		if m.Body != "" && !(m.Media != nil && m.Media.Kind == tg.MediaSticker) {
			size := style.size
			if m.IsolatedEmoji > 0 && m.Media == nil {
				size = []float32{0, 48, 40, 32}[min(m.IsolatedEmoji, 3)]
			}
			st := style
			st.size = size
			body := ui.Column(c)
			if mediaOnly(m) {
				body.Padding(4, theme.BubblePadX, 0, theme.BubblePadX)
			}
			body.Children(func() { RichBody(c, t, m.Body, m.Entities, st) })
		}
		if tr, ok := s.Transcript(ch.ID).Translations[m.ID]; ok {
			ui.Column(c).Gap(2).Padding(6, 0, 0, 0).BorderWidth(1, 0, 0, 0).BorderColor(ink.Alpha(0.12)).Children(func() {
				ui.Text(c, copy.T(copy.Translation)).FontSize(theme.Caption).FontWeight(600).TextColor(meta)
				ui.Text(c, tr).FontSize(style.size).LineHeight(1.3125)
			})
		}
		if m.Keyboard != nil {
			v.keyboard(c, p, ch, m)
		}
		if len(m.Reactions) > 0 {
			reactions(c, p, ch, m, out)
		}
		metaLine(c, p, ch, m, meta, bareMsg || mediaOnly(m) && m.Body == "")
	})
	bub.PopoverMenu(func(menu *ui.Menu) {
		env := v.actionEnv(p)
		if texts := bub.SelectedTexts(); len(texts) > 0 {
			r := []rune(texts[0].Text)
			env.Selection = string(r[max(0, texts[0].Start):min(len(r), texts[0].End)])
		}
		v.actions.Menu(menu, env, m, false)
	})
}

// nameColor is a sender's name in their accent, as Telegram colors them.
func nameColor(t theme.Tokens, a tg.Avatar) ui.Color {
	if a.Placeholder != nil && len(a.Placeholder.LightColors) > 0 {
		c := ui.Hex(a.Placeholder.LightColors[0])
		if t.Dark {
			return c.Mix(ui.RGB(255, 255, 255), 0.15)
		}
		return c.Mix(ui.RGB(0, 0, 0), 0.2)
	}
	return t.AccentInk
}

func ifColor(cond bool, a, b ui.Color) ui.Color {
	if cond {
		return a
	}
	return b
}

func (v *View) quote(c *ui.Context, p Props, ch tg.Chat, rp tg.ReplyTo, out bool) {
	t := p.Tokens
	bar, ink := t.Accent, t.AccentInk
	if out {
		bar, ink = t.BubbleOutText, t.BubbleOutText
	}
	q := ui.ButtonBase(c.Key("reply")).Gap(8).Padding(4, 8, 4, 0).Radius(theme.RadiusMD).Background(bar.Alpha(0.1)).Label(copy.T(copy.ReplyTo))
	q.Children(func() {
		ui.Box(c).Width(3).Radius(theme.RadiusXS).Background(bar).AlignSelf(ui.Stretch)
		ui.Column(c).Gap(1).Shrink(1).Children(func() {
			ui.Text(c, rp.SenderName).FontSize(theme.Callout).FontWeight(600).TextColor(ink).SingleLine()
			text := rp.Body
			if rp.Quote != "" {
				text = rp.Quote
			}
			ui.Text(c, text).FontSize(theme.Callout).SingleLine().Opacity(0.9)
		})
	})
	id := rp.ID
	q.OnClick(func() { v.jump(p, ch.ID, id) })
}

// metaLine is the time, the edited mark and the delivery state.
func metaLine(c *ui.Context, p Props, ch tg.Chat, m tg.Message, meta ui.Color, overlay bool) {
	t := p.Tokens
	row := ui.Row(c).Gap(4).AlignItems(ui.Center).AlignSelf(ui.End).Margin(0, 0, 0, 0)
	if overlay {
		row.Padding(1, 6).Radius(theme.RadiusPill).Background(t.Scrim.Alpha(0.45)).Margin(-24, 6, 6, 0)
		meta = ui.RGB(255, 255, 255)
	}
	row.Children(func() {
		if m.Views > 0 {
			ui.Icon(c, icons.Eye).FontSize(11).TextColor(meta)
			ui.Text(c, copy.Count(m.Views)).FontSize(theme.Caption).TextColor(meta).FontFeatures("tnum")
		}
		if !m.EditedAt.IsZero() {
			ui.Text(c, copy.T(copy.Edited)).FontSize(theme.Caption).TextColor(meta)
		}
		ui.Text(c, p.Formats.Clock(m.SentAt)).FontSize(theme.Caption).TextColor(meta).FontFeatures("tnum")
		if m.Outgoing && ch.Kind != tg.ChatChannel {
			status(c, p, ch, m, meta)
		}
	})
}

func status(c *ui.Context, p Props, ch tg.Chat, m tg.Message, meta ui.Color) {
	t, s := p.Tokens, p.Store
	switch {
	case m.Status == tg.StatusFailed:
		retry := ui.ButtonBase(c.Key("retry")).Label(copy.T(copy.ResendMessage)).Tooltip(copy.T(copy.MessageFailed))
		retry.Children(func() { ui.Icon(c, icons.WarningCircle).FontSize(13).TextColor(t.Danger) })
		retry.OnClick(func() { s.Resend(ch.ID, m.ID) })
	case m.Status == tg.StatusSending:
		ui.Icon(c, icons.Clock).FontSize(12).TextColor(meta).Label(copy.T(copy.MessageSending))
	case m.Status == tg.StatusRead || m.ID <= ch.LastReadOutboxID || ch.Kind == tg.ChatSaved:
		ui.Icon(c, icons.Checks).FontSize(14).TextColor(meta).Label(copy.T(copy.MessageRead))
	default:
		ui.Icon(c, icons.Check).FontSize(13).TextColor(meta).Label(copy.T(copy.MessageSent))
	}
}

func reactions(c *ui.Context, p Props, ch tg.Chat, m tg.Message, out bool) {
	t, s := p.Tokens, p.Store
	ui.Row(c).Gap(6).Wrap().Children(func() {
		for _, r := range m.Reactions {
			chip := ui.ButtonBase(c.Key(r.Emoji)).Height(28).Padding(0, 9, 0, 7).Gap(5).Radius(14).AlignItems(ui.Center).Label(r.Emoji)
			switch {
			case r.Chosen && out:
				chip.Background(t.BubbleOutText).TextColor(t.BubbleOut)
			case r.Chosen:
				chip.Background(t.Accent).TextColor(t.AccentText)
			case out:
				chip.Background(t.BubbleOutText.Alpha(0.18))
			default:
				chip.Background(t.AccentSoft).TextColor(t.AccentInk)
			}
			kit.Press(chip)
			chip.Children(func() {
				ui.Text(c, r.Emoji).FontSize(16)
				ui.Text(c, copy.Count(r.Count)).FontSize(theme.Callout).FontWeight(600).FontFeatures("tnum")
			})
			emoji := r.Emoji
			chip.OnClick(func() { s.React(ch.ID, m.ID, emoji) })
		}
	})
}

func (v *View) keyboard(c *ui.Context, p Props, ch tg.Chat, m tg.Message) {
	t := p.Tokens
	ui.Column(c).Gap(4).Padding(4, 0, 0, 0).Children(func() {
		for ri, rowButtons := range m.Keyboard.Rows {
			ui.Row(c.Key(ri)).Gap(4).Children(func() {
				for _, b := range rowButtons {
					btn := ui.ButtonBase(c.Key(b.ID)).Height(32).Grow(1).Basis(0).Radius(theme.RadiusMD + 2).Justify(ui.Center).AlignItems(ui.Center).
						Background(t.Accent.Alpha(0.12)).TextColor(t.AccentInk).Label(b.Text)
					if btn.Hovered() {
						btn.Background(t.Accent.Alpha(0.2))
					}
					kit.Press(btn)
					button := b
					btn.Children(func() {
						ui.Text(c, button.Text).FontSize(theme.Callout).FontWeight(600).SingleLine()
						if button.Kind == tg.ButtonURL {
							ui.Icon(c, icons.ArrowUpRight).FontSize(11)
						}
					})
					btn.OnClick(func() { v.press(p, ch, m, button) })
				}
			})
		}
	})
}

// press runs an inline keyboard button.
func (v *View) press(p Props, ch tg.Chat, m tg.Message, b tg.Button) {
	s, rt := p.Store, p.Runtime
	switch b.Kind {
	case tg.ButtonURL:
		p.OpenLink(b.URL)
	case tg.ButtonCopy:
		rt.Desktop.WriteClipboard(b.CopyText)
		s.Notify(copy.T(copy.Copied), false)
	case tg.ButtonCallback:
		answer(p, ch, m, b)
	default:
		s.Notify(copy.T(copy.BotButtonUnsupported), false)
	}
}

// pollCard draws a poll with its options, tallies and vote.
func pollCard(c *ui.Context, p Props, ch tg.Chat, m tg.Message, ink, meta ui.Color) {
	t, s := p.Tokens, p.Store
	poll := *m.Poll
	voted := slices.ContainsFunc(poll.Options, func(o tg.PollOption) bool { return o.Chosen })
	results := voted || poll.Closed
	kind := copy.PollPublic
	switch {
	case poll.Kind == tg.PollQuiz && poll.Anonymous:
		kind = copy.PollAnonymousQuiz
	case poll.Kind == tg.PollQuiz:
		kind = copy.PollQuiz
	case poll.Anonymous:
		kind = copy.PollAnonymous
	}
	if poll.Closed {
		kind = copy.PollFinalResults
	}
	ui.Column(c).Gap(8).MinWidth(260).Children(func() {
		ui.Text(c, poll.Question).FontSize(float32(p.Prefs.TextSize)).FontWeight(600)
		ui.Text(c, copy.T(kind)).FontSize(theme.Caption).TextColor(meta)
		picked := ui.Local(c.Root(), "poll-picks", func() map[tg.MessageID]map[int]bool { return map[tg.MessageID]map[int]bool{} })
		if (*picked)[m.ID] == nil {
			(*picked)[m.ID] = map[int]bool{}
		}
		choice := (*picked)[m.ID]
		for i, o := range poll.Options {
			correct := slices.Contains(poll.CorrectOptionIDs, i)
			opt := ui.ButtonBase(c.Key(i)).Gap(8).Padding(4, 0).AlignItems(ui.Center).Label(o.Text).Disabled(results)
			opt.Children(func() {
				switch {
				case results:
					ui.Text(c, copy.F(copy.Percent, o.Percentage)).FontSize(theme.Callout).FontWeight(600).Width(36).FontFeatures("tnum")
				case poll.MultipleAnswers:
					on := choice[i]
					ui.Box(c).Size(18, 18).Radius(4).Border(1.5, ifColor(on, t.Accent, meta)).Background(ifColor(on, t.Accent, ui.Transparent))
				default:
					ui.Box(c).Size(18, 18).Radius(9).Border(1.5, meta)
				}
				ui.Column(c).Grow(1).Gap(3).Children(func() {
					ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
						ui.Text(c, o.Text).FontSize(float32(p.Prefs.TextSize)).Grow(1)
						if results && o.Chosen {
							ui.Icon(c, icons.CheckCircle).FontSize(14).TextColor(ifColor(poll.Kind == tg.PollQuiz && !correct, t.Danger, t.Accent))
						}
					})
					if results {
						bar := ui.Box(c).Height(4).Radius(2).Background(ink.Alpha(0.12))
						fill := t.Accent
						if poll.Kind == tg.PollQuiz && correct {
							fill = t.Success
						}
						bar.Children(func() {
							ui.Box(c).Height(4).Radius(2).WidthPercent(float32(o.Percentage)).Background(fill)
						})
					}
				})
			})
			if !results {
				index := i
				opt.OnClick(func() {
					if poll.MultipleAnswers {
						choice[index] = !choice[index]
						return
					}
					s.Vote(ch.ID, m.ID, []int{index})
				})
			}
		}
		ui.Row(c).Children(func() {
			if poll.MultipleAnswers && !results {
				var picks []int
				for i := range poll.Options {
					if choice[i] {
						picks = append(picks, i)
					}
				}
				kit.SizedButton(c.Key("vote"), t, kit.Ghost, kit.SizeSmall, nil, copy.T(copy.PollVote), len(picks) > 0).OnClick(func() {
					s.Vote(ch.ID, m.ID, picks)
				})
				return
			}
			total := copy.T(copy.PollNoVotes)
			if poll.TotalVoterCount > 0 {
				total = copy.Plural(poll.TotalVoterCount, copy.PollVoteOne, copy.PollVotes)
			}
			ui.Text(c, total).FontSize(theme.Caption).TextColor(meta)
		})
		if poll.Explanation != "" && results && poll.Kind == tg.PollQuiz {
			ui.Text(c, poll.Explanation).FontSize(theme.Callout).TextColor(meta)
		}
	})
}

// callCard draws a call message, as tdesktop folds them.
func callCard(c *ui.Context, t theme.Tokens, m tg.Message, ink, meta ui.Color) {
	call := m.Call
	label := map[tg.CallStatus]copy.Key{tg.CallOutgoing: copy.CallOutgoing, tg.CallIncoming: copy.CallIncoming, tg.CallMissed: copy.CallMissed,
		tg.CallDeclined: copy.CallDeclined, tg.CallCancelled: copy.CallCancelled, tg.CallGroup: copy.CallGroup}[call.Status]
	if call.Video {
		switch call.Status {
		case tg.CallOutgoing:
			label = copy.CallVideoOutgoing
		case tg.CallIncoming:
			label = copy.CallVideoIncoming
		case tg.CallMissed:
			label = copy.CallVideoMissed
		}
	}
	icon := icons.PhoneOutgoing
	color := t.Success
	switch call.Status {
	case tg.CallIncoming:
		icon = icons.PhoneIncoming
	case tg.CallMissed, tg.CallDeclined, tg.CallCancelled:
		icon, color = icons.PhoneX, t.Danger
	}
	if call.Video {
		icon = icons.VideoCamera
	}
	ui.Row(c).Gap(10).MinWidth(190).AlignItems(ui.Center).Children(func() {
		disc := ui.Row(c).Size(36, 36).Radius(18).Background(color.Alpha(0.14)).Justify(ui.Center).AlignItems(ui.Center)
		disc.Children(func() { ui.Icon(c, icon).FontSize(18).TextColor(color) })
		ui.Column(c).Gap(1).Children(func() {
			ui.Text(c, copy.T(label)).FontSize(theme.Body).FontWeight(600)
			if call.Duration > 0 {
				ui.Text(c, copy.Duration(call.Duration)).FontSize(theme.Caption).TextColor(meta).FontFeatures("tnum")
			}
		})
	})
}
