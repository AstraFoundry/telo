// Package search is the chat list's search: chats by title as you type,
// messages across chats from Telegram, and the recent searches kept on
// this device.
package search

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/lib/timefmt"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Env is what search reaches.
type Env struct {
	Tokens  theme.Tokens
	Store   *chat.Store
	Runtime *runtime.Runtime
	Images  *media.Images
	Formats timefmt.Formats
	Prefs   preferences.Preferences
	// Open selects a chat, and scrolls to a message when one is given.
	Open func(chat tg.ChatID, message tg.MessageID)
}

// Search keeps the query and the server results.
type Search struct {
	Query   string
	Handle  ui.Handle
	focused bool
	asked   string
	result  tg.GlobalSearchResult
	loading bool
	typedAt time.Time
}

// Focus puts the keyboard in the search field (⌘K, ⇧⌘F).
func (s *Search) Focus() { s.Handle.Focus() }

// Active tells whether results show in place of the chat list.
func (s *Search) Active() bool { return s.focused || strings.TrimSpace(s.Query) != "" }

// Field draws the search field.
func (s *Search) Field(c *ui.Context, env Env) {
	t := env.Tokens
	ui.Row(c).Padding(0, 10, 8, 10).Children(func() {
		input := kit.SearchBox(c, t, &s.Query, copy.T(copy.SearchChats)).Bind(&s.Handle)
		s.focused = input.FocusWithin() || s.Handle.FocusWithin(c)
		if input.Shortcut(0, ui.KeyEscape) {
			s.Query = ""
			s.focused = false
		}
		if input.Changed() {
			s.typedAt = env.Runtime.Clock()
		}
		if input.Submitted() {
			s.ask(env)
		}
	})
	// Telegram searches messages once typing pauses.
	if q := strings.TrimSpace(s.Query); q != "" && q != s.asked {
		if wait := 350*time.Millisecond - env.Runtime.Clock().Sub(s.typedAt); wait > 0 {
			c.After(wait)
		} else {
			s.ask(env)
		}
	}
}

func (s *Search) ask(env Env) {
	q := strings.TrimSpace(s.Query)
	if q == "" || q == s.asked {
		return
	}
	s.asked, s.loading = q, true
	repo := env.Runtime.Repo()
	if repo == nil {
		return
	}
	env.Runtime.Go(func(ctx context.Context) func() {
		res, err := repo.SearchGlobal(ctx, q)
		return func() {
			if s.asked != q {
				return
			}
			s.loading = false
			if err != nil {
				env.Store.Notify(err.Error(), true)
				return
			}
			s.result = res
		}
	})
}

// Results draws what the query finds, or the recent searches.
func (s *Search) Results(c *ui.Context, env Env) {
	t, st := env.Tokens, env.Store
	q := strings.ToLower(strings.TrimSpace(s.Query))
	ui.Scroll(c).Grow(1).Children(func() {
		ui.Column(c).Padding(0, 6, 8, 6).Gap(1).Children(func() {
			if q == "" {
				s.recent(c, env)
				return
			}
			var chats []tg.Chat
			for _, ch := range st.All() {
				name := ch.Title
				if ch.Kind == tg.ChatSaved {
					name = copy.T(copy.SavedMessages)
				}
				if strings.Contains(strings.ToLower(name), q) {
					chats = append(chats, ch)
				}
			}
			for _, ch := range s.result.Chats {
				if !slices.ContainsFunc(chats, func(x tg.Chat) bool { return x.ID == ch.ID }) {
					chats = append(chats, ch)
				}
			}
			if len(chats) > 0 {
				kit.SectionTitle(c, t, copy.T(copy.SearchSectionChats)).Margin(6, 8)
				for _, ch := range chats {
					s.chatRow(c, env, ch)
				}
			}
			if len(s.result.Messages) > 0 && s.asked == strings.TrimSpace(s.Query) {
				kit.SectionTitle(c, t, copy.T(copy.SearchSectionMessages)).Margin(10, 8, 6, 8)
				for _, m := range s.result.Messages {
					s.messageRow(c, env, m)
				}
			}
			if len(chats) == 0 && len(s.result.Messages) == 0 && !s.loading {
				kit.Empty(c, t, icons.MagnifyingGlass, copy.T(copy.NoSearchResults))
			}
		})
	})
}

func (s *Search) remember(env Env, id tg.ChatID) {
	if env.Runtime.Preferences == nil {
		return
	}
	prefs := env.Runtime.Preferences
	env.Runtime.Go(func(ctx context.Context) func() {
		_, _ = prefs.Update(ctx, func(p *preferences.Preferences) {
			p.RecentSearches = preferences.PushRecent(p.RecentSearches, int64(id), preferences.RecentSearchesMax)
		})
		return nil
	})
}

func (s *Search) chatRow(c *ui.Context, env Env, ch tg.Chat) {
	t := env.Tokens
	name := ch.Title
	if ch.Kind == tg.ChatSaved {
		name = copy.T(copy.SavedMessages)
	}
	row := ui.ButtonBase(c.Key(ch.ID)).Height(50).Padding(0, 8).Gap(10).Radius(theme.RadiusLG).AlignItems(ui.Center).Label(name)
	if row.Hovered() {
		row.Background(t.Subtle)
	}
	row.Children(func() {
		kit.Avatar(c, t, env.Images, ch.Avatar, ch.Title, 36, ch.Kind == tg.ChatSaved)
		if ch.Kind == tg.ChatSecret {
			ui.Icon(c, icons.LockSimple).FontSize(13).TextColor(t.Success)
		}
		ui.Text(c, name).FontSize(theme.Body).FontWeight(600).Grow(1).SingleLine()
	})
	id := ch.ID
	row.OnClick(func() {
		s.remember(env, id)
		s.Query, s.focused = "", false
		env.Open(id, 0)
	})
}

func (s *Search) messageRow(c *ui.Context, env Env, m tg.Message) {
	t, st := env.Tokens, env.Store
	ch, _ := st.Chat(m.ChatID)
	row := ui.ButtonBase(c.Key([2]int64{int64(m.ChatID), int64(m.ID)})).Padding(6, 8).Gap(10).Radius(theme.RadiusLG).AlignItems(ui.Center).Label(m.Body)
	if row.Hovered() {
		row.Background(t.Subtle)
	}
	row.Children(func() {
		kit.Avatar(c, t, env.Images, ch.Avatar, ch.Title, 36, ch.Kind == tg.ChatSaved)
		ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
			ui.Row(c).Gap(6).Children(func() {
				name := ch.Title
				if ch.Kind == tg.ChatSaved {
					name = copy.T(copy.SavedMessages)
				}
				ui.Text(c, name).FontSize(theme.Body).FontWeight(600).Grow(1).SingleLine()
				ui.Text(c, env.Formats.ListTime(m.SentAt, env.Runtime.Clock())).FontSize(theme.Caption).TextColor(t.Muted)
			})
			ui.Text(c, strings.Join(strings.Fields(m.Body), " ")).FontSize(theme.Callout).TextColor(t.Muted).SingleLine()
		})
	})
	chatID, id := m.ChatID, m.ID
	row.OnClick(func() {
		s.Query, s.focused = "", false
		env.Open(chatID, id)
	})
}

func (s *Search) recent(c *ui.Context, env Env) {
	t, st := env.Tokens, env.Store
	ids := env.Prefs.RecentSearches
	if len(ids) == 0 {
		kit.Empty(c, t, icons.ClockCounterClockwise, copy.T(copy.NoRecentSearches))
		return
	}
	ui.Row(c).Padding(6, 8).AlignItems(ui.Center).Children(func() {
		kit.SectionTitle(c, t, copy.T(copy.RecentSearches)).Grow(1)
		kit.SizedButton(c.Key("clear"), t, kit.Ghost, kit.SizeSmall, nil, copy.T(copy.ClearSearchHistory), true).OnClick(func() {
			prefs := env.Runtime.Preferences
			env.Runtime.Go(func(ctx context.Context) func() {
				_, _ = prefs.Update(ctx, func(p *preferences.Preferences) { p.RecentSearches = nil })
				return nil
			})
		})
	})
	for _, id := range ids {
		if ch, ok := st.Chat(tg.ChatID(id)); ok {
			s.chatRow(c, env, ch)
		}
	}
}
