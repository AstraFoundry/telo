package settings

import (
	"context"
	"strings"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

type profileState struct {
	ready            bool
	first, last, bio string
	username         string
	checked          string
	available        tg.UsernameAvailability
	typedAt          time.Time
}

func (v *View) profilePane(c *ui.Context, p Props) {
	t, s, st := p.Tokens, p.Store, &v.profile
	u := s.User
	if !st.ready && u.ID != 0 {
		st.ready = true
		st.first, st.last, st.bio, st.username = u.FirstName, u.LastName, u.Bio, u.Username
	}
	kit.Card(c, t).Padding(16).Gap(14).AlignItems(ui.Center).Children(func() {
		ui.Row(c).Gap(14).AlignItems(ui.Center).Children(func() {
			kit.Avatar(c, t, p.Images, u.Avatar, u.DisplayName, 64, false)
			ui.Column(c).Gap(2).Grow(1).Children(func() {
				ui.Text(c, u.DisplayName).FontSize(theme.Heading).FontWeight(700)
				ui.Text(c, u.Phone).FontSize(theme.Callout).TextColor(t.Muted)
			})
			kit.SizedButton(c.Key("photo"), t, kit.Outline, kit.SizeSmall, icons.Camera, copy.T(copy.ProfileSetPhoto), true).OnClick(func() {
				files := p.Runtime.Desktop.PickFiles(copy.T(copy.ProfileSetPhoto), false, true)
				if len(files) == 0 {
					return
				}
				call(p, func(ctx context.Context, repo tg.Repository) error {
					_, err := repo.SetProfilePhoto(ctx, tg.UploadFile{Path: files[0]})
					return err
				}, nil)
			})
		})
	}).AlignItems(ui.Stretch)

	kit.Group(c, t, copy.T(copy.ProfileName), "", func() {
		ui.Column(c).Padding(12, 16).Gap(10).Children(func() {
			kit.Field(ui.TextInput(c.Key("first"), &st.first).Label(copy.T(copy.ProfileFirstName)).Placeholder(copy.T(copy.ProfileFirstName)), t)
			kit.Field(ui.TextInput(c.Key("last"), &st.last).Label(copy.T(copy.ProfileLastName)).Placeholder(copy.T(copy.ProfileLastName)), t)
			changed := strings.TrimSpace(st.first) != u.FirstName || strings.TrimSpace(st.last) != u.LastName
			ui.Row(c).Justify(ui.End).Children(func() {
				kit.SizedButton(c.Key("save-name"), t, kit.Primary, kit.SizeSmall, nil, copy.T(copy.Save), changed && strings.TrimSpace(st.first) != "").OnClick(func() {
					name := tg.ProfileName{FirstName: st.first, LastName: st.last}
					call(p, func(ctx context.Context, repo tg.Repository) error {
						_, err := repo.UpdateName(ctx, name)
						return err
					}, nil)
				})
			})
		})
	})

	kit.Group(c, t, copy.T(copy.ProfileBio), copy.T(copy.ProfileBioHint), func() {
		ui.Column(c).Padding(12, 16).Gap(10).Children(func() {
			input := kit.Field(ui.TextArea(c.Key("bio"), &st.bio).Lines(2, 4).Label(copy.T(copy.ProfileBio)), t)
			_ = input
			ui.Row(c).Justify(ui.End).Children(func() {
				kit.SizedButton(c.Key("save-bio"), t, kit.Primary, kit.SizeSmall, nil, copy.T(copy.Save), strings.TrimSpace(st.bio) != u.Bio).OnClick(func() {
					bio := st.bio
					call(p, func(ctx context.Context, repo tg.Repository) error { return repo.UpdateBio(ctx, bio) }, nil)
				})
			})
		})
	})

	v.usernameGroup(c, p)

	kit.Group(c, t, copy.T(copy.ProfilePhone), copy.T(copy.ProfileChangePhoneNote), func() {
		kit.Row(c, t, copy.T(copy.ProfileChangePhone), u.Phone, nil)
	})
	kit.Group(c, t, "", "", func() {
		kit.NavRow(c.Key("add"), t, icons.UserPlus, copy.T(copy.SettingsAddAccount), "").OnClick(func() {
			if p.AddAccount != nil {
				p.AddAccount()
			}
		})
		kit.Divider(c, t)
		out := kit.NavRow(c.Key("logout"), t, icons.SignOut, copy.T(copy.LogOut), "")
		out.TextColor(t.Danger)
		out.OnClick(func() {
			if p.LogOut != nil {
				p.LogOut()
			}
		})
	})
}

func (v *View) usernameGroup(c *ui.Context, p Props) {
	t, st, u := p.Tokens, &v.profile, p.Store.User
	name := strings.TrimPrefix(strings.TrimSpace(st.username), "@")
	hint := copy.T(copy.ProfileUsernameHint)
	if name != "" && name != u.Username && st.checked == name {
		switch st.available {
		case tg.UsernameAvailable:
			hint = copy.F(copy.ProfileUsernameAvailable, "@"+name)
		case tg.UsernameTaken:
			hint = copy.T(copy.ProfileUsernameTaken)
		case tg.UsernameInvalid:
			hint = copy.T(copy.ProfileUsernameInvalid)
		}
	}
	kit.Group(c, t, copy.T(copy.ProfileUsername), hint, func() {
		ui.Row(c).Padding(12, 16).Gap(10).AlignItems(ui.Center).Children(func() {
			in := ui.TextInput(c.Key("username"), &st.username).Label(copy.T(copy.ProfileUsername)).Placeholder(copy.T(copy.ProfileUsername))
			kit.Field(in, t).Grow(1)
			if in.Changed() {
				st.typedAt = p.Runtime.Clock()
			}
			ok := name == "" || st.checked == name && st.available == tg.UsernameAvailable
			kit.SizedButton(c.Key("save-username"), t, kit.Primary, kit.SizeSmall, nil, copy.T(copy.Save), name != u.Username && ok).OnClick(func() {
				call(p, func(ctx context.Context, repo tg.Repository) error {
					_, err := repo.SetUsername(ctx, name)
					return err
				}, nil)
			})
		})
	})
	// Telegram checks a name once typing pauses.
	if name != "" && name != u.Username && name != st.checked {
		if wait := 400*time.Millisecond - p.Runtime.Clock().Sub(st.typedAt); wait > 0 {
			c.After(wait)
			return
		}
		st.checked = name
		repo := p.Runtime.Repo()
		if repo == nil {
			return
		}
		p.Runtime.Go(func(ctx context.Context) func() {
			a, err := repo.CheckUsername(ctx, name)
			return func() {
				if err == nil && st.checked == name {
					st.available = a
				}
			}
		})
	}
}
