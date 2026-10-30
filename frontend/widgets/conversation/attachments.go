package conversation

import (
	"context"
	"fmt"
	"math"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// autoDownloads tells whether a kind fetches itself as it shows.
func autoDownloads(p Props, k tg.MediaKind) bool {
	switch k {
	case tg.MediaPhoto, tg.MediaSticker:
		return p.Prefs.AutoPhotos || k == tg.MediaSticker
	case tg.MediaVideo, tg.MediaAnimation, tg.MediaVideoNote:
		return p.Prefs.AutoVideos
	}
	return p.Prefs.AutoFiles
}

// fitted sizes a picture of w×h into maxW×maxH, keeping its aspect.
func fitted(w, h int, maxW, maxH float32) (float32, float32) {
	if w <= 0 || h <= 0 {
		return maxW, maxW * 0.75
	}
	scale := float32(math.Min(float64(maxW)/float64(w), float64(maxH)/float64(h)))
	scale = min(scale, 1.5)
	return max(120, float32(w)*scale), max(80, float32(h)*scale)
}

func (v *View) attachment(c *ui.Context, p Props, m tg.Message, ink, meta ui.Color) {
	md := m.Media
	switch md.Kind {
	case tg.MediaPhoto, tg.MediaVideo, tg.MediaAnimation, tg.MediaVideoNote:
		w, h := fitted(md.Width, md.Height, 320, 360)
		if md.Kind == tg.MediaVideoNote {
			w, h = 220, 220
		}
		picture(c, p, m, w, h)
	case tg.MediaSticker:
		sticker(c, p, m)
	case tg.MediaVoice, tg.MediaAudio:
		v.voice(c, p, m, ink, meta)
	case tg.MediaWebPage:
		webPage(c, p, m, ink, meta)
	case tg.MediaLocation:
		location(c, p, m, ink, meta)
	case tg.MediaContact:
		contact(c, p, m, ink, meta)
	default:
		document(c, p, m, ink, meta)
	}
}

// download is a file's state: its path when ready, its progress while it
// downloads.
func download(p Props, file tg.FileID, path string) (string, *tg.MediaDownload) {
	if path != "" {
		return path, nil
	}
	if d, ok := p.Store.Downloads[file]; ok {
		if d.State == tg.TransferDone {
			return d.Path, nil
		}
		return "", &d
	}
	return "", nil
}

// picture draws a photo or a video's first frame: the file when it is
// local, else TDLib's minithumbnail blurred under a download control.
func picture(c *ui.Context, p Props, m tg.Message, w, h float32) {
	t, s := p.Tokens, p.Store
	md := m.Media
	path, d := download(p, md.FileID, md.Path)
	if path == "" && d == nil && autoDownloads(p, md.Kind) && md.Kind == tg.MediaPhoto {
		s.Download(md.FileID)
	}
	radius := float32(theme.RadiusBubble - 2)
	if md.Kind == tg.MediaVideoNote {
		radius = w / 2
	}
	frame := ui.ButtonBase(c.Key("picture")).Size(w, h).Radius(radius).Clip().Background(t.Subtle).Justify(ui.Center).AlignItems(ui.Center).Label(mediaName(md))
	frame.Children(func() {
		var bitmap *ui.Bitmap
		if md.Kind == tg.MediaPhoto {
			bitmap = p.Images.File(path)
		}
		if bitmap == nil && md.ThumbnailPath != "" {
			bitmap = p.Images.File(md.ThumbnailPath)
		}
		blurred := false
		if bitmap == nil {
			bitmap = p.Images.Bytes(md.Minithumbnail)
			blurred = bitmap != nil
		}
		if bitmap != nil {
			img := ui.Image(c, bitmap).Absolute().Top(0).Left(0).Right(0).Bottom(0).Fit(ui.Cover)
			if blurred || md.Spoiler {
				img.Blur(12)
			}
		}
		switch {
		case d != nil && d.State == tg.TransferRunning:
			overlayButton(c, t, icons.X, copy.T(copy.CancelDownload), d).OnClick(func() { s.CancelDownload(md.FileID) })
		case path == "" && md.Kind == tg.MediaPhoto:
			overlayButton(c, t, icons.DownloadSimple, copy.T(copy.DownloadMedia), nil).OnClick(func() { s.Download(md.FileID) })
		case md.Kind != tg.MediaPhoto:
			overlayButton(c, t, icons.Play, copy.T(copy.OpenFile), d)
			if md.Duration > 0 {
				ui.Row(c).Padding(1, 6).Radius(theme.RadiusPill).Background(t.Scrim.Alpha(0.5)).Attach(ui.AnchorTopLeft, ui.AnchorTopLeft).Top(6).Left(6).Children(func() {
					ui.Text(c, copy.Duration(md.Duration)).FontSize(theme.Caption).TextColor(ui.RGB(255, 255, 255)).FontFeatures("tnum")
				})
			}
		}
	})
	frame.OnClick(func() {
		switch {
		case md.Kind == tg.MediaPhoto && path != "":
			if p.OpenMedia != nil {
				p.OpenMedia(m)
			}
		case path != "":
			if err := p.Runtime.Desktop.OpenFile(path); err != nil {
				s.Notify(err.Error(), true)
			}
		default:
			s.Download(md.FileID)
		}
	})
}

// overlayButton is the round control over a picture: download, cancel
// with the progress ring, or play.
func overlayButton(c *ui.Context, t theme.Tokens, icon *ui.SVG, label string, d *tg.MediaDownload) ui.Element {
	b := ui.ButtonBase(c.Key("overlay")).Size(44, 44).Radius(22).Background(t.Scrim.Alpha(0.55)).Justify(ui.Center).AlignItems(ui.Center).Label(label)
	b.Children(func() {
		if d != nil && d.Total > 0 {
			progress := float32(d.Downloaded) / float32(d.Total)
			ui.Box(c).Absolute().Top(0).Left(0).Right(0).Bottom(0).PassThrough().Draw(func(p *ui.Painter, r ui.Rect) {
				var pts [][2]float32
				cx, cy, rad := r.X+r.W/2, r.Y+r.H/2, r.W/2-3
				for i := 0; i <= 48; i++ {
					a := -math.Pi/2 + 2*math.Pi*float64(progress)*float64(i)/48
					pts = append(pts, [2]float32{cx + rad*float32(math.Cos(a)), cy + rad*float32(math.Sin(a))})
				}
				p.StrokePolyline(pts, 2.5, ui.RGB(255, 255, 255))
			})
		}
		ui.Icon(c, icon).FontSize(20).TextColor(ui.RGB(255, 255, 255))
	})
	return b
}

// albumGrid lays an album out in rows of up to three.
func albumGrid(c *ui.Context, p Props, album []tg.Message) {
	const width = 320
	ui.Column(c).Gap(2).Width(width).Children(func() {
		for start := 0; start < len(album); start += 3 {
			end := min(len(album), start+3)
			n := end - start
			ui.Row(c.Key(start)).Gap(2).Children(func() {
				for _, m := range album[start:end] {
					w := (width - float32(n-1)*2) / float32(n)
					ui.Box(c.Key(m.ID)).Children(func() { picture(c, p, m, w, w*0.8) })
				}
			})
		}
	})
}

func sticker(c *ui.Context, p Props, m tg.Message) {
	t, s := p.Tokens, p.Store
	md := m.Media
	size := float32(180)
	if md.Sticker != nil && md.Sticker.Role == tg.RoleEmoji {
		size = 112
	}
	path, _ := download(p, md.FileID, md.Path)
	if path == "" {
		s.Download(md.FileID)
	}
	box := ui.ButtonBase(c.Key("sticker")).Size(size, size).Justify(ui.Center).AlignItems(ui.Center).Label(copy.T(copy.Sticker))
	box.Children(func() {
		if b := p.Images.File(path); b != nil {
			ui.Image(c, b).Size(size, size).Fit(ui.Contain)
			return
		}
		if md.Sticker != nil {
			ui.Text(c, md.Sticker.Emoji).FontSize(size * 0.45).TextColor(t.Faint)
		}
	})
	if md.Sticker != nil && md.Sticker.Role == tg.RoleEmoji {
		box.OnClick(func() { s.ClickEmoji(m.ChatID, m.ID) })
	}
}

func document(c *ui.Context, p Props, m tg.Message, ink, meta ui.Color) {
	t, s := p.Tokens, p.Store
	md := m.Media
	path, d := download(p, md.FileID, md.Path)
	if path == "" && d == nil && autoDownloads(p, md.Kind) {
		s.Download(md.FileID)
	}
	row := ui.ButtonBase(c.Key("file")).Gap(10).MinWidth(220).AlignItems(ui.Center).Label(md.FileName)
	row.Children(func() {
		tile := ui.Row(c).Size(42, 42).Radius(21).Background(ifColor(m.Outgoing, ink.Alpha(0.2), t.Accent)).Justify(ui.Center).AlignItems(ui.Center)
		tile.Children(func() {
			icon := icons.FileText
			switch {
			case d != nil && d.State == tg.TransferRunning:
				icon = icons.X
			case path == "":
				icon = icons.DownloadSimple
			}
			ui.Icon(c, icon).FontSize(20).TextColor(ifColor(m.Outgoing, ink, t.AccentText))
		})
		ui.Column(c).Gap(2).Shrink(1).Children(func() {
			name := md.FileName
			if name == "" {
				name = mediaName(md)
			}
			ui.Text(c, name).FontSize(theme.Body).FontWeight(600).SingleLine()
			size := copy.Bytes(md.Size)
			if d != nil && d.Total > 0 && d.State == tg.TransferRunning {
				size = copy.Bytes(d.Downloaded) + " / " + copy.Bytes(d.Total)
			}
			ui.Text(c, size).FontSize(theme.Caption).TextColor(meta).FontFeatures("tnum")
		})
	})
	row.OnClick(func() {
		switch {
		case d != nil && d.State == tg.TransferRunning:
			s.CancelDownload(md.FileID)
		case path == "":
			s.Download(md.FileID)
		default:
			if err := p.Runtime.Desktop.OpenFile(path); err != nil {
				s.Notify(err.Error(), true)
			}
		}
	})
}

// voice draws a voice message: play, its waveform and duration. Telegram
// records Opus, which MyGo's audio does not decode, so play opens the
// file with the system's player.
func (v *View) voice(c *ui.Context, p Props, m tg.Message, ink, meta ui.Color) {
	t, s := p.Tokens, p.Store
	md := m.Media
	path, d := download(p, md.FileID, md.Path)
	ui.Row(c).Gap(10).MinWidth(220).AlignItems(ui.Center).Children(func() {
		play := ui.ButtonBase(c.Key("play")).Size(40, 40).Radius(20).Background(ifColor(m.Outgoing, ink, t.Accent)).Justify(ui.Center).AlignItems(ui.Center).Label(copy.T(copy.PlayVoice))
		kit.Press(play)
		play.Children(func() {
			icon := icons.Play
			if path == "" && (d == nil || d.State != tg.TransferRunning) {
				icon = icons.DownloadSimple
			}
			ui.Icon(c, icon).FontSize(18).TextColor(ifColor(m.Outgoing, t.BubbleOut, t.AccentText))
		})
		play.OnClick(func() {
			if path == "" {
				s.Download(md.FileID)
				return
			}
			if err := p.Runtime.Desktop.OpenFile(path); err != nil {
				s.Notify(err.Error(), true)
			}
		})
		ui.Column(c).Gap(3).Children(func() {
			if md.Kind == tg.MediaAudio && (md.Title != "" || md.Performer != "") {
				ui.Text(c, md.Title).FontSize(theme.Body).FontWeight(600).SingleLine()
				ui.Text(c, md.Performer).FontSize(theme.Caption).TextColor(meta).SingleLine()
			} else {
				waveform(c, md.Waveform, ifColor(m.Outgoing, ink.Alpha(0.7), t.Accent))
			}
			ui.Text(c, copy.Duration(md.Duration)).FontSize(theme.Caption).TextColor(meta).FontFeatures("tnum")
		})
	})
}

// waveform draws Telegram's 5-bit packed voice levels as bars.
func waveform(c *ui.Context, packed []byte, color ui.Color) {
	levels := unpackWaveform(packed, 40)
	ui.Box(c).Size(40*3.5, 22).Draw(func(p *ui.Painter, r ui.Rect) {
		for i, l := range levels {
			h := max(2, r.H*float32(l)/31)
			p.Fill(ui.Rect{X: r.X + float32(i)*3.5, Y: r.Y + r.H - h, W: 2, H: h}, color, 1)
		}
	})
}

// unpackWaveform reads n levels of 0–31 from TDLib's 5-bit packing, or
// spreads raw bytes over n bars.
func unpackWaveform(packed []byte, n int) []int {
	total := len(packed) * 8 / 5
	out := make([]int, n)
	if total == 0 {
		return out
	}
	for i := 0; i < n; i++ {
		k := i * total / n
		bit := k * 5
		v := 0
		for b := 0; b < 5; b++ {
			byteIndex, offset := (bit+b)/8, (bit+b)%8
			if byteIndex < len(packed) && packed[byteIndex]&(1<<offset) != 0 {
				v |= 1 << b
			}
		}
		out[i] = v
	}
	return out
}

func webPage(c *ui.Context, p Props, m tg.Message, ink, meta ui.Color) {
	t := p.Tokens
	wp := m.Media.WebPage
	if wp == nil {
		return
	}
	bar := t.Accent
	if m.Outgoing {
		bar = ink
	}
	card := ui.ButtonBase(c.Key("webpage")).Gap(8).Padding(6, 8, 6, 0).Radius(theme.RadiusMD).Background(bar.Alpha(0.08)).Label(wp.URL)
	card.Children(func() {
		ui.Box(c).Width(3).Radius(theme.RadiusXS).Background(bar).AlignSelf(ui.Stretch)
		ui.Column(c).Gap(3).Shrink(1).Children(func() {
			if wp.SiteName != "" {
				ui.Text(c, wp.SiteName).FontSize(theme.Callout).FontWeight(600).TextColor(ifColor(m.Outgoing, ink, t.AccentInk)).SingleLine()
			}
			if wp.Title != "" {
				ui.Text(c, wp.Title).FontSize(theme.Callout).FontWeight(600).MaxLines(2)
			}
			if wp.Description != "" {
				ui.Text(c, wp.Description).FontSize(theme.Callout).MaxLines(3).Opacity(0.9)
			}
			if wp.Photo != nil {
				w, h := fitted(wp.Photo.Width, wp.Photo.Height, 280, 200)
				picture(c, p, tg.Message{ChatID: m.ChatID, ID: m.ID, Media: wp.Photo}, w, h)
			}
		})
	})
	url := wp.URL
	card.OnClick(func() { p.OpenLink(url) })
}

func location(c *ui.Context, p Props, m tg.Message, ink, meta ui.Color) {
	t := p.Tokens
	loc := m.Media.Location
	if loc == nil {
		return
	}
	card := ui.ButtonBase(c.Key("location")).Gap(10).MinWidth(220).AlignItems(ui.Center).Label(copy.T(copy.Location))
	card.Children(func() {
		disc := ui.Row(c).Size(40, 40).Radius(20).Background(t.Danger.Alpha(0.14)).Justify(ui.Center).AlignItems(ui.Center)
		disc.Children(func() { ui.Icon(c, icons.MapPin).FontSize(20).TextColor(t.Danger) })
		ui.Column(c).Gap(2).Children(func() {
			title := loc.Title
			if title == "" {
				title = copy.T(copy.Location)
			}
			ui.Text(c, title).FontSize(theme.Body).FontWeight(600).SingleLine()
			detail := loc.Address
			if detail == "" {
				detail = fmt.Sprintf("%.5f, %.5f", loc.Latitude, loc.Longitude)
			}
			ui.Text(c, detail).FontSize(theme.Caption).TextColor(meta).SingleLine()
		})
	})
	lat, lon := loc.Latitude, loc.Longitude
	card.OnClick(func() {
		p.OpenLink(fmt.Sprintf("https://www.openstreetmap.org/?mlat=%f&mlon=%f#map=16/%f/%f", lat, lon, lat, lon))
	})
}

func contact(c *ui.Context, p Props, m tg.Message, ink, meta ui.Color) {
	t, s := p.Tokens, p.Store
	sc := m.Media.Contact
	if sc == nil {
		return
	}
	ui.Row(c).Gap(10).MinWidth(220).AlignItems(ui.Center).Children(func() {
		kit.Avatar(c, t, p.Images, tg.Avatar{Placeholder: tg.Placeholder(sc.Name, int(sc.UserID%7))}, sc.Name, 40, false)
		ui.Column(c).Gap(2).Grow(1).Children(func() {
			ui.Text(c, sc.Name).FontSize(theme.Body).FontWeight(600).SingleLine()
			ui.Text(c, sc.Phone).FontSize(theme.Caption).TextColor(meta).SingleLine()
		})
		if sc.UserID != 0 {
			user := sc.UserID
			kit.SizedButton(c.Key("open"), t, kit.Ghost, kit.SizeSmall, nil, copy.T(copy.SendMessageAction), true).OnClick(func() { s.OpenPrivate(user) })
		}
	})
}

// answer runs a callback button and shows the bot's answer.
func answer(p Props, ch tg.Chat, m tg.Message, b tg.Button) {
	s, rt := p.Store, p.Runtime
	repo := rt.Repo()
	if repo == nil {
		return
	}
	rt.Go(func(ctx context.Context) func() {
		a, err := repo.AnswerCallback(ctx, ch.ID, m.ID, b.ID)
		return func() {
			switch {
			case err != nil:
				s.Notify(copy.T(copy.BotNoAnswer), true)
			case a.URL != "":
				p.OpenLink(a.URL)
			case a.Text != "":
				s.Notify(a.Text, false)
			}
		}
	})
}
