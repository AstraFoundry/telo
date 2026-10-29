// Package theme holds Telo's semantic design tokens and motion presets.
//
// The anatomy follows Arion's design system (coss ui ported to Go: the
// restrained radius scale, two-layer contact and ambient shadows, a 1px
// top light on raised controls, hairline cards); the colors are Telo's
// own: cool low-chroma neutrals at hue 250 and five accent palettes that
// share one lightness and chroma, so switching accent never changes
// contrast. Physical values live only in this file; views use Tokens.
// See docs/frontend/design-system.md.
package theme

import (
	"time"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	"github.com/egoist/mygo/ui"
)

// Type scale in DIPs. Body is 14, one step above tdesktop's 13 base;
// Callout carries chat-list previews and header status, Caption meta.
const (
	Display = 28
	Title   = 20
	Heading = 15
	Body    = 14
	Callout = 13
	Caption = 11
)

// Radius scale: restrained, nested corners computed (inner = outer −
// padding) rather than repeated.
const (
	RadiusXS      = 2
	RadiusSM      = 4
	RadiusMD      = 6
	RadiusLG      = 10
	RadiusXL      = 14
	RadiusPill    = 999
	RadiusControl = RadiusLG
	RadiusCard    = RadiusXL
	// Bubble metrics from tdesktop's chat.style: 16 for a bubble, 6 for
	// the grouped corners of consecutive bubbles by one author.
	RadiusBubble        = 16
	RadiusBubbleGrouped = 6
)

// Spacing by relationship: tight inside a group, generous between groups.
const (
	GapTight   = 4
	GapRelated = 8
	GapGroup   = 28
	Gutter     = 24
)

// Message metrics, ported from Telegram's desktop client so the
// transcript keeps its density.
const (
	BubblePadX     = 11
	BubblePadY     = 8
	BubbleMaxWidth = 430
	AvatarSize     = 33
	AvatarGap      = 7
	RunGap         = 2
	GroupGap       = 8
	ChatRowHeight  = 62
)

// hue of each accent palette; lightness and chroma are shared.
var accentHue = map[preferences.Accent]float32{
	preferences.AccentBlue: 248, preferences.AccentGreen: 145, preferences.AccentPurple: 295,
	preferences.AccentRed: 25, preferences.AccentOrange: 60,
}

// neutral is a cool neutral at hue 250.
func neutral(l, c float32) ui.Color { return ui.Oklch(l, c, 250) }

// Tokens are semantic colors resolved for an appearance and an accent.
type Tokens struct {
	Dark bool

	Canvas     ui.Color // window background
	Sidebar    ui.Color // the chat list column
	Card       ui.Color // grouped surfaces and incoming bubbles
	CardBorder ui.Color // edge of cards and controls
	Hairline   ui.Color // dividers inside a card
	Text       ui.Color
	Muted      ui.Color
	Subtle     ui.Color // quiet fills: keycaps, chips, the search field
	Faint      ui.Color

	Accent     ui.Color // primary actions, outgoing bubbles, the choice
	AccentText ui.Color // text on the accent
	AccentSoft ui.Color // hover and selection wash
	AccentInk  ui.Color // the accent as text or a line on a surface
	Ring       ui.Color // the focus ring

	BubbleIn      ui.Color
	BubbleInText  ui.Color
	BubbleOut     ui.Color
	BubbleOutText ui.Color
	BubbleOutMeta ui.Color
	// BackdropInk draws the chat wallpapers' patterns.
	BackdropInk ui.Color

	Online  ui.Color
	Success ui.Color
	Warning ui.Color
	Danger  ui.Color
	OnFill  ui.Color // marks on saturated fills

	// Shade is the color of shadows: a cool ink, never pure black.
	Shade ui.Color
	// Highlight is the 1px top light on raised controls.
	Highlight ui.Color
	// Scrim darkens photographs under text.
	Scrim ui.Color

	// Pill is the floating dark surface of the illustrations' toasts.
	PillSurface ui.Color
	PillText    ui.Color
	PillMuted   ui.Color
	PillBorder  ui.Color
}

// Resolve returns the tokens for an appearance and an accent.
func Resolve(dark bool, accent preferences.Accent) Tokens {
	hue, ok := accentHue[accent]
	if !ok {
		hue = accentHue[preferences.AccentBlue]
	}
	white := ui.RGB(255, 255, 255)
	t := Tokens{
		Canvas:      neutral(0.985, 0.003),
		Sidebar:     neutral(0.975, 0.005),
		Card:        white,
		CardBorder:  neutral(0.9, 0.009),
		Hairline:    neutral(0.94, 0.006),
		Text:        neutral(0.22, 0.018),
		Muted:       neutral(0.52, 0.018),
		Subtle:      neutral(0.955, 0.008),
		Faint:       neutral(0.68, 0.012),
		Accent:      ui.Oklch(0.56, 0.16, hue),
		AccentText:  white,
		AccentSoft:  ui.Oklch(0.93, 0.025, hue),
		AccentInk:   ui.Oklch(0.5, 0.15, hue),
		Ring:        ui.Oklch(0.61, 0.14, hue),
		BubbleIn:    white,
		BubbleOut:   ui.Oklch(0.56, 0.16, hue),
		BackdropInk: ui.RGBA(0, 0, 0, 0.07),
		Online:      ui.Oklch(0.66, 0.17, 150),
		Success:     ui.Oklch(0.6, 0.15, 150),
		Warning:     ui.Oklch(0.7, 0.16, 70),
		Danger:      ui.Oklch(0.58, 0.2, 25),
		OnFill:      white,
		Shade:       neutral(0.18, 0.03),
		Highlight:   white.Alpha(0.18),
		Scrim:       neutral(0.12, 0.02),
		PillSurface: neutral(0.17, 0.014).Alpha(0.94),
		PillText:    neutral(0.97, 0.004),
		PillMuted:   neutral(0.97, 0.004).Alpha(0.62),
		PillBorder:  neutral(0.28, 0.014),
	}
	if dark {
		t.Dark = true
		t.Canvas = neutral(0.17, 0.014)
		t.Sidebar = neutral(0.19, 0.014)
		t.Card = neutral(0.22, 0.014)
		t.CardBorder = white.Alpha(0.1)
		t.Hairline = white.Alpha(0.06)
		t.Text = neutral(0.94, 0.006)
		t.Muted = neutral(0.68, 0.012)
		t.Subtle = neutral(0.25, 0.014)
		t.Faint = neutral(0.55, 0.012)
		t.Accent = ui.Oklch(0.7, 0.13, hue)
		t.AccentText = neutral(0.15, 0.02)
		t.AccentSoft = ui.Oklch(0.28, 0.035, hue)
		t.AccentInk = ui.Oklch(0.78, 0.1, hue)
		t.Ring = ui.Oklch(0.7, 0.13, hue)
		t.BubbleIn = neutral(0.24, 0.014)
		t.BubbleOut = ui.Oklch(0.45, 0.12, hue)
		t.BackdropInk = white.Alpha(0.07)
		t.Online = ui.Oklch(0.72, 0.16, 150)
		t.Success = ui.Oklch(0.7, 0.14, 150)
		t.Warning = ui.Oklch(0.78, 0.14, 70)
		t.Danger = ui.Oklch(0.68, 0.18, 25)
		t.Shade = ui.RGB(0, 0, 0)
		t.Highlight = white.Alpha(0.06)
		t.PillSurface = neutral(0.12, 0.012).Alpha(0.96)
		t.PillBorder = neutral(0.3, 0.014)
	}
	t.BubbleInText = t.Text
	t.BubbleOutText = white
	t.BubbleOutMeta = white.Alpha(0.72)
	return t
}

// Apply installs Telo's theme for the window's appearance, so MyGo's own
// controls (switches, radios, fields, lists) wear it too, and returns the
// tokens for Telo's views. appearance overrides the desktop's light or
// dark when not ThemeSystem.
func Apply(c *ui.Context, appearance preferences.Theme, accent preferences.Accent) Tokens {
	base := c.Theme()
	dark := base.Dark
	switch appearance {
	case preferences.ThemeLight:
		dark = false
	case preferences.ThemeDark:
		dark = true
	}
	if dark != base.Dark {
		base = ui.LightTheme()
		if dark {
			base = ui.DarkTheme()
		}
	}
	tokens := Resolve(dark, accent)
	t := *base
	t.Dark = dark
	t.Background, t.Text, t.TextMuted, t.Border = tokens.Canvas, tokens.Text, tokens.Muted, tokens.CardBorder
	t.Accent, t.AccentText = tokens.Accent, tokens.AccentText
	t.AccentHover, t.AccentPressed = tokens.Accent.Mix(tokens.Card, 0.1), tokens.Accent.Mix(tokens.Shade, 0.12)
	t.Danger, t.Warning, t.Success = tokens.Danger, tokens.Warning, tokens.Success
	t.Surface, t.SurfaceHover, t.SurfacePressed = tokens.Card, tokens.Subtle, tokens.Subtle.Mix(tokens.Text, 0.06)
	t.Selection, t.Focus = tokens.Accent.Alpha(0.28), tokens.Ring.Alpha(0.75)
	if dark {
		t.Scrollbar = ui.RGBA(255, 255, 255, 0.24)
		t.Inverse, t.InverseText = tokens.Text, tokens.Canvas
	} else {
		t.Scrollbar = ui.RGBA(0, 0, 0, 0.22)
		t.Inverse, t.InverseText = tokens.Text, tokens.Canvas
	}
	// The desktop's Increase Contrast keeps its effect under the palette.
	if c.Preferences().HighContrast {
		t.Border = t.Border.Mix(t.Text, 0.45)
		t.TextMuted = t.TextMuted.Mix(t.Text, 0.4)
		t.Focus.A = 255
		tokens.CardBorder, tokens.Muted = t.Border, t.TextMuted
		tokens.Hairline = tokens.Hairline.Mix(t.Text, 0.3)
	}
	t.Radius = RadiusControl
	t.FontSize = Body
	c.SetTheme(&t)
	return tokens
}

// Motion presets. Springs keep velocity when interrupted.
var (
	// Settle moves layout without overshoot.
	Settle = ui.Animation{Spring: ui.SpringOptions{Duration: 420 * time.Millisecond, Bounce: 0}}
	// Pop enters small surfaces with a slight overshoot.
	Pop = ui.Animation{Spring: ui.SpringOptions{Duration: 380 * time.Millisecond, Bounce: 0.18}}
	// Quick is for hover and color feedback.
	Quick = ui.Animation{Duration: 120 * time.Millisecond, Ease: ui.EaseOut}
	// Disclosure reveals measured content without overshoot.
	Disclosure = ui.Animation{Duration: 200 * time.Millisecond, Ease: ui.CubicBezier(0.23, 1, 0.32, 1)}
	// Exit leaves faster than things arrive.
	Exit = ui.Animation{Duration: 160 * time.Millisecond, Ease: ui.EaseIn}
	// Page slides onboarding steps.
	Page = ui.Animation{Spring: ui.SpringOptions{Duration: 520 * time.Millisecond, Bounce: 0.04}}
	// Row fades chat-list rows as the order changes.
	Row = ui.Animation{Duration: 150 * time.Millisecond, Ease: ui.EaseOut}
)
