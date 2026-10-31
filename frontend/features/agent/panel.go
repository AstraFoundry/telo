// Package agent is the agent beside the conversations: the panel that
// asks it about the workspace, with the payload it may read, and the
// pane that configures it and its automation.
package agent

import (
	"context"
	"errors"
	"strings"

	agentapp "github.com/AstraFoundry/telo/backend/application/agent"
	domain "github.com/AstraFoundry/telo/backend/domain/agent"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Env is what the agent reaches.
type Env struct {
	Tokens  theme.Tokens
	Runtime *runtime.Runtime
	Store   *chat.Store
	// OpenMessage jumps to a cited message.
	OpenMessage func(chat tg.ChatID, message tg.MessageID)
	// OpenSettings opens the agent pane of Settings.
	OpenSettings func()
	// OpenLink opens any other link of an answer.
	OpenLink func(link string)
}

// Panel keeps the conversation shown in the side panel.
type Panel struct {
	thread      domain.Thread
	threads     []domain.ThreadSummary
	loaded      bool
	prompt      string
	input       ui.Handle
	scope       domain.Scope
	running     bool
	cancel      context.CancelFunc
	streamed    strings.Builder
	activity    string
	failure     error
	suggestions []string
	configured  bool
	list        ui.ListState
}

// ErrorText words a run's outcome.
func ErrorText(err error) string {
	switch {
	case errors.Is(err, domain.ErrNoCredential):
		return copy.T(copy.AgentNotConfiguredBody)
	case errors.Is(err, domain.ErrRejected):
		return copy.T(copy.AgentErrRejected)
	case errors.Is(err, domain.ErrUnreachable):
		return copy.T(copy.AgentErrUnreachable)
	case errors.Is(err, domain.ErrOAuthFailed), errors.Is(err, domain.ErrOAuthUnavailable):
		return copy.T(copy.AgentErrOAuth)
	}
	return copy.T(copy.AgentFailed)
}

// storedError words a failed turn the thread kept.
func storedError(body string) string {
	for _, e := range []error{domain.ErrNoCredential, domain.ErrRejected, domain.ErrUnreachable, domain.ErrRequestFailed} {
		if body == e.Error() {
			return ErrorText(e)
		}
	}
	return copy.T(copy.AgentFailed)
}

func (p *Panel) refresh(env Env) {
	svc := env.Runtime.Agent
	env.Runtime.Go(func(ctx context.Context) func() {
		threads, active, err := svc.Threads(ctx)
		cfg, cerr := svc.Configuration(ctx)
		var t domain.Thread
		if active != "" {
			t, _, _ = svc.Thread(ctx, active)
		}
		return func() {
			if err != nil {
				env.Store.Notify(err.Error(), true)
				return
			}
			p.threads = threads
			if p.thread.ID == "" || p.thread.ID == t.ID {
				p.thread = t
			}
			p.configured = cerr == nil && cfg.HasCredential()
		}
	})
}

// Reload rereads the threads and the configuration.
func (p *Panel) Reload() { p.loaded = false }

// Summarize asks for a summary of a chat's unread messages.
func (p *Panel) Summarize(env Env, ch tg.Chat) {
	p.start(env, func(ctx context.Context, svc *agentapp.Service, thread string, emit func(domain.Output)) error {
		return svc.Summarize(ctx, thread, ch, copy.T(copy.AgentSummarizeUnread), emit)
	})
}

// Extract asks for a chat's decisions, questions and action items.
func (p *Panel) Extract(env Env, ch tg.Chat) {
	p.start(env, func(ctx context.Context, svc *agentapp.Service, thread string, emit func(domain.Output)) error {
		return svc.Extract(ctx, thread, ch, copy.T(copy.AgentExtract), emit)
	})
}

// Attach asks about selected messages.
func (p *Panel) Attach(env Env, ch tg.ChatID, ids []tg.MessageID, prompt string) {
	p.start(env, func(ctx context.Context, svc *agentapp.Service, thread string, emit func(domain.Output)) error {
		return svc.Run(ctx, agentapp.RunInput{Thread: thread, Prompt: prompt, Scope: &agentapp.ScopeInput{Scope: domain.ScopeSelected, Chat: ch, Messages: ids}}, emit)
	})
}

// snapshot is what the panel shows the agent of the workspace.
func snapshot(s *chat.Store) domain.Snapshot {
	var snap domain.Snapshot
	for _, ch := range s.Visible() {
		snap.VisibleChats = append(snap.VisibleChats, domain.SnapshotChat{ID: int64(ch.ID), Title: ch.Title, Kind: string(ch.Kind), Unread: ch.UnreadCount})
		if ch.ID == s.Selected {
			c := domain.SnapshotChat{ID: int64(ch.ID), Title: ch.Title, Kind: string(ch.Kind), Unread: ch.UnreadCount}
			snap.ActiveChat = &c
		}
	}
	if s.Selected != 0 {
		ms := s.Transcript(s.Selected).Messages
		for _, m := range ms[max(0, len(ms)-30):] {
			body, _ := domain.Redact(m.Body)
			sender, _ := domain.Redact(m.SenderName)
			snap.VisibleMessages = append(snap.VisibleMessages, domain.SnapshotMessage{Sender: sender, Body: body, SentAt: m.SentAt, Outgoing: m.Outgoing})
		}
	}
	return snap
}

type run func(ctx context.Context, svc *agentapp.Service, thread string, emit func(domain.Output)) error

// start streams a run into the panel; Stop cancels it.
func (p *Panel) start(env Env, r run) {
	if p.running {
		return
	}
	svc := env.Runtime.Agent
	thread := p.thread.ID
	if thread == "" {
		thread = agentapp.NewID()
		p.thread = domain.Thread{ID: thread}
	}
	ctx, cancel := context.WithCancel(context.Background())
	p.running, p.cancel, p.activity, p.failure, p.suggestions = true, cancel, copy.T(copy.AgentThinking), nil, nil
	p.streamed.Reset()
	rt := env.Runtime
	rt.Go(func(context.Context) func() {
		err := r(ctx, svc, thread, func(o domain.Output) {
			rt.Post(func() {
				switch o.Kind {
				case domain.OutputText:
					p.streamed.WriteString(o.Text)
				case domain.OutputActivity:
					p.activity = copy.F(copy.AgentUsing, o.Text)
				case domain.OutputError:
					p.failure = o.Err
				}
			})
		})
		t, _, _ := svc.Thread(context.Background(), thread)
		suggestions := svc.Suggest(context.Background(), thread)
		return func() {
			cancel()
			p.running, p.cancel = false, nil
			if err != nil && p.failure == nil && !errors.Is(err, context.Canceled) {
				p.failure = err
			}
			p.thread, p.suggestions = t, suggestions
			p.streamed.Reset()
			p.loaded = false
		}
	})
}

func (p *Panel) send(env Env) {
	prompt := strings.TrimSpace(p.prompt)
	if prompt == "" {
		return
	}
	p.prompt = ""
	snap := snapshot(env.Store)
	var scope *agentapp.ScopeInput
	s := env.Store
	switch p.scope {
	case domain.ScopeUnread:
		if s.Selected != 0 {
			scope = &agentapp.ScopeInput{Scope: domain.ScopeUnread, Chat: s.Selected}
		}
	case domain.ScopeFolder:
		scope = &agentapp.ScopeInput{Scope: domain.ScopeFolder, Folder: max(0, s.Tab)}
	case domain.ScopeSelected:
		if ids := s.SelectedIDs(s.Selected); len(ids) > 0 {
			scope = &agentapp.ScopeInput{Scope: domain.ScopeSelected, Chat: s.Selected, Messages: ids}
		}
	}
	p.start(env, func(ctx context.Context, svc *agentapp.Service, thread string, emit func(domain.Output)) error {
		return svc.Run(ctx, agentapp.RunInput{Thread: thread, Prompt: prompt, Scope: scope, Snapshot: snap}, emit)
	})
}

func (p *Panel) onLink(env Env) func(string) {
	return func(link string) {
		if c, m, ok := domain.ParseMessageLink(link); ok {
			env.OpenMessage(tg.ChatID(c), tg.MessageID(m))
			return
		}
		env.OpenLink(link)
	}
}

// Render draws the panel.
func (p *Panel) Render(c *ui.Context, env Env, close func()) {
	t := env.Tokens
	if !p.loaded && env.Runtime.Agent != nil {
		p.loaded = true
		p.refresh(env)
	}
	bar := c.TitleBar()
	ui.Column(c).Fill().Children(func() {
		ui.Row(c).Height(max(bar.Height, 28)+18).Padding(max(bar.Height, 28)-24, 10, 0, 14).Gap(4).AlignItems(ui.Center).DragWindow().Children(func() {
			ui.Icon(c, icons.Sparkle).FontSize(16).TextColor(t.AccentInk)
			ui.Text(c, copy.T(copy.Agent)).FontSize(theme.Heading).FontWeight(700).Grow(1)
			history := kit.IconButton(c.Key("history"), t, icons.ClockCounterClockwise, copy.T(copy.AgentHistory))
			history.PopoverMenuButton(func(m *ui.Menu) {
				if len(p.threads) == 0 {
					m.Item(copy.T(copy.AgentNoHistory)).Disabled(true)
				}
				for _, th := range p.threads {
					title := th.Title
					if title == "" {
						title = copy.T(copy.AgentNewThread)
					}
					id := th.ID
					if m.Item(title).Checked(id == p.thread.ID).Chosen() {
						p.selectThread(env, id)
					}
				}
			})
			kit.IconButton(c.Key("new"), t, icons.Plus, copy.T(copy.AgentNewThread)).OnClick(func() {
				if !p.running {
					p.thread, p.suggestions, p.failure = domain.Thread{}, nil, nil
					p.input.Focus()
				}
			})
			kit.IconButton(c.Key("close"), t, icons.X, copy.T(copy.Close)).OnClick(close)
		})
		if !p.configured && len(p.thread.Messages) == 0 {
			p.notConfigured(c, env)
			return
		}
		p.transcript(c, env)
		p.composer(c, env)
	})
}

func (p *Panel) selectThread(env Env, id string) {
	svc := env.Runtime.Agent
	env.Runtime.Go(func(ctx context.Context) func() {
		t, err := svc.SelectThread(ctx, id)
		return func() {
			if err == nil {
				p.thread, p.suggestions, p.failure = t, nil, nil
			}
		}
	})
}

func (p *Panel) notConfigured(c *ui.Context, env Env) {
	t := env.Tokens
	ui.Column(c).Grow(1).Justify(ui.Center).AlignItems(ui.Center).Gap(10).Padding(24).Children(func() {
		ui.Icon(c, icons.PlugsConnected).FontSize(28).TextColor(t.Muted)
		ui.Text(c, copy.T(copy.AgentNotConfigured)).FontSize(theme.Heading).FontWeight(600)
		ui.Text(c, copy.T(copy.AgentNotConfiguredBody)).FontSize(theme.Callout).TextColor(t.Muted).TextAlign(ui.Center)
		kit.Button(c.Key("settings"), t, kit.Primary, copy.T(copy.AgentOpenSettings), true).OnClick(env.OpenSettings)
	})
}

func (p *Panel) transcript(c *ui.Context, env Env) {
	t := env.Tokens
	ms := p.thread.Messages
	rows := len(ms)
	if p.running {
		rows++
	}
	p.list.FollowEnd = true
	ui.List(c.Key("agent"), &p.list, rows, func(i int) {
		if i >= len(ms) {
			p.live(c, env)
			return
		}
		m := ms[i]
		if m.Role == domain.RoleUser {
			ui.Row(c.Key(m.ID)).Justify(ui.End).Padding(4, 0).Children(func() {
				ui.Box(c).Padding(8, 12).Radius(theme.RadiusBubble).Background(t.AccentSoft).MaxWidth(280).Children(func() {
					ui.Text(c, m.Body).FontSize(theme.Callout).Selectable()
				})
			})
			return
		}
		ui.Box(c.Key(m.ID)).Padding(4, 0).Children(func() {
			if m.Error {
				kit.Status(c, t, icons.WarningCircle, t.Danger, storedError(m.Body))
				return
			}
			markdown(c, t, m.Body, theme.Callout, p.onLink(env))
		})
	}).Grow(1).Padding(8, 14).Children(func() {
		if len(ms) == 0 && !p.running {
			ui.Column(c).Grow(1).Justify(ui.Center).AlignItems(ui.Center).Gap(12).Children(func() {
				ui.Text(c, copy.T(copy.AgentEmpty)).FontSize(theme.Callout).TextColor(t.Muted).TextAlign(ui.Center)
				p.quickActions(c, env)
			})
		}
	})
	if p.failure != nil && !p.running {
		ui.Box(c).Padding(0, 14, 6, 14).Children(func() { kit.Status(c, t, icons.WarningCircle, t.Danger, ErrorText(p.failure)) })
	}
	if len(p.suggestions) > 0 && !p.running {
		ui.Row(c).Padding(0, 14, 6, 14).Gap(6).Wrap().Children(func() {
			for i, s := range p.suggestions {
				text := s
				kit.SizedButton(c.Key(i), t, kit.Outline, kit.SizeSmall, nil, s, true).OnClick(func() {
					p.prompt = text
					p.send(env)
				})
			}
		})
	}
}

func (p *Panel) live(c *ui.Context, env Env) {
	t := env.Tokens
	ui.Column(c.Key("live")).Gap(6).Padding(4, 0).Children(func() {
		if p.streamed.Len() > 0 {
			markdown(c, t, p.streamed.String(), theme.Callout, p.onLink(env))
		}
		ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
			ui.Spinner(c).Size(12, 12)
			ui.Text(c, p.activity).FontSize(theme.Caption).TextColor(t.Muted)
		})
	})
}

func (p *Panel) quickActions(c *ui.Context, env Env) {
	t, s := env.Tokens, env.Store
	ch, ok := s.Chat(s.Selected)
	if !ok {
		return
	}
	ui.Row(c).Gap(6).Children(func() {
		kit.SizedButton(c.Key("summary"), t, kit.Outline, kit.SizeSmall, icons.Sparkle, copy.T(copy.AgentSummarizeUnread), ch.UnreadCount > 0).OnClick(func() { p.Summarize(env, ch) })
		kit.SizedButton(c.Key("extract"), t, kit.Outline, kit.SizeSmall, icons.List, copy.T(copy.AgentExtract), ch.UnreadCount > 0).OnClick(func() { p.Extract(env, ch) })
	})
}

func (p *Panel) composer(c *ui.Context, env Env) {
	t, s := env.Tokens, env.Store
	ui.Column(c).Padding(6, 12, 12, 12).Gap(6).Children(func() {
		scopes := []domain.Scope{"", domain.ScopeUnread, domain.ScopeFolder}
		if len(s.SelectedIDs(s.Selected)) > 0 {
			scopes = append(scopes, domain.ScopeSelected)
		}
		names := map[domain.Scope]copy.Key{"": copy.AgentScopeNone, domain.ScopeUnread: copy.AgentScopeUnread, domain.ScopeFolder: copy.AgentScopeFolder, domain.ScopeSelected: copy.AgentScopeSelected}
		ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
			ui.Text(c, copy.T(copy.AgentScope)).FontSize(theme.Caption).TextColor(t.Muted)
			kit.Select(c.Key("scope"), t, &p.scope, copy.T(copy.AgentScope), scopes, func(x domain.Scope) string { return copy.T(names[x]) })
		})
		box := ui.Row(c).Gap(6).Padding(5, 6).Radius(theme.RadiusXL+4).Background(t.Card).Border(1, t.CardBorder).AlignItems(ui.End)
		kit.Raise(box, t, kit.Raised).Children(func() {
			in := ui.TextAreaBase(c.Key("prompt"), &p.prompt).Lines(1, 6).Grow(1).Padding(6, 6).FontSize(theme.Callout).
				Placeholder(copy.T(copy.AgentAsk)).Label(copy.T(copy.AgentAsk)).FocusRing(false).Bind(&p.input)
			in.OnTextKey(func(k ui.TextKey) bool {
				if k.Key == ui.KeyEnter && k.Mods == 0 {
					env.Runtime.Post(func() { p.send(env) })
					return true
				}
				return false
			})
			if p.running {
				kit.IconButton(c.Key("stop"), t, icons.Stop, copy.T(copy.AgentStop)).OnClick(func() {
					if p.cancel != nil {
						p.cancel()
					}
				})
			} else {
				send := kit.IconButton(c.Key("send"), t, icons.PaperPlaneTilt, copy.T(copy.AgentSend))
				if strings.TrimSpace(p.prompt) != "" {
					send.TextColor(t.AccentInk)
				}
				send.OnClick(func() { p.send(env) })
			}
		})
	})
}
