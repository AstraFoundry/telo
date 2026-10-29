// Package showcase illustrates Telo at work: a mock Telo window with a
// short conversation, and the agent's summary pill floating over the soft
// backdrop, in the composition of Arion's onboarding illustrations. It is
// drawn from fixed copy, not live state.
package showcase

import (
	"time"
	"unicode/utf8"

	"github.com/AstraFoundry/telo/frontend/shared/assets"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Scene is what the illustration shows.
type Scene int

const (
	// Conversation loops a chat: a question arrives, the agent's summary
	// streams in the pill, the reply lands. Reduced motion holds Replied.
	Conversation Scene = iota
	// Locked shows the window waiting behind a lock, for sign-in.
	Locked
	// Agent holds the pill with the agent's summary.
	Agent
	// Replied shows the finished exchange.
	Replied
)

// The conversation loop: the summary streams for stream, the reply stays
// until cycle ends.
const (
	stream = 3200 * time.Millisecond
	cycle  = 6400 * time.Millisecond
)

// Window is the mock window's width.
const Window = 252

// Render fills its box with the backdrop and the scene. Radius rounds the
// photograph's corners where it meets a rounded container.
func Render(c *ui.Context, t theme.Tokens, scene Scene, radius ...float32) {
	now := c.Now()
	if scene == Conversation && c.Preferences().ReduceMotion {
		scene = Replied
	}
	if scene == Conversation {
		c.AnimationFrame()
	}
	streamed, replied := progress(scene, now)
	corners := [4]float32{}
	switch len(radius) {
	case 1:
		corners = [4]float32{radius[0], radius[0], radius[0], radius[0]}
	case 4:
		corners = [4]float32{radius[0], radius[1], radius[2], radius[3]}
	}
	ui.Column(c).Fill().Clip().Radius(corners[:]...).Background(t.Scrim).Role(ui.RoleImage).Label(copy.T(copy.OnbIllustrationLabel)).Children(func() {
		ui.Image(c, assets.Backdrop).Absolute().Top(0).Left(0).Right(0).Bottom(0).Fit(ui.Cover).Radius(corners[:]...)
		// Scrims keep the title bar controls and the pill's shadow legible.
		ui.Box(c).Absolute().Top(0).Left(0).Right(0).Height(96).PassThrough().Radius(corners[0], corners[1], 0, 0).
			LinearGradient(ui.LinearGradient{From: t.Scrim.Alpha(0.35), To: t.Scrim.Alpha(0), Angle: 180})
		ui.Box(c).Absolute().Left(0).Right(0).Bottom(0).Height(220).PassThrough().Radius(0, 0, corners[2], corners[3]).
			LinearGradient(ui.LinearGradient{From: t.Scrim.Alpha(0), To: t.Scrim.Alpha(0.4), Angle: 180})
		ui.Column(c).Absolute().Top(0).Left(0).Right(0).Bottom(0).Justify(ui.Center).AlignItems(ui.Center).Children(func() {
			window(c, t, scene, replied)
			pill(c, t, scene, streamed, replied)
		})
	})
}

// progress returns how much of the summary has streamed and whether the
// reply has landed.
func progress(scene Scene, now time.Time) (float32, bool) {
	switch scene {
	case Locked:
		return 0, false
	case Agent:
		return 1, false
	case Replied:
		return 1, true
	}
	at := time.Duration(now.UnixNano()) % cycle
	if at >= stream {
		return 1, true
	}
	return float32(at) / float32(stream), false
}

// window draws a small Telo window: a title bar, a chat header and the
// conversation as bubbles.
func window(c *ui.Context, t theme.Tokens, scene Scene, replied bool) {
	frame := ui.Column(c).Width(Window).Radius(theme.RadiusLG+2).Background(t.Canvas).Border(1, t.CardBorder).Clip()
	kit.Raise(frame, t, kit.Floating).Children(func() {
		ui.Row(c).Height(26).Padding(0, 10).Gap(6).AlignItems(ui.Center).Background(t.Card).Children(func() {
			for i := 0; i < 3; i++ {
				ui.Box(c.Key(i)).Size(7, 7).Radius(3.5).Background(t.CardBorder)
			}
			ui.Spacer(c)
			ui.Text(c, copy.T(copy.ShowcaseChat)).FontSize(10.5).FontWeight(600).TextColor(t.Muted).SingleLine()
			ui.Spacer(c)
			ui.Box(c).Size(27, 7)
		})
		ui.Box(c).Height(1).Background(t.Hairline)
		ui.Column(c).Padding(12, 10, 30, 10).Gap(6).MinHeight(150).Children(func() {
			if scene == Locked {
				ui.Column(c).Grow(1).Justify(ui.Center).AlignItems(ui.Center).Gap(8).Children(func() {
					disc := ui.Row(c).Size(40, 40).Radius(20).Background(t.AccentSoft).Justify(ui.Center).AlignItems(ui.Center)
					disc.Children(func() { ui.Icon(c, icons.LockSimple).FontSize(20).TextColor(t.AccentInk) })
					ui.Box(c).Height(6).Width(120).Radius(3).Background(t.Hairline)
					ui.Box(c).Height(6).Width(84).Radius(3).Background(t.Hairline)
				})
				return
			}
			bubble(c, t, copy.T(copy.ShowcaseIncoming), false)
			if replied {
				ui.Box(c.Key("reply")).Transition(ui.ElementTransition{Animation: &theme.Settle, Enter: &ui.Motion{Y: 6, Opacity: 0}}).Children(func() {
					bubble(c, t, copy.T(copy.ShowcaseOutgoing), true)
				})
			}
		})
	})
}

func bubble(c *ui.Context, t theme.Tokens, text string, outgoing bool) {
	row := ui.Row(c)
	if outgoing {
		row.Justify(ui.End)
	}
	row.Children(func() {
		b := ui.Box(c).MaxWidth(Window*0.78).Padding(6, 9).Radius(12)
		if outgoing {
			b.Background(t.BubbleOut).TextColor(t.BubbleOutText)
		} else {
			b.Background(t.BubbleIn).TextColor(t.BubbleInText).Border(1, t.Hairline)
		}
		b.Children(func() { ui.Text(c, text).FontSize(11.5).LineHeight(1.3) })
	})
}

// pill is the agent's floating summary: a sparkle and the streaming text,
// or the outcome once the reply landed.
func pill(c *ui.Context, t theme.Tokens, scene Scene, streamed float32, replied bool) {
	if scene == Locked {
		return
	}
	phase := "agent"
	if replied {
		phase = "done"
	}
	kit.Pill(c.Key("pill"), t).Margin(-20, 0, 0, 0).MaxWidth(Window + 24).Children(func() {
		ui.Row(c.Key(phase)).Gap(10).AlignItems(ui.Center).
			Transition(ui.ElementTransition{Animation: &theme.Pop, Enter: &ui.Motion{Scale: 0.94}, Exit: &ui.Motion{Scale: 0.97}}).
			Children(func() {
				if replied {
					mark := ui.Row(c).Size(18, 18).Radius(9).Background(t.Success).Justify(ui.Center).AlignItems(ui.Center)
					mark.TextColor(t.OnFill).Children(func() { ui.Icon(c, icons.Check).FontSize(11) })
					ui.Text(c, copy.T(copy.ShowcaseSummarized)).FontSize(theme.Callout).FontWeight(500).SingleLine()
					return
				}
				ui.Icon(c, icons.Sparkle).FontSize(16).TextColor(t.Accent.Mix(t.PillText, 0.35))
				text := copy.T(copy.ShowcaseAgent)
				ui.Text(c, tail(head(text, streamed), 26)).FontSize(theme.Callout).SingleLine().MaxWidth(190)
			})
	})
}

// head returns the first fraction of text's runes.
func head(text string, fraction float32) string {
	n := int(float32(utf8.RuneCountInString(text)) * fraction)
	return string([]rune(text)[:n])
}

// tail keeps the last n runes, the part streaming now.
func tail(text string, n int) string {
	runes := []rune(text)
	if len(runes) <= n {
		return text
	}
	return "…" + string(runes[len(runes)-n:])
}
