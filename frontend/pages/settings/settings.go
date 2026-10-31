// Package settings is the Settings page: as in telegram-macos, the left
// column turns into the settings list, with search over every setting, and
// the right shows the chosen pane.
package settings

import (
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	panes "github.com/AstraFoundry/telo/frontend/widgets/settings"
	"github.com/egoist/mygo/ui"
)

// Page keeps the page's state.
type Page struct {
	Section panes.Section
	Query   string
	view    panes.View
	search  ui.Handle
}

// Open shows a pane; the zero section opens the profile.
func (p *Page) Open(s panes.Section) {
	if s == "" {
		s = panes.SectionProfile
	}
	if s != p.Section {
		p.view.Reload()
	}
	p.Section = s
}

// FocusSearch puts the keyboard in the settings search.
func (p *Page) FocusSearch() { p.search.Focus() }

// Render draws the page; back returns to the chats.
func (p *Page) Render(c *ui.Context, props panes.Props, back func()) {
	t := props.Tokens
	if p.Section == "" {
		p.Section = panes.SectionProfile
	}
	bar := c.TitleBar()
	ui.Row(c).Fill().AlignItems(ui.Stretch).Background(t.Canvas).Children(func() {
		ui.Column(c).Width(props.Prefs.SidebarWidth).Shrink(0).Background(t.Sidebar).BorderWidth(0, 1, 0, 0).BorderColor(t.Hairline).Children(func() {
			top := max(bar.Height, 28)
			ui.Row(c).Height(top+18).Padding(top-24, 10, 0, max(bar.Left+6, 10)).Gap(6).AlignItems(ui.Center).DragWindow().Children(func() {
				kit.IconButton(c.Key("back"), t, icons.ArrowLeft, copy.T(copy.Back)).OnClick(back)
				ui.Text(c, copy.T(copy.Settings)).FontSize(theme.Heading).FontWeight(700).Grow(1)
			})
			ui.Row(c).Padding(0, 10, 8, 10).Children(func() {
				in := kit.SearchBox(c, t, &p.Query, copy.T(copy.SearchSettings)).Bind(&p.search)
				if in.Shortcut(0, ui.KeyEscape) {
					p.Query = ""
				}
			})
			ui.Scroll(c).Grow(1).Children(func() {
				ui.Column(c).Padding(0, 8, 12, 8).Gap(10).Children(func() {
					if p.Query != "" {
						p.results(c, props)
						return
					}
					for gi, group := range panes.Sections {
						ui.Column(c.Key(gi)).Gap(1).Children(func() {
							for _, s := range group {
								p.navItem(c, props, s)
							}
						})
					}
				})
			})
		})
		ui.Column(c).Grow(1).Shrink(1).Children(func() {
			ui.Box(c).Height(max(bar.Height, 28)).DragWindow()
			p.view.Render(c, props, p.Section)
		})
	})
	if c.Shortcut(0, ui.KeyEscape) && p.Query == "" {
		back()
	}
}

func (p *Page) navItem(c *ui.Context, props panes.Props, s panes.SectionInfo) {
	t := props.Tokens
	active := p.Section == s.ID
	row := ui.ButtonBase(c.Key(s.ID)).Height(36).Padding(0, 10).Gap(10).Radius(theme.RadiusLG).AlignItems(ui.Center).Label(copy.T(s.Title))
	ink := t.Text
	switch {
	case active:
		row.Background(t.Selection)
		ink = t.SelectionText
	case row.Hovered():
		row.Background(t.Subtle)
	}
	row.Children(func() {
		if s.ID == panes.SectionProfile {
			u := props.Store.User
			kit.Avatar(c, t, props.Images, u.Avatar, u.DisplayName, 24, false)
			ui.Text(c, u.DisplayName).FontSize(theme.Body).FontWeight(600).TextColor(ink).Grow(1).SingleLine()
			return
		}
		ui.Icon(c, s.Icon).FontSize(17).TextColor(ink)
		ui.Text(c, copy.T(s.Title)).FontSize(theme.Body).TextColor(ink).Grow(1).SingleLine()
	})
	row.OnClick(func() { p.Open(s.ID) })
}

func (p *Page) results(c *ui.Context, props panes.Props) {
	t := props.Tokens
	hits := panes.Search(p.Query)
	if len(hits) == 0 {
		kit.Empty(c, t, icons.MagnifyingGlass, copy.T(copy.NoSettingsMatch))
		return
	}
	for i, e := range hits {
		s, _ := panes.SectionByID(e.Section)
		row := ui.ButtonBase(c.Key(i)).Padding(6, 10).Gap(10).Radius(theme.RadiusLG).AlignItems(ui.Center).Label(copy.T(e.Label))
		if row.Hovered() {
			row.Background(t.Subtle)
		}
		row.Children(func() {
			ui.Icon(c, s.Icon).FontSize(16).TextColor(t.Muted)
			ui.Column(c).Grow(1).Gap(1).Children(func() {
				ui.Text(c, copy.T(e.Label)).FontSize(theme.Body).SingleLine()
				ui.Text(c, copy.T(s.Title)).FontSize(theme.Caption).TextColor(t.Muted).SingleLine()
			})
		})
		section := e.Section
		row.OnClick(func() {
			p.Query = ""
			p.Open(section)
		})
	}
}
