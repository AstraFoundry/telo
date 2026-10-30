// Package workspace is the main page: the chat list column, the center
// column (the conversation, or a page the app puts there, as Settings),
// and the right panel (the chat's profile or the agent). It composes the
// widgets and owns the column widths and which right panel shows.
package workspace

import (
	"context"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/features/search"
	"github.com/AstraFoundry/telo/frontend/shared/config"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/lib/timefmt"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/AstraFoundry/telo/frontend/widgets/chatlist"
	"github.com/AstraFoundry/telo/frontend/widgets/conversation"
	"github.com/egoist/mygo/ui"
)

// Panel is what the right column shows.
type Panel int

const (
	PanelNone Panel = iota
	PanelInfo
	PanelAgent
)

// Env is what the page needs from the app.
type Env struct {
	Tokens  theme.Tokens
	Runtime *runtime.Runtime
	Store   *chat.Store
	Images  *media.Images
	Formats timefmt.Formats
	Prefs   preferences.Preferences
	Mac     bool
	// AccountMenu fills the account button's menu.
	AccountMenu func(m *ui.Menu)
	// ComposeMenu fills the new-chat button's menu.
	ComposeMenu func(m *ui.Menu)
	// Center replaces the conversation, as Settings does; nil shows it.
	Center func(c *ui.Context)
	// Profile draws the chat's profile panel.
	Profile func(c *ui.Context, chat tg.ChatID)
	// Agent draws the agent panel.
	Agent func(c *ui.Context)
	// OpenLink opens a link from a message.
	OpenLink func(link string)
	// OpenMedia shows a photo in the viewer.
	OpenMedia func(m tg.Message)
	// Summarize hands a message to the agent.
	Summarize func(m tg.Message)
	// Opened runs after a chat was picked, as the app leaves Settings.
	Opened func()
	// Dialogs draws the dialogs the menus open.
	Dialogs func(c *ui.Context)
	// Modal tells that a view over the page (the media viewer) has the
	// keyboard, so the page's shortcuts wait.
	Modal bool
}

// Page keeps the page's state.
type Page struct {
	Sidebar      chatlist.Column
	Conversation conversation.View
	Search       search.Search
	Panel        Panel
	drag         float32
}

// SetAgentOpen opens or closes the agent panel.
func (p *Page) SetAgentOpen(open bool) {
	if open {
		p.Panel = PanelAgent
	} else if p.Panel == PanelAgent {
		p.Panel = PanelNone
	}
}

// Open selects a chat and, when message is given, scrolls to it.
func (p *Page) Open(env Env, id tg.ChatID, message tg.MessageID) {
	env.Store.Select(id)
	if message != 0 {
		env.Store.JumpTo(id, message, nil)
	}
	if p.Panel == PanelInfo && id == 0 {
		p.Panel = PanelNone
	}
	if env.Opened != nil {
		env.Opened()
	}
}

// Render draws the page.
func (p *Page) Render(c *ui.Context, env Env) {
	t, s := env.Tokens, env.Store
	bar := c.TitleBar()
	width := env.Prefs.SidebarWidth
	if p.drag != 0 {
		width = p.drag
	}
	ui.Row(c).Fill().AlignItems(ui.Stretch).Background(t.Canvas).Children(func() {
		ui.Column(c).Width(width).Shrink(0).BorderWidth(0, 1, 0, 0).BorderColor(t.Hairline).Children(func() {
			p.Sidebar.Render(c, chatlist.Props{
				Tokens: t, Store: s, Images: env.Images, Formats: env.Formats, Prefs: env.Prefs,
				Header: func(c *ui.Context) { p.header(c, env, bar) },
				Search: func(c *ui.Context) bool {
					se := search.Env{Tokens: t, Store: s, Runtime: env.Runtime, Images: env.Images, Formats: env.Formats, Prefs: env.Prefs,
						Open: func(id tg.ChatID, m tg.MessageID) { p.Open(env, id, m) }}
					p.Search.Field(c, se)
					if p.Search.Active() {
						p.Search.Results(c, se)
						return true
					}
					return false
				},
				Open: func(id tg.ChatID) { p.Open(env, id, 0) },
			})
		})
		p.divider(c, env, width)
		ui.Column(c).Grow(1).Shrink(1).MinWidth(360).Children(func() {
			if env.Center != nil {
				env.Center(c)
				return
			}
			p.Conversation.Render(c, conversation.Props{
				Tokens: t, Store: s, Runtime: env.Runtime, Images: env.Images, Formats: env.Formats, Prefs: env.Prefs, Mac: env.Mac,
				TitleBar: bar, InfoOpen: p.Panel == PanelInfo, ToggleInfo: p.toggleInfo,
				Step: func(step int) {
					if id, ok := s.Neighbor(step); ok {
						p.Open(env, id, 0)
					}
				},
				OpenLink: env.OpenLink, OpenMedia: env.OpenMedia, Summarize: env.Summarize, Language: "en",
			})
		})
		switch {
		case p.Panel == PanelInfo && s.Selected != 0 && env.Profile != nil && env.Center == nil:
			p.side(c, env, func() { env.Profile(c, s.Selected) })
		case p.Panel == PanelAgent && env.Agent != nil:
			p.side(c, env, func() { env.Agent(c) })
		}
	})
	if env.Dialogs != nil {
		env.Dialogs(c)
	}
	if !env.Modal {
		p.shortcuts(c, env)
	}
}

func (p *Page) toggleInfo() {
	if p.Panel == PanelInfo {
		p.Panel = PanelNone
	} else {
		p.Panel = PanelInfo
	}
}

func (p *Page) side(c *ui.Context, env Env, body func()) {
	t := env.Tokens
	ui.Column(c.Key(p.Panel)).Width(env.Prefs.AgentPanelWidth).Shrink(0).Background(t.Card).BorderWidth(0, 0, 0, 1).BorderColor(t.Hairline).
		Transition(t.Transition(theme.Settle, &ui.Motion{X: 24, Opacity: 0}, &ui.Motion{X: 16, Opacity: 0})).
		Children(body)
}

// divider is the draggable edge between the chat list and the center.
func (p *Page) divider(c *ui.Context, env Env, width float32) {
	handle := ui.Box(c.Key("divider")).Width(5).Margin(0, -3, 0, -2).Cursor(ui.CursorResizeColumn).Label(copy.T(copy.Chats))
	if dx, _, ok := handle.Dragged(); ok && dx != 0 {
		p.drag = min(preferences.SidebarWidthMax, max(preferences.SidebarWidthMin, width+dx))
	}
	if !handle.Pressed() && p.drag != 0 {
		final := p.drag
		p.drag = 0
		prefs := env.Runtime.Preferences
		env.Runtime.Go(func(ctx context.Context) func() {
			_, _ = prefs.Update(ctx, func(pr *preferences.Preferences) { pr.SidebarWidth = final })
			return nil
		})
	}
}

func (p *Page) header(c *ui.Context, env Env, bar ui.TitleBar) {
	t, s := env.Tokens, env.Store
	top := max(bar.Height, 28)
	ui.Row(c).Height(top+18).Padding(top-24, 10, 0, max(bar.Left+6, 10)).Gap(6).AlignItems(ui.Center).DragWindow().Children(func() {
		account := ui.ButtonBase(c.Key("account")).Size(30, 30).Radius(15).Label(copy.T(copy.OpenAccountMenu)).Tooltip(copy.T(copy.OpenAccountMenu))
		account.Children(func() { kit.Avatar(c, t, env.Images, s.User.Avatar, s.User.DisplayName, 30, false) })
		if env.AccountMenu != nil {
			account.PopoverMenuButton(env.AccountMenu)
		}
		ui.Text(c, title(s)).FontSize(theme.Heading).FontWeight(700).Grow(1).SingleLine()
		compose := kit.IconButton(c.Key("compose"), t, icons.PencilSimple, copy.T(copy.NewMessage))
		if env.ComposeMenu != nil {
			compose.PopoverMenuButton(env.ComposeMenu)
		}
	})
}

func title(s *chat.Store) string {
	if s.Tab == chat.TabArchive {
		return copy.T(copy.ArchivedChats)
	}
	return copy.T(copy.Chats)
}

// shortcuts handles the page's keyboard shortcuts.
func (p *Page) shortcuts(c *ui.Context, env Env) {
	s := env.Store
	if config.Pressed(c, config.ActQuickSearch) || config.Pressed(c, config.ActGlobalSearch) {
		p.Search.Focus()
	}
	if config.Pressed(c, config.ActSearchChat) && s.Selected != 0 {
		p.Conversation.OpenSearch()
	}
	if config.Pressed(c, config.ActNextChat) {
		if id, ok := s.Neighbor(1); ok {
			p.Open(env, id, 0)
		}
	}
	if config.Pressed(c, config.ActPrevChat) {
		if id, ok := s.Neighbor(-1); ok {
			p.Open(env, id, 0)
		}
	}
	// → opens the info, as upstream, unless it moves a caret through text.
	if s.Selected != 0 && s.Composer(s.Selected).Text == "" && config.Pressed(c, config.ActOpenInfo) {
		p.Panel = PanelInfo
	}
	if s.Selected != 0 && config.Pressed(c, config.ActReplyPrev) {
		s.ReplyStep(s.Selected, -1)
	}
	if s.Selected != 0 && config.Pressed(c, config.ActReplyNext) {
		s.ReplyStep(s.Selected, 1)
	}
	if c.Shortcut(0, ui.KeyEscape) && s.Selected != 0 && !p.Conversation.Composer.Input.FocusWithin(c) {
		if len(s.Composer(s.Selected).Selected) > 0 {
			s.Composer(s.Selected).Selected = map[tg.MessageID]bool{}
		} else if p.Panel != PanelNone {
			p.Panel = PanelNone
		}
	}
}
