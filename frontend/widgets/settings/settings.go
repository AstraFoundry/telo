package settings

import (
	"context"
	"time"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/lib/timefmt"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Props is what the panes read and reach.
type Props struct {
	Tokens  theme.Tokens
	Runtime *runtime.Runtime
	Store   *chat.Store
	Images  *media.Images
	Formats timefmt.Formats
	Prefs   preferences.Preferences
	Mac     bool
	// Agent draws the agent pane; the agent feature owns it.
	Agent func(c *ui.Context)
	// AddAccount starts another account's sign-in.
	AddAccount func()
	// LogOut asks to sign the active account out.
	LogOut func()
	// Lock locks Telo now.
	Lock func()
}

// View keeps the panes' state between frames.
type View struct {
	profile  profileState
	privacy  privacyState
	data     dataState
	stickers stickersState
	folders  foldersState
	sessions sessionsState
	proxy    proxyState
	general  generalState
	notify   notifyState
	loaded   map[Section]bool
}

// update edits the preferences off the main thread.
func update(p Props, edit func(*preferences.Preferences)) {
	prefs := p.Runtime.Preferences
	p.Runtime.Go(func(ctx context.Context) func() {
		_, _ = prefs.Update(ctx, edit)
		return nil
	})
}

// load runs a pane's reads once each time it opens.
func (v *View) load(p Props, s Section, read func(ctx context.Context, repo tg.Repository) func()) {
	if v.loaded == nil {
		v.loaded = map[Section]bool{}
	}
	if v.loaded[s] {
		return
	}
	v.loaded[s] = true
	repo := p.Runtime.Repo()
	if repo == nil {
		return
	}
	p.Runtime.Go(func(ctx context.Context) func() { return read(ctx, repo) })
}

// Reload forgets what the panes read, for the next opening.
func (v *View) Reload() { v.loaded = nil }

// call runs one Telegram action and reports its failure as a toast.
func call(p Props, do func(ctx context.Context, repo tg.Repository) error, then func()) {
	repo := p.Runtime.Repo()
	if repo == nil {
		return
	}
	store := p.Store
	p.Runtime.Go(func(ctx context.Context) func() {
		err := do(ctx, repo)
		return func() {
			if err != nil {
				store.Notify(err.Error(), true)
				return
			}
			if then != nil {
				then()
			}
		}
	})
}

// Render draws one pane.
func (v *View) Render(c *ui.Context, p Props, s Section) {
	info, _ := SectionByID(s)
	ui.Scroll(c.Key(s)).Grow(1).Children(func() {
		ui.Column(c).Padding(28, 32, 40, 32).Gap(theme.GapGroup).MaxWidth(640).Children(func() {
			ui.Text(c, copy.T(info.Title)).FontSize(theme.Title).FontWeight(700).Role(ui.RoleHeading)
			switch s {
			case SectionProfile:
				v.profilePane(c, p)
			case SectionGeneral:
				v.generalPane(c, p)
			case SectionNotifications:
				v.notificationsPane(c, p)
			case SectionPrivacy:
				v.privacyPane(c, p)
			case SectionData:
				v.dataPane(c, p)
			case SectionAppearance:
				appearancePane(c, p)
			case SectionLanguage:
				languagePane(c, p)
			case SectionStickers:
				v.stickersPane(c, p)
			case SectionFolders:
				v.foldersPane(c, p)
			case SectionSessions:
				v.sessionsPane(c, p)
			case SectionProxy:
				v.proxyPane(c, p)
			case SectionAgent:
				if p.Agent != nil {
					p.Agent(c)
				}
			case SectionShortcuts:
				shortcutsPane(c, p)
			case SectionAbout:
				aboutPane(c, p)
			}
		})
	})
}

// choice is a labeled option of a select.
type choice[T comparable] struct {
	value T
	label copy.Key
}

func selectRow[T comparable](c *ui.Context, p Props, title copy.Key, value T, options []choice[T], set func(T)) {
	t := p.Tokens
	kit.Row(c, t, copy.T(title), "", func() {
		v := value
		values := make([]T, len(options))
		for i, o := range options {
			values[i] = o.value
		}
		name := func(x T) string {
			for _, o := range options {
				if o.value == x {
					return copy.T(o.label)
				}
			}
			return ""
		}
		if kit.Select(c.Key(title), t, &v, copy.T(title), values, name) {
			set(v)
		}
	})
}

func switchRow(c *ui.Context, p Props, title, detail copy.Key, value bool, set func(bool)) {
	v := value
	d := ""
	if detail != "" {
		d = copy.T(detail)
	}
	if kit.SwitchRow(c.Key(title), p.Tokens, &v, copy.T(title), d) {
		set(v)
	}
}

func ago(p Props, at time.Time) string { return p.Formats.Ago(at, p.Runtime.Clock()) }
