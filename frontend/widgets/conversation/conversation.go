// Package conversation is the workspace's center column: the chat header
// with its status line, the pinned message bar, in-chat search, the
// transcript and the composer, with the selection bar replacing the
// composer while messages are picked.
package conversation

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/features/compose"
	"github.com/AstraFoundry/telo/frontend/features/messageactions"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/lib/timefmt"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Props is what the column needs from the page.
type Props struct {
	Tokens  theme.Tokens
	Store   *chat.Store
	Runtime *runtime.Runtime
	Images  *media.Images
	Formats timefmt.Formats
	Prefs   preferences.Preferences
	Mac     bool
	// TitleBar is the room the window controls take, for the header.
	TitleBar ui.TitleBar
	// InfoOpen tells whether the profile panel shows; ToggleInfo flips it.
	InfoOpen   bool
	ToggleInfo func()
	// OpenLink opens a link from a message: URLs, mentions, hashtags.
	OpenLink func(link string)
	// OpenMedia shows a photo in the viewer.
	OpenMedia func(m tg.Message)
	// Summarize hands a message to the agent; nil when it is off.
	Summarize func(m tg.Message)
	// Language is the translation target.
	Language string
}

// View keeps the column's state between frames.
type View struct {
	list      ui.ListState
	listChat  tg.ChatID
	Composer  compose.Composer
	actions   messageactions.State
	revealed  map[tg.MessageID]*bool
	search    searchState
	pinnedAt  int
	highlight tg.MessageID
	lightAt   time.Time
	viewed    map[tg.MessageID]bool
	// voice tracks the voice message being played.
	playing tg.MessageID
}

type searchState struct {
	open    bool
	query   string
	asked   string
	hits    []tg.MessageID
	total   int
	index   int
	handle  ui.Handle
	loading bool
}

// OpenSearch shows the in-chat search bar and focuses it.
func (v *View) OpenSearch() {
	v.search.open = true
	v.search.handle.Focus()
}

// Render draws the selected chat, or the empty state.
func (v *View) Render(c *ui.Context, p Props) {
	t, s := p.Tokens, p.Store
	ch, ok := s.Chat(s.Selected)
	if !ok {
		ui.Column(c).Fill().Background(t.Canvas).Children(func() {
			ui.Box(c).Height(max(p.TitleBar.Height, 28) + 24).DragWindow()
			kit.Empty(c, t, icons.Chats, copy.T(copy.SelectChat))
		})
		return
	}
	if v.listChat != ch.ID {
		v.listChat = ch.ID
		v.list = ui.ListState{FollowEnd: true, FollowAnimation: &ui.Smooth}
		v.search = searchState{}
		v.pinnedAt, v.highlight = 0, 0
		v.viewed = map[tg.MessageID]bool{}
	}
	if v.revealed == nil {
		v.revealed = map[tg.MessageID]*bool{}
	}
	ui.Column(c).Fill().Background(t.Canvas).Children(func() {
		v.header(c, p, ch)
		if v.search.open {
			v.searchBar(c, p, ch)
		}
		v.pinnedBar(c, p, ch)
		ui.Column(c).Grow(1).Children(func() {
			wallpaper(c, t, p.Prefs.Wallpaper)
			v.transcript(c, p, ch)
			v.jumpButton(c, p, ch)
		})
		if ids := s.SelectedIDs(ch.ID); len(ids) > 0 {
			v.selectionBar(c, p, ch, ids)
		}
		v.Composer.Render(c, compose.Env{Tokens: t, Store: s, Runtime: p.Runtime, Images: p.Images, Prefs: p.Prefs, Mac: p.Mac,
			OpenInfo: func() {
				if !p.InfoOpen {
					p.ToggleInfo()
				}
			}}, ch.ID)
	})
	v.actions.Dialogs(c, v.actionEnv(p))
}

func (v *View) actionEnv(p Props) messageactions.Env {
	return messageactions.Env{
		Tokens: p.Tokens, Store: p.Store, Runtime: p.Runtime, Images: p.Images, Language: p.Language,
		Summarize: p.Summarize, FocusComposer: v.Composer.Focus,
		Clock: func(m tg.Message) (string, string) {
			edited := ""
			if !m.EditedAt.IsZero() {
				edited = p.Formats.Full(m.EditedAt)
			}
			return p.Formats.Full(m.SentAt), edited
		},
	}
}

// wallpaper paints the chosen backdrop behind the transcript from tokens.
func wallpaper(c *ui.Context, t theme.Tokens, w preferences.Wallpaper) {
	layer := ui.Box(c).Absolute().Top(0).Left(0).Right(0).Bottom(0).PassThrough()
	switch w {
	case preferences.WallpaperDots:
		layer.Draw(func(p *ui.Painter, r ui.Rect) {
			for y := r.Y + 11; y < r.Y+r.H; y += 22 {
				for x := r.X + 11; x < r.X+r.W; x += 22 {
					p.Fill(ui.Rect{X: x - 1, Y: y - 1, W: 2, H: 2}, t.BackdropInk, 1)
				}
			}
		})
	case preferences.WallpaperGrid:
		layer.Draw(func(p *ui.Painter, r ui.Rect) {
			for x := r.X; x < r.X+r.W; x += 24 {
				p.Fill(ui.Rect{X: x, Y: r.Y, W: 1, H: r.H}, t.BackdropInk, 0)
			}
			for y := r.Y; y < r.Y+r.H; y += 24 {
				p.Fill(ui.Rect{X: r.X, Y: y, W: r.W, H: 1}, t.BackdropInk, 0)
			}
		})
	case preferences.WallpaperGradient:
		layer.LinearGradient(ui.LinearGradient{From: t.Accent.Alpha(0.10), To: t.Accent.Alpha(0.02), Angle: 135})
	}
}

// statusLine is the header's second line.
func statusLine(p Props, ch tg.Chat) (string, bool) {
	switch {
	case ch.Typing:
		return copy.T(copy.Typing), true
	case ch.Kind == tg.ChatSaved:
		return "", false
	case ch.Kind == tg.ChatSecret:
		if ch.SecretState == tg.SecretPending {
			return copy.F(copy.SecretChatWaiting, ch.Title), false
		}
		return copy.T(copy.SecretChatLabel), false
	case ch.Kind == tg.ChatGroup:
		return copy.Plural(ch.MemberCount, copy.Member, copy.Members), false
	case ch.Kind == tg.ChatChannel:
		return copy.Plural(ch.MemberCount, copy.Subscriber, copy.Subscribers), false
	case ch.Online:
		return copy.T(copy.Online), true
	}
	return copy.T(copy.LastSeenRecently), false
}

func (v *View) header(c *ui.Context, p Props, ch tg.Chat) {
	t, s := p.Tokens, p.Store
	top := max(p.TitleBar.Height, 28)
	bar := ui.Row(c).MinHeight(top+24).Padding(top-22, 12, 8, 16).Gap(12).AlignItems(ui.Center).Background(t.Card).
		BorderWidth(0, 0, 1, 0).BorderColor(t.Hairline).DragWindow()
	bar.Children(func() {
		title := ch.Title
		if ch.Kind == tg.ChatSaved {
			title = copy.T(copy.SavedMessages)
		}
		who := ui.ButtonBase(c.Key("who")).Gap(10).AlignItems(ui.Center).Grow(1).Shrink(1).Label(copy.T(copy.OpenChatInfo))
		who.Children(func() {
			kit.Avatar(c, t, p.Images, ch.Avatar, ch.Title, 36, ch.Kind == tg.ChatSaved)
			ui.Column(c).Gap(1).Shrink(1).Children(func() {
				ui.Row(c).Gap(5).AlignItems(ui.Center).Children(func() {
					if ch.Kind == tg.ChatSecret {
						ui.Icon(c, icons.LockSimple).FontSize(13).TextColor(t.Success)
					}
					ui.Text(c, title).FontSize(theme.Heading).FontWeight(600).SingleLine()
					if ch.Muted {
						ui.Icon(c, icons.BellSlash).FontSize(12).TextColor(t.Muted)
					}
				})
				if line, active := statusLine(p, ch); line != "" {
					color := t.Muted
					if active {
						color = t.AccentInk
					}
					ui.Text(c, line).FontSize(theme.Callout).TextColor(color).SingleLine()
				}
			})
		})
		who.OnClick(p.ToggleInfo)
		if s.Connection != tg.ConnectionReady {
			kit.Status(c, t, icons.CircleNotch, t.Muted, connectionText(s.Connection))
		}
		kit.IconButton(c.Key("search"), t, icons.MagnifyingGlass, copy.T(copy.SearchInChat)).OnClick(v.OpenSearch)
		info := kit.IconButton(c.Key("info"), t, icons.SidebarSimple, copy.T(copy.OpenChatInfo))
		if p.InfoOpen {
			info.TextColor(t.AccentInk).Background(t.AccentSoft)
		}
		info.OnClick(p.ToggleInfo)
	})
}

func connectionText(state tg.ConnectionState) string {
	switch state {
	case tg.ConnectionOffline:
		return copy.T(copy.ConnectionWaiting)
	case tg.ConnectionProxy:
		return copy.T(copy.ConnectionProxy)
	case tg.ConnectionSynchronizing:
		return copy.T(copy.ConnectionUpdating)
	}
	return copy.T(copy.ConnectionConnecting)
}

// pinnedBar shows the pinned message the transcript is nearest to; a
// click jumps to it and moves on to the next older one, as Telegram does.
func (v *View) pinnedBar(c *ui.Context, p Props, ch tg.Chat) {
	t, s := p.Tokens, p.Store
	pinned := s.Transcript(ch.ID).Pinned
	if len(pinned) == 0 {
		return
	}
	if v.pinnedAt >= len(pinned) {
		v.pinnedAt = 0
	}
	m := pinned[v.pinnedAt]
	bar := ui.ButtonBase(c.Key("pinned")).Padding(6, 16).Gap(10).AlignItems(ui.Center).Background(t.Card).BorderWidth(0, 0, 1, 0).BorderColor(t.Hairline).Label(copy.T(copy.PinnedMessage))
	bar.Children(func() {
		ui.Row(c).Gap(2).Children(func() {
			for i := range pinned {
				seg := ui.Box(c.Key(i)).Width(2).Height(max(8, 32/float32(len(pinned)))).Radius(1)
				if i == v.pinnedAt {
					seg.Background(t.Accent)
				} else {
					seg.Background(t.Accent.Alpha(0.3))
				}
			}
		})
		ui.Column(c).Grow(1).Shrink(1).Gap(1).Children(func() {
			label := copy.T(copy.PinnedMessage)
			if len(pinned) > 1 {
				label = copy.F(copy.PinnedMessageOf, len(pinned)-v.pinnedAt, len(pinned))
			}
			ui.Text(c, label).FontSize(theme.Callout).FontWeight(600).TextColor(t.AccentInk)
			ui.Text(c, chat.Summary(m)).FontSize(theme.Callout).TextColor(t.Text).SingleLine()
		})
		if canUnpin(ch) {
			kit.IconButton(c.Key("unpin"), t, icons.PushPinSlash, copy.T(copy.UnpinMessage)).OnClick(func() { s.Pin(ch.ID, m.ID, false, false) })
		}
	})
	bar.OnClick(func() {
		v.jump(p, ch.ID, m.ID)
		v.pinnedAt = (v.pinnedAt + 1) % len(pinned)
	})
}

func canUnpin(ch tg.Chat) bool { return ch.Kind != tg.ChatChannel || ch.CanSendMessages }

// jump scrolls to a message, loading the page around it first, and
// highlights it briefly.
func (v *View) jump(p Props, chatID tg.ChatID, id tg.MessageID) {
	p.Store.JumpTo(chatID, id, func() {
		v.highlight, v.lightAt = id, p.Runtime.Clock()
		v.scrollToMessage(p, chatID, id)
	})
}

func (v *View) scrollToMessage(p Props, chatID tg.ChatID, id tg.MessageID) {
	rows := buildRows(p, p.Store.Transcript(chatID))
	for i, r := range rows {
		if r.message != nil && r.message.ID == id {
			v.list.ScrollTo(i, ui.Center)
			v.list.FollowEnd = false
			return
		}
	}
}

func (v *View) searchBar(c *ui.Context, p Props, ch tg.Chat) {
	t, sr := p.Tokens, &v.search
	ui.Row(c).Padding(6, 12).Gap(8).AlignItems(ui.Center).Background(t.Card).BorderWidth(0, 0, 1, 0).BorderColor(t.Hairline).Children(func() {
		input := kit.SearchBox(c, t, &sr.query, copy.T(copy.SearchInChat))
		input.Bind(&sr.handle)
		if input.Shortcut(0, ui.KeyEscape) {
			sr.open = false
		}
		if input.Submitted() || input.Changed() && len(sr.query) > 1 {
			v.runSearch(p, ch.ID)
		}
		if sr.total > 0 {
			ui.Text(c, copy.F(copy.MediaOf, sr.index+1, sr.total)).FontSize(theme.Callout).TextColor(t.Muted).FontFeatures("tnum")
		} else if sr.asked != "" && !sr.loading {
			ui.Text(c, copy.T(copy.NoSearchResults)).FontSize(theme.Callout).TextColor(t.Muted)
		}
		kit.IconButton(c.Key("up"), t, icons.CaretUp, copy.T(copy.PreviousMedia)).Disabled(sr.index+1 >= len(sr.hits)).OnClick(func() {
			sr.index++
			v.jump(p, ch.ID, sr.hits[sr.index])
		})
		kit.IconButton(c.Key("down"), t, icons.CaretDown, copy.T(copy.NextMedia)).Disabled(sr.index == 0).OnClick(func() {
			sr.index--
			v.jump(p, ch.ID, sr.hits[sr.index])
		})
		kit.IconButton(c.Key("close"), t, icons.X, copy.T(copy.Close)).OnClick(func() { sr.open = false })
	})
}

func (v *View) runSearch(p Props, chatID tg.ChatID) {
	sr := &v.search
	query := strings.TrimSpace(sr.query)
	if query == "" || query == sr.asked {
		return
	}
	sr.asked, sr.loading = query, true
	repo := p.Runtime.Repo()
	if repo == nil {
		return
	}
	p.Runtime.Go(func(ctx context.Context) func() {
		page, err := repo.SearchChat(ctx, chatID, query, 0, 50)
		return func() {
			sr.loading = false
			if err != nil || sr.asked != query {
				return
			}
			sr.hits, sr.total, sr.index = page.MessageIDs, page.TotalCount, 0
			if len(sr.hits) > 0 {
				v.jump(p, chatID, sr.hits[0])
			}
		}
	})
}

func (v *View) jumpButton(c *ui.Context, p Props, ch tg.Chat) {
	t := p.Tokens
	if v.list.AtEnd() {
		return
	}
	b := ui.ButtonBase(c.Key("jump")).Size(40, 40).Radius(20).Background(t.Card).Border(1, t.CardBorder).Justify(ui.Center).AlignItems(ui.Center).
		Label(copy.T(copy.JumpToLatest)).Attach(ui.AnchorBottomRight, ui.AnchorBottomRight).Right(18).Bottom(14).
		Transition(ui.ElementTransition{Animation: &theme.Pop, Enter: &ui.Motion{Scale: 0.8, Opacity: 0}, Exit: &ui.Motion{Scale: 0.8, Opacity: 0}})
	kit.Raise(b, t, kit.Lifted)
	b.Children(func() {
		ui.Icon(c, icons.CaretDown).FontSize(18).TextColor(t.Muted)
		if ch.UnreadCount > 0 {
			kit.Badge(c, t, copy.Count(ch.UnreadCount), ch.Muted).Attach(ui.AnchorTopRight, ui.AnchorCenter).Top(4).Right(4)
		}
	})
	b.OnClick(func() {
		v.list.ScrollToEnd()
		v.list.FollowEnd = true
	})
}

func (v *View) selectionBar(c *ui.Context, p Props, ch tg.Chat, ids []tg.MessageID) {
	t, s := p.Tokens, p.Store
	ui.Row(c).Height(56).Padding(0, 16).Gap(8).AlignItems(ui.Center).Background(t.Card).BorderWidth(1, 0, 0, 0).BorderColor(t.Hairline).Children(func() {
		kit.IconButton(c.Key("clear"), t, icons.X, copy.T(copy.ClearSelection)).OnClick(func() { s.Composer(ch.ID).Selected = map[tg.MessageID]bool{} })
		ui.Text(c, copy.F(copy.SelectedCount, len(ids))).FontSize(theme.Body).FontWeight(600).Grow(1)
		if ch.Kind != tg.ChatSecret {
			kit.SizedButton(c.Key("forward"), t, kit.Outline, kit.SizeDefault, icons.ArrowBendUpRight, copy.T(copy.Forward), true).OnClick(func() {
				v.actions.OpenForward(ch.ID, slices.Clone(ids))
			})
		}
		kit.SizedButton(c.Key("delete"), t, kit.Destructive, kit.SizeDefault, icons.Trash, copy.T(copy.Delete), true).OnClick(func() {
			v.actions.OpenDelete(v.actionEnv(p), ch.ID, slices.Clone(ids))
		})
	})
}
