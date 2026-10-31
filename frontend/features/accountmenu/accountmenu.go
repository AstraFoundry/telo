// Package accountmenu is the menu behind the account picture and the
// compose button: the accounts, the profile, Saved Messages, contacts,
// calls, and creating groups, channels, secret chats, contacts and
// stories, with the dialogs they open.
package accountmenu

import (
	"context"
	"slices"
	"strings"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/lib/timefmt"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Env is what the menu reaches.
type Env struct {
	Tokens  theme.Tokens
	Runtime *runtime.Runtime
	Store   *chat.Store
	Images  *media.Images
	Formats timefmt.Formats
	// OpenSettings opens Settings at the profile ("" for the list).
	OpenSettings func(profile bool)
	AddAccount   func()
	LogOut       func()
	SwitchTo     func(id tg.AccountID)
}

type dialog int

const (
	none dialog = iota
	contactsDialog
	callsDialog
	groupDialog
	channelDialog
	secretDialog
	contactDialog
	storyDialog
)

// State keeps the open dialog and its fields.
type State struct {
	open               dialog
	visible            bool
	contacts           []tg.Contact
	calls              []tg.CallRecord
	query              string
	title, description string
	members            map[tg.UserID]bool
	first, last, phone string
	notOnTelegram      bool
	storyFile          string
	caption            string
	privacy            tg.StoryPrivacy
	period             int
	protect            bool
	busy               bool
}

func (s *State) show(env Env, d dialog) {
	*s = State{open: d, visible: true, contacts: s.contacts, members: map[tg.UserID]bool{}, privacy: tg.StoryEveryone, period: tg.StoryActivePeriods[2]}
	repo := env.Runtime.Repo()
	if repo == nil {
		return
	}
	switch d {
	case contactsDialog, groupDialog, secretDialog:
		env.Runtime.Go(func(ctx context.Context) func() {
			cs, err := repo.Contacts(ctx)
			return func() {
				if err == nil {
					s.contacts = cs
				}
			}
		})
	case callsDialog:
		env.Runtime.Go(func(ctx context.Context) func() {
			page, err := repo.Calls(ctx, "")
			return func() {
				if err == nil {
					s.calls = page.Items
				}
			}
		})
	}
}

// AccountMenu fills the account picture's menu.
func (s *State) AccountMenu(m *ui.Menu, env Env) {
	st := env.Store
	if m.Item(copy.T(copy.MyProfile)).Chosen() {
		env.OpenSettings(true)
	}
	m.Separator()
	for _, a := range st.Accounts.Accounts {
		id := a.ID
		label := a.DisplayName
		if a.UnreadCount > 0 {
			label += " · " + copy.Count(a.UnreadCount)
		}
		if m.Item(label).Checked(id == st.Accounts.Active).Chosen() && id != st.Accounts.Active {
			env.SwitchTo(id)
		}
	}
	if m.Item(copy.T(copy.SettingsAddAccount)).Disabled(len(st.Accounts.Accounts) >= tg.MaxAccounts).Chosen() {
		env.AddAccount()
	}
	m.Separator()
	if m.Item(copy.T(copy.SavedMessages)).Chosen() {
		st.OpenSaved()
	}
	if m.Item(copy.T(copy.Contacts)).Chosen() {
		s.show(env, contactsDialog)
	}
	if m.Item(copy.T(copy.Calls)).Chosen() {
		s.show(env, callsDialog)
	}
	m.Separator()
	s.ComposeMenu(m, env)
	if m.Item(copy.T(copy.NewStory)).Chosen() {
		s.show(env, storyDialog)
	}
	m.Separator()
	if m.Item(copy.T(copy.Settings)).Chosen() {
		env.OpenSettings(false)
	}
	if m.Item(copy.T(copy.LogOut)).Chosen() {
		env.LogOut()
	}
}

// ComposeMenu fills the new-message button's menu.
func (s *State) ComposeMenu(m *ui.Menu, env Env) {
	if m.Item(copy.T(copy.NewGroup)).Chosen() {
		s.show(env, groupDialog)
	}
	if m.Item(copy.T(copy.NewSecretChat)).Chosen() {
		s.show(env, secretDialog)
	}
	if m.Item(copy.T(copy.NewChannel)).Chosen() {
		s.show(env, channelDialog)
	}
	if m.Item(copy.T(copy.NewContact)).Chosen() {
		s.show(env, contactDialog)
	}
}

// open runs a creation and opens the chat it made.
func (s *State) create(env Env, make func(ctx context.Context, repo tg.Repository) (tg.Chat, error)) {
	repo := env.Runtime.Repo()
	if repo == nil {
		return
	}
	s.busy = true
	st := env.Store
	env.Runtime.Go(func(ctx context.Context) func() {
		c, err := make(ctx, repo)
		return func() {
			s.busy = false
			if err != nil {
				st.Notify(err.Error(), true)
				return
			}
			s.visible = false
			st.Adopt(c)
		}
	})
}

// Dialogs draws the open dialog.
func (s *State) Dialogs(c *ui.Context, env Env) {
	if s.open == none {
		return
	}
	t := env.Tokens
	cancel := func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { s.visible = false })
	}
	switch s.open {
	case contactsDialog:
		kit.Dialog(c, t, &s.visible, 420, copy.T(copy.Contacts), "", func() {
			s.contactList(c, env, func(ct tg.Contact) {
				s.visible = false
				env.Store.OpenPrivate(ct.ID)
			}, false)
		}, func() {
			kit.Button(c.Key("new"), t, kit.Outline, copy.T(copy.NewContact), true).OnClick(func() { s.show(env, contactDialog) })
			kit.Button(c.Key("close"), t, kit.Primary, copy.T(copy.Close), true).OnClick(func() { s.visible = false })
		})
	case callsDialog:
		kit.Dialog(c, t, &s.visible, 420, copy.T(copy.Calls), "", func() { s.callList(c, env) }, func() {
			kit.Button(c.Key("close"), t, kit.Primary, copy.T(copy.Close), true).OnClick(func() { s.visible = false })
		})
	case groupDialog:
		kit.Dialog(c, t, &s.visible, 440, copy.T(copy.NewGroup), "", func() {
			kit.Field(ui.TextInput(c.Key("title"), &s.title).AutoFocus().Label(copy.T(copy.GroupName)).Placeholder(copy.T(copy.GroupName)), t)
			kit.SectionTitle(c, t, copy.T(copy.AddMembers))
			s.contactList(c, env, nil, true)
		}, func() {
			cancel()
			var ids []tg.UserID
			for id, on := range s.members {
				if on {
					ids = append(ids, id)
				}
			}
			slices.Sort(ids)
			title := strings.TrimSpace(s.title)
			kit.Button(c.Key("create"), t, kit.Primary, copy.T(copy.Create), title != "" && len(ids) > 0 && !s.busy).OnClick(func() {
				s.create(env, func(ctx context.Context, repo tg.Repository) (tg.Chat, error) {
					return repo.CreateGroup(ctx, tg.CreateGroupInput{Title: title, UserIDs: ids})
				})
			})
		})
	case channelDialog:
		kit.Dialog(c, t, &s.visible, 420, copy.T(copy.NewChannel), "", func() {
			kit.Field(ui.TextInput(c.Key("title"), &s.title).AutoFocus().Label(copy.T(copy.ChannelName)).Placeholder(copy.T(copy.ChannelName)), t)
			kit.Field(ui.TextArea(c.Key("description"), &s.description).Lines(2, 4).Label(copy.T(copy.ChannelDescription)), t)
		}, func() {
			cancel()
			in := tg.CreateChannelInput{Title: strings.TrimSpace(s.title), Description: strings.TrimSpace(s.description)}
			kit.Button(c.Key("create"), t, kit.Primary, copy.T(copy.Create), in.Title != "" && !s.busy).OnClick(func() {
				s.create(env, func(ctx context.Context, repo tg.Repository) (tg.Chat, error) { return repo.CreateChannel(ctx, in) })
			})
		})
	case secretDialog:
		kit.Dialog(c, t, &s.visible, 420, copy.T(copy.NewSecretChat), "", func() {
			s.contactList(c, env, func(ct tg.Contact) {
				id := ct.ID
				s.create(env, func(ctx context.Context, repo tg.Repository) (tg.Chat, error) { return repo.CreateSecretChat(ctx, id) })
			}, false)
		}, cancel)
	case contactDialog:
		kit.Dialog(c, t, &s.visible, 400, copy.T(copy.NewContact), "", func() {
			kit.Field(ui.TextInput(c.Key("first"), &s.first).AutoFocus().Label(copy.T(copy.ContactFirstName)).Placeholder(copy.T(copy.ContactFirstName)), t)
			kit.Field(ui.TextInput(c.Key("last"), &s.last).Label(copy.T(copy.ContactLastName)).Placeholder(copy.T(copy.ContactLastName)), t)
			kit.Field(ui.TextInput(c.Key("phone"), &s.phone).Label(copy.T(copy.ContactPhone)).Placeholder("+").FontFeatures("tnum"), t)
			if s.notOnTelegram {
				ui.Text(c, copy.T(copy.ContactNotOnTelegram)).FontSize(theme.Caption).TextColor(t.Danger).Role(ui.RoleStatus)
			}
		}, func() {
			cancel()
			in := tg.ContactByPhone{FirstName: strings.TrimSpace(s.first), LastName: strings.TrimSpace(s.last), Phone: strings.TrimSpace(s.phone)}
			kit.Button(c.Key("add"), t, kit.Primary, copy.T(copy.Add), in.FirstName != "" && len(in.Phone) > 4 && !s.busy).OnClick(func() { s.addContact(env, in) })
		})
	case storyDialog:
		s.storyDialog(c, env)
	}
}

func (s *State) addContact(env Env, in tg.ContactByPhone) {
	repo := env.Runtime.Repo()
	if repo == nil {
		return
	}
	s.busy = true
	st := env.Store
	env.Runtime.Go(func(ctx context.Context) func() {
		ct, err := repo.AddContactByPhone(ctx, in)
		return func() {
			s.busy = false
			switch {
			case err != nil:
				st.Notify(err.Error(), true)
			case ct == nil:
				s.notOnTelegram = true
			default:
				s.visible = false
				st.OpenPrivate(ct.ID)
			}
		}
	})
}

// contactList draws the contacts filtered by the query: a click opens
// one, or, with pick, toggles membership.
func (s *State) contactList(c *ui.Context, env Env, open func(tg.Contact), pick bool) {
	t := env.Tokens
	kit.SearchBox(c, t, &s.query, copy.T(copy.SearchContacts))
	q := strings.ToLower(strings.TrimSpace(s.query))
	ui.Scroll(c).MaxHeight(320).Children(func() {
		ui.Column(c).Gap(1).Children(func() {
			shown := 0
			for _, ct := range s.contacts {
				if q != "" && !strings.Contains(strings.ToLower(ct.DisplayName+" "+ct.Username), q) {
					continue
				}
				shown++
				ct := ct
				row := ui.ButtonBase(c.Key(ct.ID)).Padding(6, 8).Gap(10).Radius(theme.RadiusLG).AlignItems(ui.Center).Label(ct.DisplayName)
				if row.Hovered() {
					row.Background(t.Subtle)
				}
				row.Children(func() {
					kit.Avatar(c, t, env.Images, ct.Avatar, ct.DisplayName, 32, false)
					ui.Column(c).Grow(1).Gap(1).Children(func() {
						ui.Text(c, ct.DisplayName).FontSize(theme.Body).SingleLine()
						if ct.Username != "" {
							ui.Text(c, "@"+ct.Username).FontSize(theme.Caption).TextColor(t.Muted).SingleLine()
						}
					})
					if pick && s.members[ct.ID] {
						ui.Icon(c, icons.CheckCircle).FontSize(18).TextColor(t.AccentInk)
					}
				})
				row.OnClick(func() {
					if pick {
						s.members[ct.ID] = !s.members[ct.ID]
						return
					}
					open(ct)
				})
			}
			if shown == 0 {
				kit.Empty(c, t, icons.AddressBook, copy.T(copy.NoContacts))
			}
		})
	})
}

func (s *State) callList(c *ui.Context, env Env) {
	t := env.Tokens
	ui.Scroll(c).MaxHeight(360).Children(func() {
		ui.Column(c).Gap(1).Children(func() {
			if len(s.calls) == 0 {
				kit.Empty(c, t, icons.Phone, copy.T(copy.NoCalls))
			}
			for i, call := range s.calls {
				row := ui.ButtonBase(c.Key(i)).Padding(6, 8).Gap(10).Radius(theme.RadiusLG).AlignItems(ui.Center).Label(call.Title)
				if row.Hovered() {
					row.Background(t.Subtle)
				}
				row.Children(func() {
					kit.Avatar(c, t, env.Images, call.Avatar, call.Title, 32, false)
					ui.Column(c).Grow(1).Gap(1).Children(func() {
						ink := t.Text
						if call.Status == tg.CallMissed {
							ink = t.Danger
						}
						ui.Text(c, call.Title).FontSize(theme.Body).TextColor(ink).SingleLine()
						ui.Text(c, copy.T(chat.CallLabel(tg.MessageCall{Status: call.Status, Video: call.Video}))).FontSize(theme.Caption).TextColor(t.Muted)
					})
					ui.Text(c, env.Formats.ListTime(call.OccurredAt, env.Runtime.Clock())).FontSize(theme.Caption).TextColor(t.Muted)
				})
				chatID, id := call.ChatID, call.MessageID
				row.OnClick(func() {
					s.visible = false
					env.Store.Select(chatID)
					env.Store.JumpTo(chatID, id, nil)
				})
			}
		})
	})
}

func (s *State) storyDialog(c *ui.Context, env Env) {
	t := env.Tokens
	kit.Dialog(c, t, &s.visible, 420, copy.T(copy.NewStory), "", func() {
		label := copy.T(copy.PickFile)
		if s.storyFile != "" {
			label = s.storyFile
		}
		kit.SizedButton(c.Key("file"), t, kit.Outline, kit.SizeDefault, icons.ImageSquare, label, true).OnClick(func() {
			if files := env.Runtime.Desktop.PickFiles(copy.T(copy.PickFile), false, true); len(files) > 0 {
				s.storyFile = files[0]
			}
		})
		kit.Field(ui.TextArea(c.Key("caption"), &s.caption).Lines(2, 4).Label(copy.T(copy.StoryCaption)), t)
		kit.Select(c.Key("privacy"), t, &s.privacy, copy.T(copy.StoryPrivacy), []tg.StoryPrivacy{tg.StoryEveryone, tg.StoryContacts, tg.StoryCloseFriends},
			func(p tg.StoryPrivacy) string {
				return copy.T(map[tg.StoryPrivacy]copy.Key{tg.StoryEveryone: copy.StoryEveryone, tg.StoryContacts: copy.StoryContacts, tg.StoryCloseFriends: copy.StoryCloseFriends}[p])
			})
		kit.Select(c.Key("period"), t, &s.period, copy.T(copy.StoryPeriod), tg.StoryActivePeriods, func(sec int) string { return copy.F(copy.StoryHours, sec/3600) })
		kit.Toggle(c, t, &s.protect, copy.T(copy.StoryProtect))
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { s.visible = false })
		kit.Button(c.Key("post"), t, kit.Primary, copy.T(copy.StoryPost), s.storyFile != "" && !s.busy).OnClick(func() { s.post(env) })
	})
}

func (s *State) post(env Env) {
	repo := env.Runtime.Repo()
	if repo == nil {
		return
	}
	path := s.storyFile
	in := tg.StoryInput{Caption: strings.TrimSpace(s.caption), Privacy: s.privacy, ActivePeriod: s.period, ProtectContent: s.protect}
	mime := "image/jpeg"
	if lower := strings.ToLower(path); strings.HasSuffix(lower, ".mp4") || strings.HasSuffix(lower, ".mov") {
		mime = "video/mp4"
	}
	s.busy = true
	st := env.Store
	env.Runtime.Go(func(ctx context.Context) func() {
		_, err := repo.PostStory(ctx, tg.UploadFile{Path: path, MIMEType: mime}, in)
		return func() {
			s.busy = false
			if err != nil {
				st.Notify(err.Error(), true)
				return
			}
			s.visible = false
			st.Notify(copy.T(copy.StoryPosted), false)
		}
	})
}
