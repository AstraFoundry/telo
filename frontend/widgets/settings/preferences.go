package settings

import (
	"context"
	"strings"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/config"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

type generalState struct {
	editing      string
	title, body  string
	templateOpen bool
}

func (v *View) generalPane(c *ui.Context, p Props) {
	t, pr := p.Tokens, p.Prefs
	kit.Group(c, t, "", "", func() {
		selectRow(c, p, copy.GeneralSendWith, pr.SendWithEnter, []choice[bool]{{true, copy.GeneralEnter}, {false, copy.GeneralCmdEnter}},
			func(v bool) { update(p, func(x *preferences.Preferences) { x.SendWithEnter = v }) })
		kit.Divider(c, t)
		selectRow(c, p, copy.GeneralTimeFormat, pr.TimeFormat, []choice[preferences.TimeFormat]{{preferences.TimeSystem, copy.GeneralTimeSystem},
			{preferences.Time12h, copy.GeneralTime12}, {preferences.Time24h, copy.GeneralTime24}},
			func(v preferences.TimeFormat) { update(p, func(x *preferences.Preferences) { x.TimeFormat = v }) })
		kit.Divider(c, t)
		switchRow(c, p, copy.GeneralReduceMotion, copy.GeneralReduceMotionHint, pr.ReduceMotion,
			func(v bool) { update(p, func(x *preferences.Preferences) { x.ReduceMotion = v }) })
	})
	kit.Group(c, t, copy.T(copy.SettingsArchive), copy.T(copy.ArchiveKeepUnmutedHint), func() {
		switchRow(c, p, copy.ArchiveKeepUnmuted, "", pr.ArchiveKeepUnmuted,
			func(v bool) { update(p, func(x *preferences.Preferences) { x.ArchiveKeepUnmuted = v }) })
	})
	v.templates(c, p)
}

func (v *View) templates(c *ui.Context, p Props) {
	t, st := p.Tokens, &v.general
	kit.Group(c, t, copy.T(copy.GeneralTemplates), "", func() {
		for i, tpl := range p.Prefs.Templates {
			if i > 0 {
				kit.Divider(c, t)
			}
			id := tpl.ID
			kit.Row(c.Key(id), t, tpl.Title, oneLine(tpl.Body), func() {
				kit.IconButton(c.Key("edit"), t, icons.PencilSimple, copy.T(copy.Edit)).OnClick(func() {
					st.editing, st.title, st.body, st.templateOpen = id, tpl.Title, tpl.Body, true
				})
				kit.IconButton(c.Key("delete"), t, icons.Trash, copy.T(copy.Delete)).OnClick(func() {
					update(p, func(x *preferences.Preferences) {
						x.Templates = removeTemplate(x.Templates, id)
					})
				})
			})
		}
		if len(p.Prefs.Templates) > 0 {
			kit.Divider(c, t)
		}
		kit.NavRow(c.Key("new"), t, icons.Plus, copy.T(copy.Add), "").OnClick(func() {
			st.editing, st.title, st.body, st.templateOpen = "", "", "", true
		})
	})
	kit.Dialog(c, t, &st.templateOpen, 420, copy.T(copy.GeneralTemplates), "", func() {
		kit.Field(ui.TextInput(c.Key("title"), &st.title).AutoFocus().Label(copy.T(copy.FoldersName)).Placeholder(copy.T(copy.FoldersName)), t)
		kit.Field(ui.TextArea(c.Key("body"), &st.body).Lines(3, 8).Label(copy.T(copy.GeneralTemplates)), t)
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { st.templateOpen = false })
		ok := strings.TrimSpace(st.title) != "" && strings.TrimSpace(st.body) != "" && (st.editing != "" || len(p.Prefs.Templates) < preferences.TemplatesMax)
		kit.Button(c.Key("save"), t, kit.Primary, copy.T(copy.Save), ok).OnClick(func() {
			id, title, body := st.editing, st.title, st.body
			st.templateOpen = false
			update(p, func(x *preferences.Preferences) {
				if id == "" {
					x.Templates = append(x.Templates, preferences.Template{ID: preferences.NewID(), Title: title, Body: body})
					return
				}
				for i := range x.Templates {
					if x.Templates[i].ID == id {
						x.Templates[i].Title, x.Templates[i].Body = title, body
					}
				}
			})
		})
	})
}

func removeTemplate(ts []preferences.Template, id string) []preferences.Template {
	out := ts[:0:0]
	for _, x := range ts {
		if x.ID != id {
			out = append(out, x)
		}
	}
	return out
}

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

type notifyState struct{ resetOpen bool }

func (v *View) notificationsPane(c *ui.Context, p Props) {
	t, pr := p.Tokens, p.Prefs
	set := func(edit func(*preferences.Preferences)) { update(p, edit) }
	kit.Group(c, t, "", "", func() {
		switchRow(c, p, copy.NotifyDesktop, copy.NotifyDesktopHint, pr.Notifications, func(v bool) { set(func(x *preferences.Preferences) { x.Notifications = v }) })
	})
	kit.Group(c, t, copy.T(copy.NotifyMessages), "", func() {
		switchRow(c, p, copy.NotifyPrivate, "", pr.NotifyDirect, func(v bool) { set(func(x *preferences.Preferences) { x.NotifyDirect = v }) })
		kit.Divider(c, t)
		switchRow(c, p, copy.NotifyGroups, "", pr.NotifyGroups, func(v bool) { set(func(x *preferences.Preferences) { x.NotifyGroups = v }) })
		kit.Divider(c, t)
		switchRow(c, p, copy.NotifyChannels, "", pr.NotifyChannels, func(v bool) { set(func(x *preferences.Preferences) { x.NotifyChannels = v }) })
	})
	kit.Group(c, t, copy.T(copy.NotifyPreviewTitle), "", func() {
		switchRow(c, p, copy.NotifySender, "", pr.NotifySender, func(v bool) { set(func(x *preferences.Preferences) { x.NotifySender = v }) })
		kit.Divider(c, t)
		switchRow(c, p, copy.NotifyPreview, "", pr.NotifyPreview, func(v bool) { set(func(x *preferences.Preferences) { x.NotifyPreview = v }) })
		kit.Divider(c, t)
		switchRow(c, p, copy.NotifySound, "", pr.NotifySound, func(v bool) { set(func(x *preferences.Preferences) { x.NotifySound = v }) })
	})
	kit.Group(c, t, copy.T(copy.NotifyBadge), "", func() {
		switchRow(c, p, copy.NotifyCountMuted, "", pr.CountMuted, func(v bool) { set(func(x *preferences.Preferences) { x.CountMuted = v }) })
	})
	st := &v.notify
	kit.Group(c, t, "", "", func() {
		r := kit.NavRow(c.Key("reset"), t, icons.ArrowClockwise, copy.T(copy.NotifyReset), "")
		r.TextColor(t.Danger)
		r.OnClick(func() { st.resetOpen = true })
	})
	kit.Dialog(c, t, &st.resetOpen, 380, copy.T(copy.NotifyReset), copy.T(copy.NotifyResetConfirm), nil, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { st.resetOpen = false })
		kit.Button(c.Key("reset"), t, kit.Destructive, copy.T(copy.NotifyReset), true).OnClick(func() {
			st.resetOpen = false
			store := p.Store
			call(p, func(ctx context.Context, repo tg.Repository) error { return repo.ResetNotifications(ctx) },
				func() { store.Notify(copy.T(copy.NotifyResetDone), false) })
		})
	})
}

func appearancePane(c *ui.Context, p Props) {
	t, pr := p.Tokens, p.Prefs
	kit.Group(c, t, copy.T(copy.AppearanceTheme), copy.T(copy.AppearanceAutoNightHint), func() {
		ui.Row(c).Padding(12, 16).Children(func() {
			themes := []preferences.Theme{preferences.ThemeSystem, preferences.ThemeLight, preferences.ThemeDark}
			chosen := 0
			for i, x := range themes {
				if x == pr.Theme {
					chosen = i
				}
			}
			before := chosen
			kit.Segmented(c.Key("theme"), t, &chosen, []string{copy.T(copy.AppearanceAutoNight), copy.T(copy.AppearanceLight), copy.T(copy.AppearanceDark)})
			if chosen != before {
				next := themes[chosen]
				update(p, func(x *preferences.Preferences) { x.Theme = next })
			}
		})
	})
	kit.Group(c, t, copy.T(copy.AppearanceAccent), "", func() {
		ui.Row(c).Padding(14, 16).Gap(12).Children(func() {
			names := map[preferences.Accent]copy.Key{preferences.AccentBlue: copy.AccentBlue, preferences.AccentGreen: copy.AccentGreen,
				preferences.AccentPurple: copy.AccentPurple, preferences.AccentRed: copy.AccentRed, preferences.AccentOrange: copy.AccentOrange}
			for _, a := range preferences.Accents {
				swatch := theme.Resolve(t.Dark, a).Accent
				// The chosen color wears a ring with a gap of the card's color.
				b := ui.ButtonBase(c.Key(a)).Size(32, 32).Radius(16).Padding(3).Label(copy.T(names[a])).Tooltip(copy.T(names[a]))
				if a == pr.Accent {
					b.Border(2, swatch)
				}
				b.Children(func() { ui.Box(c).Grow(1).Radius(13).Background(swatch) })
				accent := a
				b.OnClick(func() { update(p, func(x *preferences.Preferences) { x.Accent = accent }) })
			}
		})
	})
	kit.Group(c, t, copy.T(copy.AppearanceTextSize), "", func() {
		ui.Row(c).Padding(12, 16).Gap(12).AlignItems(ui.Center).Children(func() {
			ui.Text(c, "A").FontSize(12).TextColor(t.Muted)
			size := float64(pr.TextSize)
			if ui.Slider(c.Key("size"), &size, preferences.TextSizeMin, preferences.TextSizeMax).Step(1).Label(copy.T(copy.AppearanceTextSize)).Grow(1).Changed() {
				n := int(size)
				update(p, func(x *preferences.Preferences) { x.TextSize = n })
			}
			ui.Text(c, "A").FontSize(18).TextColor(t.Muted)
		})
		kit.Divider(c, t)
		ui.Column(c).Padding(12, 16).Gap(6).Background(t.Canvas).Children(func() {
			bubble := func(text string, out bool) {
				side := ui.Start
				if out {
					side = ui.End
				}
				ui.Row(c).Justify(side).Children(func() {
					b := ui.Box(c).Padding(7, 12).Radius(theme.RadiusBubble)
					if out {
						b.Background(t.BubbleOut)
					} else {
						b.Background(t.BubbleIn).Border(1, t.CardBorder)
					}
					b.Children(func() {
						tx := ui.Text(c, text).FontSize(float32(pr.TextSize))
						if out {
							tx.TextColor(t.BubbleOutText)
						}
					})
				})
			}
			bubble(copy.T(copy.AppearancePreviewIn), false)
			bubble(copy.T(copy.AppearancePreviewOut), true)
		})
	})
	kit.Group(c, t, "", "", func() {
		selectRow(c, p, copy.AppearanceWallpaper, pr.Wallpaper, []choice[preferences.Wallpaper]{{preferences.WallpaperPlain, copy.WallpaperPlain},
			{preferences.WallpaperDots, copy.WallpaperDots}, {preferences.WallpaperGrid, copy.WallpaperGrid}, {preferences.WallpaperGradient, copy.WallpaperGradient}},
			func(v preferences.Wallpaper) { update(p, func(x *preferences.Preferences) { x.Wallpaper = v }) })
	})
}

func languagePane(c *ui.Context, p Props) {
	t := p.Tokens
	kit.Group(c, t, "", copy.T(copy.LanguageNote), func() {
		kit.Row(c, t, copy.T(copy.LanguageCurrent), "", func() { ui.Icon(c, icons.Check).FontSize(16).TextColor(t.AccentInk) })
	})
}

func shortcutsPane(c *ui.Context, p Props) {
	t := p.Tokens
	for _, group := range config.ShortcutGroups() {
		kit.Group(c, t, copy.T(group.Title), "", func() {
			for i, s := range group.Shortcuts {
				if i > 0 {
					kit.Divider(c, t)
				}
				kit.Row(c.Key(s.Action), t, copy.T(s.Title), "", func() {
					kit.KbdGroup(c).Children(func() {
						for _, k := range config.Keys(s, p.Mac) {
							kit.Kbd(c, t, k)
						}
					})
				})
			}
		})
	}
}

func aboutPane(c *ui.Context, p Props) {
	t, info := p.Tokens, p.Runtime.Info
	kit.Card(c, t).Padding(20).Gap(10).AlignItems(ui.Center).Children(func() {
		kit.Mark(c, 72)
		ui.Text(c, copy.T(copy.AppName)).FontSize(theme.Title).FontWeight(700)
		ui.Text(c, copy.F(copy.AboutVersion, info.Version)).FontSize(theme.Callout).TextColor(t.Muted)
		ui.Text(c, copy.F(copy.AboutTDLib, info.TDLib)).FontSize(theme.Caption).TextColor(t.Muted)
		ui.Text(c, copy.T(copy.AboutNotice)).FontSize(theme.Caption).TextColor(t.Muted).TextAlign(ui.Center)
	})
	kit.Group(c, t, "", "", func() {
		for i, link := range []struct {
			key copy.Key
			url string
		}{{copy.AboutSource, config.SourceURL}, {copy.SettingsFAQ, config.FAQURL}} {
			if i > 0 {
				kit.Divider(c, t)
			}
			url := link.url
			kit.NavRow(c.Key(link.key), t, icons.ArrowSquareOut, copy.T(link.key), "").OnClick(func() { _ = p.Runtime.Desktop.OpenURL(url) })
		}
	})
}
