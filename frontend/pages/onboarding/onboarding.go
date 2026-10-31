// Package onboarding is the first-run page: welcome, Telegram sign-in by
// phone or QR code, the login code, the two-step password, an optional
// agent provider, and done — each step beside an illustration, in the
// layout of Arion's onboarding: the soft photograph with mock UI on the
// left, the stepper, a large title and one primary action on the right.
package onboarding

import (
	"time"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/onboarding"
	"github.com/AstraFoundry/telo/frontend/features/signin"
	"github.com/AstraFoundry/telo/frontend/shared/config"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/AstraFoundry/telo/frontend/widgets/paperplane"
	"github.com/AstraFoundry/telo/frontend/widgets/stepper"
	"github.com/egoist/mygo/ui"
)

// Window and layout metrics, as Arion's onboarding window.
const (
	Width   = 840
	Height  = 560
	Pane    = 320
	Inset   = 44
	Content = 380
)

// Page keeps the flow's state.
type Page struct {
	flow    onboarding.Flow
	signin  *signin.State
	last    onboarding.Step
	entered time.Time
	// AgentForm draws the agent provider form of the agent step; nil
	// shows only its actions.
	AgentForm func(c *ui.Context, t theme.Tokens) (ready bool)
	// ConnectAgent opens the agent settings after onboarding.
	ConnectAgent func()
	// Adding is set when signing in an additional account: the welcome
	// and agent steps are skipped.
	Adding bool
	// plane is the illustration: the sheet folds once for each step.
	plane paperplane.Figure
}

// New starts the flow; region picks the phone form's first country.
func New(region string) *Page { return &Page{signin: signin.NewState(region)} }

// Step returns the current step for the auth state.
func (p *Page) Step(auth tg.AuthState) onboarding.Step {
	f := p.flow
	if p.Adding {
		f.Started, f.AgentDone = true, true
	}
	return f.Step(auth)
}

// Render draws the current step beside its illustration. finish runs when
// the user leaves the flow for the workspace.
func (p *Page) Render(c *ui.Context, rt *runtime.Runtime, auth tg.AuthState, finish func()) {
	prefs := rt.Preferences.Get()
	t := theme.Apply(c, prefs)
	step := p.Step(auth)
	if step != p.last {
		if step > p.last {
			p.flow.Direction = 1
		} else {
			p.flow.Direction = -1
		}
		p.last = step
		p.entered = c.Now()
	}
	bar := c.TitleBar()
	top := max(bar.Height, 28) + 16
	if bar.Right > 0 {
		top += bar.Height
	}
	ui.Row(c).Fill().AlignItems(ui.Stretch).Background(t.Canvas).Children(func() {
		ui.Column(c).Width(Pane).Children(func() {
			current, _ := onboarding.Progress(step)
			p.plane.Render(c, t, current, top)
			ui.Box(c).Absolute().Top(0).Left(0).Right(0).Height(top).DragWindow()
		})
		ui.Column(c).Grow(1).Children(func() {
			ui.Row(c).Height(top).Padding(0, Inset).AlignItems(ui.End).DragWindow().Children(func() {
				current, total := onboarding.Progress(step)
				stepper.Render(c, t, current, total)
			})
			ui.Column(c).Grow(1).ClipX().Children(func() {
				enter := &ui.Motion{X: 28 * float32(p.flow.Direction)}
				if p.flow.Direction == 0 {
					enter = &ui.Motion{Y: 10}
				}
				ui.Column(c.Key(step)).Fill().Padding(8, Inset).Gap(22).Justify(ui.Center).AlignItems(ui.Start).
					Transition(ui.ElementTransition{Animation: &theme.Page, Enter: enter, Exit: &ui.Motion{Scale: 0.98}}).
					Children(func() { p.step(c, rt, t, auth, step) })
			})
			ui.Row(c).Padding(16, Inset, 24, Inset).Gap(8).AlignItems(ui.Center).Children(func() {
				p.footer(c, rt, t, auth, step, prefs, finish)
			})
		})
	})
}

func heading(c *ui.Context, t theme.Tokens, title, body string) {
	ui.Column(c).Gap(10).MaxWidth(Content + 20).Children(func() {
		ui.Text(c, title).FontSize(theme.Display).FontWeight(700).LetterSpacing(-0.3)
		if body != "" {
			ui.Text(c, body).FontSize(theme.Heading).TextColor(t.Muted).LineHeight(1.4)
		}
	})
}

func (p *Page) step(c *ui.Context, rt *runtime.Runtime, t theme.Tokens, auth tg.AuthState, step onboarding.Step) {
	s := p.signin
	switch step {
	case onboarding.Welcome:
		kit.Mark(c, 52)
		heading(c, t, copy.T(copy.OnbWelcomeTitle), copy.T(copy.OnbWelcomeBody))
	case onboarding.Phone:
		heading(c, t, copy.T(copy.OnbPhoneTitle), copy.T(copy.OnbPhoneBody))
		if !rt.Info.TelegramConfigured || auth.Step == tg.AuthNotConfigured {
			kit.Status(c, t, icons.WarningCircle, t.Warning, copy.T(copy.OnbNotConfigured)).MaxWidth(Content)
			return
		}
		signin.PhoneForm(c, t, rt, auth, s, Content)
	case onboarding.QR:
		heading(c, t, copy.T(copy.OnbQrTitle), copy.T(copy.OnbQrBody))
		signin.QRCode(c, t, auth, s)
	case onboarding.Code:
		heading(c, t, copy.T(copy.OnbCodeTitle), signin.CodeBody(auth))
		signin.CodeForm(c, t, rt, auth, s, Content)
	case onboarding.Password:
		heading(c, t, copy.T(copy.OnbPasswordTitle), copy.T(copy.OnbPasswordBody))
		signin.PasswordForm(c, t, rt, auth, s, Content)
	case onboarding.Register:
		heading(c, t, copy.T(copy.OnbRegisterTitle), copy.T(copy.OnbRegisterBody))
		signin.RegisterForm(c, t, rt, auth, s, Content)
	case onboarding.Agent:
		heading(c, t, copy.T(copy.OnbAgentTitle), copy.T(copy.OnbAgentBody))
		if p.AgentForm != nil {
			p.AgentForm(c, t)
		}
	case onboarding.Done:
		mark := ui.Row(c).Size(56, 56).Radius(28).Background(t.Success).Justify(ui.Center).AlignItems(ui.Center)
		mark.TextColor(t.OnFill).Children(func() { ui.Icon(c, icons.Check).FontSize(30) })
		agent, _ := config.ByAction(config.ActToggleAgent)
		keys := config.Label(agent.Bindings[0], rt.Info.Platform == "darwin")
		heading(c, t, copy.T(copy.OnbDoneTitle), copy.F(copy.OnbDoneBody, keys))
	}
}

func (p *Page) footer(c *ui.Context, rt *runtime.Runtime, t theme.Tokens, auth tg.AuthState, step onboarding.Step, prefs preferences.Preferences, finish func()) {
	s := p.signin
	primary := func(label string, enabled bool, do func()) {
		kit.Button(c.Key("next"), t, kit.Primary, label, enabled).OnClick(do)
	}
	switch step {
	case onboarding.Welcome:
		ui.Spacer(c)
		primary(copy.T(copy.OnbStart), true, func() { p.flow.Started = true })
	case onboarding.Phone:
		kit.Button(c.Key("back"), t, kit.Ghost, copy.T(copy.Back), true).OnClick(func() { p.flow.Started = false })
		ui.Spacer(c)
		if rt.Info.TelegramConfigured {
			kit.Button(c.Key("qr"), t, kit.Ghost, copy.T(copy.OnbQrInstead), !s.Busy).OnClick(func() {
				p.flow.PreferQR = true
				s.RequestQR(rt)
			})
			primary(copy.T(copy.Continue), s.CanSubmitPhone(), func() { s.SubmitPhone(rt) })
		}
	case onboarding.QR:
		kit.Button(c.Key("phone"), t, kit.Ghost, copy.T(copy.OnbPhoneInstead), true).OnClick(func() { p.flow.PreferQR = false })
		ui.Spacer(c)
	case onboarding.Code:
		ui.Spacer(c)
		primary(copy.T(copy.Continue), !s.Busy && s.Code != "", func() { s.SubmitCode(rt) })
	case onboarding.Password:
		ui.Spacer(c)
		primary(copy.T(copy.Continue), !s.Busy && s.Password != "", func() { s.SubmitPassword(rt) })
	case onboarding.Register:
		ui.Spacer(c)
		primary(copy.T(copy.Continue), !s.Busy && s.First != "", func() { s.SubmitRegistration(rt) })
	case onboarding.Agent:
		ui.Spacer(c)
		kit.Button(c.Key("later"), t, kit.Ghost, copy.T(copy.OnbAgentLater), true).OnClick(func() { p.flow.AgentDone = true })
		primary(copy.T(copy.OnbAgentConnect), true, func() {
			p.flow.AgentDone = true
			if p.ConnectAgent != nil {
				p.ConnectAgent()
			}
		})
	case onboarding.Done:
		ui.Spacer(c)
		primary(copy.T(copy.OnbFinish), true, finish)
	}
	_ = prefs
}
