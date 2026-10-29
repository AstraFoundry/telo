// Package kit holds Telo's native UI primitives: coss ui anatomy ported to
// Go, as Arion's design system does, over Telo's tokens. Views use these
// rather than MyGo's stock buttons and colors only through theme.Tokens.
package kit

import (
	"time"

	"github.com/AstraFoundry/telo/frontend/shared/assets"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Press gives custom buttons tactile feedback: a 0.96 scale while pressed,
// moved in paint-only frames.
func Press(button ui.Element) ui.Element {
	pose := ui.Pose{}
	if button.Pressed() && !button.IsDisabled() {
		pose.Scale = 0.96
	}
	return button.AnimatePose(pose, ui.Animation{Duration: 90 * time.Millisecond, Ease: ui.EaseOut})
}

// Variant is a button's emphasis, as coss names them.
type Variant int

const (
	// Primary is the one main action of a view: the accent.
	Primary Variant = iota
	// Outline is a secondary action on a raised card face.
	Outline
	// Ghost is a quiet action with no face until hovered.
	Ghost
	// Destructive confirms something that cannot be undone.
	Destructive
	// Secondary is a filled quiet action, as coss's secondary.
	Secondary
)

// Size is a control's height step.
type Size int

const (
	SizeDefault Size = iota // 32 DIP
	SizeSmall               // 28 DIP
	SizeLarge               // 36 DIP
)

func (s Size) height() float32 {
	switch s {
	case SizeSmall:
		return 28
	case SizeLarge:
		return 36
	}
	return 32
}

// Button is a text button with coss anatomy: a 1px edge, a 1px top light
// and a contact shadow on raised variants, which press flat. A disabled
// button keeps its layout at 64% opacity.
func Button(c *ui.Context, t theme.Tokens, variant Variant, label string, enabled bool) ui.Element {
	return SizedButton(c, t, variant, SizeDefault, nil, label, enabled)
}

// SizedButton is Button at a size, with an optional leading icon.
func SizedButton(c *ui.Context, t theme.Tokens, variant Variant, size Size, icon *ui.SVG, label string, enabled bool) ui.Element {
	button := ui.ButtonBase(c).Height(size.height()).Padding(0, 12).Gap(6).Radius(theme.RadiusControl).
		AlignItems(ui.Center).Justify(ui.Center).Disabled(!enabled).Label(label)
	Style(button, t, variant, enabled)
	button.Children(func() {
		if icon != nil {
			ui.Icon(c, icon).FontSize(15)
		}
		ui.Text(c, label).FontSize(theme.Callout).FontWeight(500).SingleLine()
	})
	return button
}

// IconButton is a square ghost button showing only an icon; label names it
// for assistive technology and its tooltip.
func IconButton(c *ui.Context, t theme.Tokens, icon *ui.SVG, label string) ui.Element {
	button := ui.ButtonBase(c).Size(30, 30).Radius(theme.RadiusLG).Justify(ui.Center).AlignItems(ui.Center).
		Label(label).Tooltip(label)
	Style(button, t, Ghost, true)
	button.TextColor(t.Muted)
	if button.Hovered() {
		button.TextColor(t.Text)
	}
	button.Children(func() { ui.Icon(c, icon).FontSize(18) })
	return button
}

// Style gives a button base the anatomy of a variant in its current state,
// for buttons with content of their own.
func Style(button ui.Element, t theme.Tokens, variant Variant, enabled bool) {
	hovered := enabled && button.Hovered()
	pressed := enabled && button.Pressed()
	var fill, edge ui.Color
	switch variant {
	case Primary, Destructive:
		base := t.Accent
		if variant == Destructive {
			base = t.Danger
		}
		fill, edge = base, base.Mix(t.Shade, 0.08)
		if hovered {
			fill = base.Mix(t.Card, 0.1)
		}
		button.TextColor(t.AccentText)
		if variant == Destructive {
			button.TextColor(t.OnFill)
		}
		if enabled && !pressed {
			button.InsetShadow(0, 1, 0, 0, t.Highlight).Shadow(0, 1, 2, 0, base.Mix(t.Shade, 0.4).Alpha(0.24))
		}
	case Outline:
		fill, edge = t.Card, t.CardBorder
		if hovered {
			fill = t.Subtle
		}
		button.TextColor(t.Text)
		if enabled && !pressed {
			button.InsetShadow(0, 1, 0, 0, t.Highlight).Shadow(0, 1, 2, 0, t.Shade.Alpha(0.05))
		}
	case Secondary:
		fill = t.Subtle
		if hovered {
			fill = t.Subtle.Mix(t.Text, 0.06)
		}
		button.TextColor(t.Text)
	case Ghost:
		fill = ui.Transparent
		if hovered {
			fill = t.Subtle
		}
		button.TextColor(t.Text)
	}
	if pressed && variant != Ghost {
		button.InsetShadow(0, 1, 0, 0, t.Shade.Alpha(0.08))
	}
	button.Background(button.AnimateColor("face", fill, theme.Quick))
	if edge.A > 0 {
		button.Border(1, edge)
	}
	if !enabled {
		button.Opacity(0.64)
	}
	Press(button)
}

// Elevation is how high a surface floats: a tight contact shadow plus an
// ambient one whose blur tracks the height.
type Elevation int

const (
	Raised Elevation = iota + 1
	Lifted
	Floating
	Overlay
)

// Raise casts the shadows of an elevation.
func Raise(e ui.Element, t theme.Tokens, level Elevation) ui.Element {
	contact, ambient := float32(0.04), float32(0.08)
	if t.Dark {
		contact, ambient = 0.2, 0.36
	}
	switch level {
	case Raised:
		return e.Shadow(0, 1, 0, 0, t.Shade.Alpha(contact)).Shadow(0, 1, 2, 0, t.Shade.Alpha(ambient*0.75))
	case Lifted:
		return e.Shadow(0, 1, 0, 0, t.Shade.Alpha(contact)).Shadow(0, 4, 10, -2, t.Shade.Alpha(ambient))
	case Floating:
		return e.Shadow(0, 2, 0, 0, t.Shade.Alpha(contact)).Shadow(0, 10, 24, -4, t.Shade.Alpha(ambient*1.25))
	}
	return e.Shadow(0, 4, 0, 0, t.Shade.Alpha(contact)).Shadow(0, 20, 48, -8, t.Shade.Alpha(ambient*1.75))
}

// Card is a grouped surface: one hairline edge, a contact shadow in the
// light and a top light in the dark.
func Card(c *ui.Context, t theme.Tokens) ui.Element {
	card := ui.Column(c).Radius(theme.RadiusCard).Background(t.Card).Border(1, t.CardBorder).Clip()
	if t.Dark {
		return card.InsetShadow(0, 1, 0, 0, t.Highlight)
	}
	return Raise(card, t, Raised)
}

// Group is a titled set of rows in a card: the title sits close to what
// it names, groups stand apart in their parent's GapGroup.
func Group(c *ui.Context, t theme.Tokens, title, footer string, rows func()) {
	ui.Column(c).Gap(theme.GapRelated).Children(func() {
		if title != "" {
			SectionTitle(c, t, title)
		}
		Card(c, t).Children(rows)
		if footer != "" {
			ui.Text(c, footer).FontSize(theme.Caption).TextColor(t.Muted).Margin(0, 4)
		}
	})
}

// Row lays out a labeled setting: title and optional detail on the left,
// the control on the right.
func Row(c *ui.Context, t theme.Tokens, title, detail string, control func()) ui.Element {
	return ui.Row(c).Gap(16).Padding(11, 16).MinHeight(44).AlignItems(ui.Center).Children(func() {
		ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
			ui.Text(c, title).FontSize(theme.Body)
			if detail != "" {
				ui.Text(c, detail).FontSize(theme.Caption).TextColor(t.Muted)
			}
		})
		if control != nil {
			control()
		}
	})
}

// NavRow is a settings row that opens another page: an icon tile, the
// title, an optional value and a chevron.
func NavRow(c *ui.Context, t theme.Tokens, icon *ui.SVG, title, value string) ui.Element {
	row := ui.ButtonBase(c).Gap(12).Padding(9, 12, 9, 14).MinHeight(44).AlignItems(ui.Center).Label(title)
	if row.Hovered() {
		row.Background(t.Subtle)
	}
	row.Children(func() {
		if icon != nil {
			ui.Icon(c, icon).FontSize(18).TextColor(t.Muted)
		}
		ui.Text(c, title).FontSize(theme.Body).Grow(1).Shrink(1).SingleLine()
		if value != "" {
			ui.Text(c, value).FontSize(theme.Callout).TextColor(t.Muted).SingleLine().Shrink(1)
		}
		ui.Icon(c, icons.CaretRight).FontSize(13).TextColor(t.Faint)
	})
	return row
}

// Divider separates rows inside a card, inset like AppKit's.
func Divider(c *ui.Context, t theme.Tokens) {
	ui.Box(c).Height(1).Margin(0, 0, 0, 16).Background(t.Hairline)
}

// SectionTitle labels a group of cards.
func SectionTitle(c *ui.Context, t theme.Tokens, text string) ui.Element {
	return ui.Text(c, text).FontSize(theme.Caption).FontWeight(600).TextColor(t.Muted).Margin(0, 4)
}

// Status states an outcome in words; the icon alone carries the color, so
// a row of states never turns into a traffic light.
func Status(c *ui.Context, t theme.Tokens, icon *ui.SVG, color ui.Color, text string) ui.Element {
	return ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
		ui.Icon(c, icon).FontSize(14).TextColor(color)
		ui.Text(c, text).FontSize(theme.Caption).FontWeight(500).TextColor(t.Text).SingleLine()
	})
}

// Pill is the floating dark surface of the illustrations: a hairline, a
// 1px top light, a contact and an ambient shadow, so it reads over a
// photograph.
func Pill(c *ui.Context, t theme.Tokens) ui.Element {
	return ui.Row(c).Gap(10).Padding(0, 16, 0, 14).MinHeight(40).AlignItems(ui.Center).
		Radius(theme.RadiusPill).Background(t.PillSurface).Border(1, t.PillBorder).
		InsetShadow(0, 1, 0, 0, t.PillText.Alpha(0.06)).
		Shadow(0, 2, 4, 0, t.Shade.Alpha(0.22)).Shadow(0, 10, 24, -6, t.Shade.Alpha(0.36)).
		TextColor(t.PillText)
}

// Kbd is coss Kbd: one key on a muted fill, 20 DIP high, radius 4.
func Kbd(c *ui.Context, t theme.Tokens, key string) ui.Element {
	return ui.Row(c).Height(20).MinWidth(20).Padding(0, 5).Justify(ui.Center).AlignItems(ui.Center).
		Radius(theme.RadiusSM).Background(t.Subtle).Border(1, t.Hairline).Children(func() {
		ui.Text(c, key).FontSize(12).FontWeight(500).TextColor(t.Muted).SingleLine()
	})
}

// KbdGroup is coss KbdGroup: the keys of one combination, 4 DIP apart.
func KbdGroup(c *ui.Context) ui.Element { return ui.Row(c).Gap(4).AlignItems(ui.Center) }

// Badge is an unread counter: the accent for chats that notify, a quiet
// gray for muted ones, as Telegram draws them.
func Badge(c *ui.Context, t theme.Tokens, text string, muted bool) ui.Element {
	fill, ink := t.Accent, t.AccentText
	if muted {
		fill, ink = t.Faint, t.OnFill
	}
	return ui.Row(c).Height(20).MinWidth(20).Padding(0, 6).Radius(10).Justify(ui.Center).AlignItems(ui.Center).
		Background(fill).Shrink(0).Children(func() {
		ui.Text(c, text).FontSize(12).FontWeight(600).TextColor(ink).FontFeatures("tnum").SingleLine()
	})
}

// Empty fills a pane when there is nothing to show yet: one quiet line,
// centered, with an optional icon above.
func Empty(c *ui.Context, t theme.Tokens, icon *ui.SVG, text string) ui.Element {
	return ui.Column(c).Grow(1).Padding(24, 16).Gap(10).Justify(ui.Center).AlignItems(ui.Center).Children(func() {
		if icon != nil {
			ui.Icon(c, icon).FontSize(28).TextColor(t.Faint)
		}
		ui.Text(c, text).FontSize(theme.Callout).TextColor(t.Muted).TextAlign(ui.Center).MaxWidth(280)
	})
}

// Field gives a text input coss's input anatomy: a card face with a
// hairline that turns to the ring when focused.
func Field(input ui.Element, t theme.Tokens) ui.Element {
	edge := t.CardBorder
	if input.FocusWithin() {
		edge = t.Ring
	}
	return input.Height(34).Padding(0, 10).Radius(theme.RadiusControl).Background(t.Card).Border(1, edge).
		InsetShadow(0, 1, 1, 0, t.Shade.Alpha(0.03)).FocusRing(false)
}

// SearchBox is the chat list's search field: a quiet filled pill with a
// magnifier, which Escape clears.
func SearchBox(c *ui.Context, t theme.Tokens, text *string, placeholder string) ui.Element {
	box := ui.Row(c).Height(32).Padding(0, 10).Gap(8).Radius(theme.RadiusControl).Background(t.Subtle).AlignItems(ui.Center)
	var input ui.Element
	box.Children(func() {
		ui.Icon(c, icons.MagnifyingGlass).FontSize(15).TextColor(t.Muted)
		input = ui.TextInputBase(c.Key("search"), text).Placeholder(placeholder).Label(placeholder).Grow(1).FontSize(theme.Callout).FocusRing(false)
		if *text != "" {
			clear := ui.ButtonBase(c).Size(18, 18).Radius(9).Justify(ui.Center).AlignItems(ui.Center).Background(t.Faint.Alpha(0.5)).Label(placeholder)
			clear.Children(func() { ui.Icon(c, icons.X).FontSize(10).TextColor(t.Card) })
			if clear.Clicked() {
				*text = ""
			}
		}
	})
	if box.FocusWithin() {
		box.Border(1, t.Ring).Background(t.Card)
	}
	return input
}

// Dialog is coss's dialog: a card panel over a dimmed backdrop, a title,
// an optional description, the body, and right-aligned footer actions.
func Dialog(c *ui.Context, t theme.Tokens, open *bool, width float32, title, description string, body, footer func()) {
	ui.DialogBase(c, open, func(backdrop, panel ui.Element) {
		backdrop.Background(t.Scrim.Alpha(0.38))
		panel.Width(width).Radius(theme.RadiusXL+2).Background(t.Card).Border(1, t.CardBorder).Clip().
			Transition(ui.ElementTransition{Animation: &theme.Pop, Enter: &ui.Motion{Scale: 0.96, Opacity: 0}, Exit: &ui.Motion{Scale: 0.98, Opacity: 0}})
		Raise(panel, t, Overlay)
		ui.Column(c).Padding(20, 20, 4, 20).Gap(6).Children(func() {
			ui.Text(c, title).FontSize(theme.Heading + 2).FontWeight(600)
			if description != "" {
				ui.Text(c, description).FontSize(theme.Callout).TextColor(t.Muted)
			}
		})
		ui.Column(c).Padding(12, 20).Gap(12).Children(body)
		if footer != nil {
			ui.Row(c).Padding(12, 20, 16, 20).Gap(8).Justify(ui.End).AlignItems(ui.Center).Children(footer)
		}
	})
}

// SelectPopup gives a select's popup coss anatomy: a card face with a
// hairline, a 1px top light and lifted elevation, 4 DIPs below the trigger.
func SelectPopup[T comparable](t theme.Tokens, sel ui.SelectParts[T], items func()) ui.Element {
	return sel.Popup(func(panel ui.Element) {
		panel.Padding(4).Margin(4, 0, 0, 0).Radius(theme.RadiusControl).Background(t.Card).
			Border(1, t.CardBorder).InsetShadow(0, 1, 0, 0, t.Highlight).TextColor(t.Text)
		Raise(panel, t, Lifted)
		items()
	})
}

// SelectItem is an option of a select, as coss draws it: a 28 DIP row with
// a check column before the label, washed while highlighted.
func SelectItem[T comparable](c *ui.Context, t theme.Tokens, sel ui.SelectParts[T], value T, label string, selected bool) ui.Element {
	item := sel.Item(value).MinHeight(28).Padding(4, 16, 4, 8).Gap(8).AlignItems(ui.Center).Radius(theme.RadiusMD).Label(label)
	if item.Highlighted() {
		item.Background(t.AccentSoft)
	}
	item.Children(func() {
		check := ui.Box(c).Size(16, 16).Shrink(0).Justify(ui.Center).AlignItems(ui.Center)
		if selected {
			check.Children(func() { ui.Icon(c, icons.Check).FontSize(14).TextColor(t.Text) })
		}
		ui.Text(c, label).FontSize(theme.Callout).SingleLine().Shrink(1)
	})
	return item
}

// SelectTrigger draws a select's trigger as coss does: an outline control
// showing the chosen value and an up-down caret.
func SelectTrigger[T comparable](c *ui.Context, t theme.Tokens, sel ui.SelectParts[T], label, value string) ui.Element {
	trigger := sel.Trigger.Label(label).Height(30).Padding(0, 8, 0, 10).Gap(6).MinWidth(120).
		Radius(theme.RadiusControl).AlignItems(ui.Center)
	Style(trigger, t, Outline, true)
	trigger.Children(func() {
		ui.Text(c, value).FontSize(theme.Callout).FontWeight(500).SingleLine().Grow(1)
		ui.Icon(c, icons.CaretUpDown).FontSize(13).TextColor(t.Muted)
	})
	return trigger
}

// Select is a complete coss select over options with labels.
func Select[T comparable](c *ui.Context, t theme.Tokens, value *T, label string, options []T, name func(T) string) bool {
	before := *value
	sel := ui.SelectBase(c, value)
	SelectTrigger(c, t, sel, label, name(*value))
	SelectPopup(t, sel, func() {
		for _, o := range options {
			SelectItem(c.Key(o), t, sel, o, name(o), o == *value)
		}
	})
	return *value != before
}

// Segmented is coss's toggle group as a segmented control: a quiet track
// with the chosen segment raised on a card face.
func Segmented(c *ui.Context, t theme.Tokens, chosen *int, labels []string) ui.Element {
	seg := ui.SegmentedBase(c, chosen, len(labels))
	seg.Track.Padding(2).Gap(2).Radius(theme.RadiusControl).Background(t.Subtle).Children(func() {
		for i, l := range labels {
			s := seg.Segment(i).Height(26).Padding(0, 12).Radius(theme.RadiusMD + 2).Justify(ui.Center).AlignItems(ui.Center).Label(l)
			if i == *chosen {
				s.Background(t.Card)
				Raise(s, t, Raised)
			}
			s.Children(func() { ui.Text(c, l).FontSize(theme.Callout).FontWeight(500).SingleLine() })
		}
	})
	return seg.Track
}

// Mark draws the app icon at size DIPs.
func Mark(c *ui.Context, size float32) ui.Element {
	return ui.Image(c, assets.Mark).Size(size, size).Fit(ui.Contain)
}
