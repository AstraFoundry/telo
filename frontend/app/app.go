// Package app is the root view: it routes between onboarding, the lock,
// Settings and the workspace, and owns what spans them: the theme, the
// global shortcuts, notifications, the badge, toasts, the media viewer and
// the agent's automation.
package app

import (
	"context"
	"time"

	agentapp "github.com/AstraFoundry/telo/backend/application/agent"
	apptg "github.com/AstraFoundry/telo/backend/application/telegram"
	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/features/accountmenu"
	"github.com/AstraFoundry/telo/frontend/features/agent"
	"github.com/AstraFoundry/telo/frontend/pages/lock"
	"github.com/AstraFoundry/telo/frontend/pages/onboarding"
	settingspage "github.com/AstraFoundry/telo/frontend/pages/settings"
	"github.com/AstraFoundry/telo/frontend/pages/workspace"
	"github.com/AstraFoundry/telo/frontend/shared/config"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/lib/timefmt"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/AstraFoundry/telo/frontend/widgets/mediaviewer"
	"github.com/AstraFoundry/telo/frontend/widgets/profile"
	panes "github.com/AstraFoundry/telo/frontend/widgets/settings"
	"github.com/egoist/mygo/ui"
)

// Options configure the root.
type Options struct {
	// Region is the country the phone field starts with.
	Region string
	// Mac tells the shortcuts to print in macOS glyphs.
	Mac bool
}

// App is the root view's state.
type App struct {
	rt     *runtime.Runtime
	opts   Options
	Store  *chat.Store
	Images *media.Images

	onboarding *onboarding.Page
	workspace  workspace.Page
	settings   settingspage.Page
	lock       lock.Page
	viewer     mediaviewer.Viewer
	profile    profile.Panel
	panel      agent.Panel
	agentPane  agent.Settings
	menu       accountmenu.State

	inSettings bool
	locked     bool
	adding     bool
	away       time.Time
	repo       tg.Repository
	automation *agentapp.Automation
	logoutOpen bool
}

// New builds the root over a runtime; call Start before the first frame.
func New(rt *runtime.Runtime, opts Options) *App {
	a := &App{rt: rt, opts: opts, Store: chat.New(rt), Images: media.NewImages(256, rt.Wake), onboarding: onboarding.New(opts.Region)}
	a.Store.OnMessage = a.notify
	a.Store.OnChatsChanged = a.badge
	// A passcode locks Telo at launch, as telegram-macos does.
	a.locked = rt.Preferences.Get().PasscodeHash != ""
	return a
}

// Start subscribes the store to the accounts.
func (a *App) Start() { a.Store.Start() }

// Close stops the store and automation.
func (a *App) Close() {
	if a.automation != nil {
		a.automation.Stop()
	}
	a.Store.Stop()
}

// Lock locks Telo when it has a passcode.
func (a *App) Lock() {
	if a.rt.Preferences.Get().PasscodeHash != "" {
		a.locked = true
	}
}

// OpenSettings shows Settings at a pane ("" for the profile).
func (a *App) OpenSettings(s panes.Section) {
	a.inSettings = true
	a.settings.Open(s)
}

// ToggleAgent opens or closes the agent panel.
func (a *App) ToggleAgent() {
	open := a.workspace.Panel != workspace.PanelAgent
	a.workspace.SetAgentOpen(open)
	a.inSettings = false
	update(a.rt, func(p *preferences.Preferences) { p.AgentPanelOpen = open })
}

func update(rt *runtime.Runtime, edit func(*preferences.Preferences)) {
	prefs := rt.Preferences
	rt.Go(func(ctx context.Context) func() {
		_, _ = prefs.Update(ctx, edit)
		return nil
	})
}

func placeholders() apptg.Placeholders {
	return apptg.Placeholders{AppName: copy.T(copy.AppName), NewMessage: copy.T(copy.NewMessageNotification),
		Media: func(k tg.MediaKind) string { return chat.MediaName(&tg.Media{Kind: k}) }}
}

func (a *App) notify(m tg.Message, edited bool) {
	ch, ok := a.Store.Chat(m.ChatID)
	if !ok {
		return
	}
	focused := a.rt.Desktop.Focused() && a.Store.Selected == m.ChatID && !a.locked
	if n, ok := apptg.Notify(m, edited, ch, focused, a.rt.Preferences.Get(), placeholders()); ok {
		a.rt.Desktop.Notify(n)
	}
}

func (a *App) badge() {
	a.rt.Desktop.SetBadge(apptg.UnreadBadge(a.Store.All(), a.rt.Preferences.Get().CountMuted))
}

// follow restarts what belongs to an account when the active one changes.
func (a *App) follow() {
	repo := a.rt.Repo()
	if repo == a.repo {
		return
	}
	if a.repo != nil {
		// Another account: the store reloads it, the panels start over.
		a.Store.Start()
		a.workspace, a.profile, a.panel = workspace.Page{}, profile.Panel{}, agent.Panel{}
		if a.rt.Preferences.Get().AgentPanelOpen {
			a.workspace.SetAgentOpen(true)
		}
	}
	a.repo = repo
	if a.automation != nil {
		a.automation.Stop()
		a.automation = nil
	}
	if repo != nil && a.rt.Agent != nil {
		store := a.Store
		rt := a.rt
		a.automation = a.rt.Agent.StartAutomation(repo, func(r agentapp.RunReport) {
			rt.Post(func() { store.Notify(report(r), r.Status == agentapp.RunFailed) })
		})
	}
}

func report(r agentapp.RunReport) string {
	status := map[agentapp.RunStatus]copy.Key{agentapp.RunSent: copy.AgentRunSent, agentapp.RunDraft: copy.AgentRunDraft,
		agentapp.RunConflict: copy.AgentRunConflict, agentapp.RunEmpty: copy.AgentRunEmpty, agentapp.RunFailed: copy.AgentRunFailed}[r.Status]
	return copy.F(copy.AgentRunReport, r.Name, copy.T(status))
}

// autoLock locks after the window was away for the chosen minutes.
func (a *App) autoLock(p preferences.Preferences) {
	if p.PasscodeHash == "" || p.AutoLockMinutes == 0 || a.locked {
		a.away = time.Time{}
		return
	}
	now := a.rt.Clock()
	if a.rt.Desktop.Focused() {
		a.away = time.Time{}
		return
	}
	if a.away.IsZero() {
		a.away = now
	}
	if now.Sub(a.away) >= time.Duration(p.AutoLockMinutes)*time.Minute {
		a.locked = true
	}
}

// View draws a frame.
func (a *App) View(c *ui.Context) {
	a.rt.Drain()
	prefs := a.rt.Preferences.Get()
	t := theme.Apply(c, prefs.Theme, prefs.Accent)
	formats := timefmt.Formats{Locale: c.Locale(), Hours: prefs.TimeFormat}
	a.follow()
	a.autoLock(prefs)
	for _, n := range a.Store.TakeNotices() {
		kind := ""
		if n.Error {
			kind = "error"
		}
		c.AddToast(ui.Toast{Title: n.Text, Type: kind})
	}
	auth := a.Store.Auth
	switch {
	case a.locked && prefs.PasscodeHash != "":
		a.lock.Render(c, t, prefs.PasscodeHash, func() { a.locked = false })
		return
	case auth.Step != tg.AuthReady || !prefs.OnboardingDone || a.adding:
		a.onboardingView(c, t, auth, prefs)
		return
	}
	a.shortcuts(c)
	if a.inSettings {
		a.settings.Render(c, a.settingsProps(t, formats, prefs), func() { a.inSettings = false })
	} else {
		a.workspace.Render(c, a.workspaceEnv(t, formats, prefs))
	}
	a.viewer.Render(c, t, a.rt, a.Store, a.Images)
	kit.Dialog(c, t, &a.logoutOpen, 380, copy.T(copy.LogOut), copy.T(copy.LogOutConfirm), nil, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { a.logoutOpen = false })
		kit.Button(c.Key("logout"), t, kit.Destructive, copy.T(copy.LogOut), true).OnClick(func() {
			a.logoutOpen, a.inSettings = false, false
			accounts := a.rt.Accounts
			store := a.Store
			a.rt.Go(func(ctx context.Context) func() {
				err := accounts.Logout(ctx)
				return func() {
					if err != nil {
						store.Notify(err.Error(), true)
					}
				}
			})
		})
	})
}

func (a *App) onboardingView(c *ui.Context, t theme.Tokens, auth tg.AuthState, prefs preferences.Preferences) {
	o := a.onboarding
	o.Adding = a.adding
	o.AgentForm = func(c *ui.Context, t theme.Tokens) bool {
		a.agentPane.Render(c, a.agentEnv(t))
		return true
	}
	o.ConnectAgent = func() { a.OpenSettings(panes.SectionAgent) }
	o.Render(c, a.rt, auth, func() {
		if a.adding {
			a.adding = false
			return
		}
		update(a.rt, func(p *preferences.Preferences) { p.OnboardingDone = true })
	})
	if a.adding && c.Shortcut(0, ui.KeyEscape) {
		a.cancelAdding()
	}
}

func (a *App) startAdding() {
	a.adding = true
	a.onboarding = onboarding.New(a.opts.Region)
	accounts, store := a.rt.Accounts, a.Store
	a.rt.Go(func(ctx context.Context) func() {
		err := accounts.StartSignIn(ctx)
		return func() {
			if err != nil {
				a.adding = false
				store.Notify(err.Error(), true)
			}
		}
	})
}

func (a *App) cancelAdding() {
	a.adding = false
	accounts := a.rt.Accounts
	a.rt.Go(func(ctx context.Context) func() {
		_ = accounts.CancelSignIn(ctx)
		return nil
	})
}

func (a *App) switchAccount(id tg.AccountID) {
	accounts, store := a.rt.Accounts, a.Store
	a.rt.Go(func(ctx context.Context) func() {
		err := accounts.Switch(ctx, id)
		return func() {
			if err != nil {
				store.Notify(err.Error(), true)
			}
		}
	})
}

// nextAccount is the account after the active one, for ⇧⌘M.
func (a *App) nextAccount() (tg.AccountID, bool) {
	reg := a.Store.Accounts
	for i, r := range reg.Accounts {
		if r.ID == reg.Active && len(reg.Accounts) > 1 {
			return reg.Accounts[(i+1)%len(reg.Accounts)].ID, true
		}
	}
	return "", false
}

func (a *App) shortcuts(c *ui.Context) {
	switch {
	case config.Pressed(c, config.ActSettings):
		if a.inSettings {
			a.inSettings = false
		} else {
			a.OpenSettings(a.settings.Section)
		}
	case config.Pressed(c, config.ActLock):
		a.Lock()
	case config.Pressed(c, config.ActToggleAgent):
		a.ToggleAgent()
	case config.Pressed(c, config.ActSwitchAccount):
		if id, ok := a.nextAccount(); ok {
			a.switchAccount(id)
		}
	}
}

func (a *App) menuEnv(t theme.Tokens, formats timefmt.Formats) accountmenu.Env {
	return accountmenu.Env{Tokens: t, Runtime: a.rt, Store: a.Store, Images: a.Images, Formats: formats,
		OpenSettings: func(profile bool) {
			if profile {
				a.OpenSettings(panes.SectionProfile)
				return
			}
			a.OpenSettings(a.settings.Section)
		},
		AddAccount: a.startAdding, LogOut: func() { a.logoutOpen = true }, SwitchTo: a.switchAccount}
}

func (a *App) agentEnv(t theme.Tokens) agent.Env {
	return agent.Env{Tokens: t, Runtime: a.rt, Store: a.Store,
		OpenMessage: func(ch tg.ChatID, m tg.MessageID) {
			a.inSettings = false
			a.workspace.Open(workspace.Env{Store: a.Store}, ch, m)
		},
		OpenSettings: func() { a.OpenSettings(panes.SectionAgent) },
		OpenLink:     func(link string) { _ = a.rt.Desktop.OpenURL(link) }}
}

func (a *App) workspaceEnv(t theme.Tokens, formats timefmt.Formats, prefs preferences.Preferences) workspace.Env {
	menu := a.menuEnv(t, formats)
	agentEnv := a.agentEnv(t)
	return workspace.Env{
		Tokens: t, Runtime: a.rt, Store: a.Store, Images: a.Images, Formats: formats, Prefs: prefs, Mac: a.opts.Mac,
		AccountMenu: func(m *ui.Menu) { a.menu.AccountMenu(m, menu) },
		ComposeMenu: func(m *ui.Menu) { a.menu.ComposeMenu(m, menu) },
		Profile: func(c *ui.Context, id tg.ChatID) {
			a.profile.Render(c, profile.Props{Tokens: t, Runtime: a.rt, Store: a.Store, Images: a.Images, Formats: formats,
				OpenMedia: func(m tg.Message) { a.viewer.Open(a.Store, m) }, Close: func() { a.workspace.Panel = workspace.PanelNone }}, id)
		},
		Agent:     func(c *ui.Context) { a.panel.Render(c, agentEnv, func() { a.ToggleAgent() }) },
		OpenLink:  func(link string) { a.openLink(link) },
		OpenMedia: func(m tg.Message) { a.viewer.Open(a.Store, m) },
		Summarize: func(m tg.Message) {
			a.workspace.SetAgentOpen(true)
			a.panel.Attach(agentEnv, m.ChatID, []tg.MessageID{m.ID}, copy.T(copy.AgentSummarizeUnread))
		},
		Dialogs: func(c *ui.Context) { a.menu.Dialogs(c, menu) },
	}
}

// openLink opens Telegram links inside Telo and the rest in the browser.
func (a *App) openLink(link string) {
	repo := a.rt.Repo()
	if repo == nil || !(isTelegramLink(link)) {
		_ = a.rt.Desktop.OpenURL(link)
		return
	}
	store := a.Store
	a.rt.Go(func(ctx context.Context) func() {
		ch, msg, err := repo.ResolveLink(ctx, link)
		return func() {
			if err != nil {
				_ = a.rt.Desktop.OpenURL(link)
				return
			}
			store.Adopt(ch)
			if msg != 0 {
				store.JumpTo(ch.ID, msg, nil)
			}
		}
	})
}

func isTelegramLink(link string) bool {
	for _, p := range []string{"tg://", "https://t.me/", "http://t.me/", "https://telegram.me/", "@"} {
		if len(link) >= len(p) && link[:len(p)] == p {
			return true
		}
	}
	return false
}

func (a *App) settingsProps(t theme.Tokens, formats timefmt.Formats, prefs preferences.Preferences) panes.Props {
	agentEnv := a.agentEnv(t)
	return panes.Props{Tokens: t, Runtime: a.rt, Store: a.Store, Images: a.Images, Formats: formats, Prefs: prefs, Mac: a.opts.Mac,
		Agent:      func(c *ui.Context) { a.agentPane.Render(c, agentEnv) },
		AddAccount: a.startAdding, LogOut: func() { a.logoutOpen = true }, Lock: a.Lock}
}
