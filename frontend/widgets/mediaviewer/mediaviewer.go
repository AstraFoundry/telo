// Package mediaviewer shows a chat's photos full window over a dimmed
// backdrop: arrows step through the chat's media, the wheel and buttons
// zoom, and Save As keeps the file.
package mediaviewer

import (
	"fmt"
	"path/filepath"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Viewer keeps the message shown and the zoom.
type Viewer struct {
	open  bool
	chat  tg.ChatID
	id    tg.MessageID
	zoom  float32
	items []tg.Message
}

// Open shows a message's picture with the others the chat holds.
func (v *Viewer) Open(s *chat.Store, m tg.Message) {
	v.open, v.chat, v.id, v.zoom = true, m.ChatID, m.ID, 1
	v.items = nil
	for _, x := range s.Transcript(m.ChatID).Messages {
		if visual(x) {
			v.items = append(v.items, x)
		}
	}
	found := false
	for _, x := range v.items {
		found = found || x.ID == m.ID
	}
	if !found {
		v.items = append(v.items, m)
	}
}

// Open tells whether the viewer shows.
func (v *Viewer) Showing() bool { return v.open }

func visual(m tg.Message) bool {
	return m.Media != nil && (m.Media.Kind == tg.MediaPhoto || m.Media.Kind == tg.MediaVideo || m.Media.Kind == tg.MediaAnimation)
}

func (v *Viewer) index() int {
	for i, m := range v.items {
		if m.ID == v.id {
			return i
		}
	}
	return 0
}

func (v *Viewer) step(d int) {
	i := v.index() + d
	if i >= 0 && i < len(v.items) {
		v.id, v.zoom = v.items[i].ID, 1
	}
}

// Render draws the viewer over the window.
func (v *Viewer) Render(c *ui.Context, t theme.Tokens, rt *runtime.Runtime, s *chat.Store, images *media.Images) {
	if !v.open || len(v.items) == 0 {
		return
	}
	i := v.index()
	m := v.items[i]
	if fresh, ok := s.Message(m.ChatID, m.ID); ok {
		m = fresh
	}
	md := m.Media
	if md.Path == "" && md.FileID != 0 {
		s.Download(md.FileID)
	}
	if d, ok := s.Downloads[md.FileID]; ok && d.Path != "" {
		md.Path = d.Path
	}
	ui.Overlay(c, func() { v.layer(c, t, rt, s, images, i, m, md) })
	switch {
	case c.Shortcut(0, ui.KeyEscape):
		v.open = false
	case c.Shortcut(0, ui.KeyLeft):
		v.step(-1)
	case c.Shortcut(0, ui.KeyRight):
		v.step(1)
	}
}

func (v *Viewer) layer(c *ui.Context, t theme.Tokens, rt *runtime.Runtime, s *chat.Store, images *media.Images, i int, m tg.Message, md *tg.Media) {
	ink := ui.RGB(255, 255, 255)
	ui.Box(c.Key("viewer")).Absolute().Left(0).Top(0).Right(0).Bottom(0).Background(t.Scrim.Alpha(0.92)).Role(ui.RoleDialog).Label(copy.T(copy.MediaViewer)).
		Transition(ui.ElementTransition{Animation: &theme.Settle, Enter: &ui.Motion{Opacity: 0}, Exit: &ui.Motion{Opacity: 0}}).Children(func() {
		ui.Column(c).Fill().Children(func() {
			ui.Row(c).Height(52).Padding(0, 16).Gap(8).AlignItems(ui.Center).Children(func() {
				ui.Column(c).Grow(1).Gap(1).Children(func() {
					ui.Text(c, m.SenderName).FontSize(theme.Body).FontWeight(600).TextColor(ink)
					ui.Text(c, copy.F(copy.MediaOf, i+1, len(v.items))).FontSize(theme.Caption).TextColor(ink.Alpha(0.7))
				})
				button := func(key string, icon *ui.SVG, label string, do func()) {
					kit.IconButton(c.Key(key), t, icon, label).TextColor(ink).OnClick(do)
				}
				button("zoom-out", icons.Minus, copy.T(copy.ZoomOut), func() { v.zoom = max(0.5, v.zoom/1.25) })
				button("zoom-in", icons.Plus, copy.T(copy.ZoomIn), func() { v.zoom = min(4, v.zoom*1.25) })
				if md.Path != "" {
					path := md.Path
					button("save", icons.DownloadSimple, copy.T(copy.SaveFileAs), func() {
						name := md.FileName
						if name == "" {
							name = fmt.Sprintf("telo-%d%s", m.ID, filepath.Ext(path))
						}
						if to := rt.Desktop.SavePath(name); to != "" {
							if err := rt.Desktop.CopyFile(path, to); err != nil {
								s.Notify(err.Error(), true)
							}
						}
					})
					if md.Kind != tg.MediaPhoto {
						// Video plays in the system's player: MyGo draws stills.
						button("play", icons.Play, copy.T(copy.OpenFile), func() { _ = rt.Desktop.OpenFile(path) })
					}
				}
				button("close", icons.X, copy.T(copy.Close), func() { v.open = false })
			})
			ui.Row(c).Grow(1).AlignItems(ui.Center).Children(func() {
				nav := func(key string, icon *ui.SVG, label string, enabled bool, d int) {
					b := kit.IconButton(c.Key(key), t, icon, label).TextColor(ink).Margin(0, 12)
					if !enabled {
						b.Opacity(0.25).Disabled(true)
					}
					b.OnClick(func() { v.step(d) })
				}
				nav("prev", icons.CaretLeft, copy.T(copy.PreviousMedia), i > 0, -1)
				stage := ui.Box(c).Grow(1).Fill().Justify(ui.Center).AlignItems(ui.Center).Clip()
				stage.Children(func() {
					path := md.Path
					if md.Kind != tg.MediaPhoto {
						path = md.ThumbnailPath
					}
					var img *ui.Bitmap
					if path != "" {
						img = images.File(path)
					}
					if img == nil && len(md.Minithumbnail) > 0 {
						img = images.Bytes(md.Minithumbnail)
					}
					if img == nil {
						ui.Spinner(c).Size(28, 28)
						return
					}
					ui.Image(c, img).Fill().Fit(ui.Contain).Scale(v.zoom, v.zoom)
				})
				nav("next", icons.CaretRight, copy.T(copy.NextMedia), i < len(v.items)-1, 1)
			})
			if m.Body != "" {
				ui.Row(c).Padding(10, 24, 18, 24).Justify(ui.Center).Children(func() {
					ui.Text(c, m.Body).FontSize(theme.Callout).TextColor(ink).MaxLines(3).TextAlign(ui.Center)
				})
			}
		})
	})
}
