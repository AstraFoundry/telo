package kit

import (
	"github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Avatar draws a peer's picture in a circle of size DIPs: the downloaded
// photo, else TDLib's blurred minithumbnail, else Telegram's empty userpic
// (the first grapheme on the peer's accent gradient). Saved Messages wears
// the bookmark disc.
func Avatar(c *ui.Context, t theme.Tokens, images *media.Images, a telegram.Avatar, name string, size float32, saved bool) ui.Element {
	disc := ui.Box(c).Size(size, size).Radius(size / 2).Shrink(0).Clip().Justify(ui.Center).AlignItems(ui.Center).Label(name)
	if saved {
		disc.LinearGradient(ui.LinearGradient{From: ui.Hex("#72D5FD"), To: ui.Hex("#2A9EF1"), Angle: 180})
		disc.Children(func() { ui.Icon(c, icons.BookmarkSimple).FontSize(size * 0.48).TextColor(t.OnFill) })
		return disc
	}
	var bitmap *ui.Bitmap
	if images != nil {
		bitmap = images.File(a.Path)
		if bitmap == nil {
			bitmap = images.Bytes(a.Minithumbnail)
		}
	}
	if bitmap != nil {
		disc.Children(func() { ui.Image(c, bitmap).Size(size, size).Fit(ui.Cover) })
		return disc
	}
	from, to := t.Faint, t.Muted
	glyph := telegram.FirstGrapheme(name)
	if p := a.Placeholder; p != nil {
		colors := p.LightColors
		if t.Dark && len(p.DarkColors) > 0 {
			colors = p.DarkColors
		}
		if len(colors) > 0 {
			from, to = ui.Hex(colors[0]), ui.Hex(colors[len(colors)-1])
		}
		glyph = p.Glyph
	}
	disc.LinearGradient(ui.LinearGradient{From: to, To: from, Angle: 180})
	disc.Children(func() {
		ui.Text(c, glyph).FontSize(size * 0.42).FontWeight(600).TextColor(t.OnFill).SingleLine()
	})
	return disc
}

// OnlineDot marks an avatar online: a green dot ringed in the surface
// color, at the avatar's lower right.
func OnlineDot(c *ui.Context, t theme.Tokens, ring ui.Color, size float32) ui.Element {
	return ui.Box(c).Size(size, size).Radius(size/2).Background(t.Online).Border(2, ring).
		Attach(ui.AnchorBottomRight, ui.AnchorBottomRight).Right(0).Bottom(0)
}
