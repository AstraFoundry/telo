// Package profile is the chat's Info panel: who or what the chat is, the
// actions on it (mute, contact, block, secret chat, auto-delete, leave),
// its members and the media shared in it.
package profile

import (
	"context"
	"strings"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/features/chatactions"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/lib/timefmt"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Props is what the panel reads.
type Props struct {
	Tokens  theme.Tokens
	Runtime *runtime.Runtime
	Store   *chat.Store
	Images  *media.Images
	Formats timefmt.Formats
	// OpenMedia shows a shared photo in the viewer.
	OpenMedia func(m tg.Message)
	Close     func()
}

// Tab is a shared-media tab.
type tab struct {
	kind  tg.MediaKind
	title copy.Key
}

var tabs = []tab{{tg.MediaPhoto, copy.MediaPhotos}, {tg.MediaFile, copy.MediaFiles}, {tg.MediaWebPage, copy.MediaLinks}, {tg.MediaVoice, copy.MediaVoice}}

// Panel keeps what it read about the chat.
type Panel struct {
	chat      tg.ChatID
	profile   *tg.PeerProfile
	members   []tg.Member
	media     map[tg.MediaKind][]tg.Message
	tab       int
	pending   chatactions.Pending
	contact   bool
	first     string
	last      string
	share     bool
	secretAsk bool
}

func (p *Panel) load(props Props, id tg.ChatID) {
	p.chat, p.profile, p.members, p.media, p.tab = id, nil, nil, map[tg.MediaKind][]tg.Message{}, 0
	repo := props.Runtime.Repo()
	if repo == nil {
		return
	}
	props.Runtime.Go(func(ctx context.Context) func() {
		prof, err := repo.PeerProfile(ctx, id)
		var members []tg.Member
		if err == nil && (prof.Kind == tg.ChatGroup) {
			members, _ = repo.Members(ctx, id, "")
		}
		got := map[tg.MediaKind][]tg.Message{}
		for _, tb := range tabs {
			if page, err := repo.SharedMedia(ctx, id, tb.kind, 0, 60); err == nil {
				got[tb.kind] = page.Items
			}
		}
		return func() {
			if p.chat != id {
				return
			}
			if err == nil {
				p.profile = &prof
			}
			p.members, p.media = members, got
		}
	})
}

func (p *Panel) reload(props Props) { p.load(props, p.chat) }

// Render draws the panel for a chat.
func (p *Panel) Render(c *ui.Context, props Props, id tg.ChatID) {
	t, s := props.Tokens, props.Store
	if id != p.chat {
		p.load(props, id)
	}
	ch, ok := s.Chat(id)
	if !ok {
		return
	}
	bar := c.TitleBar()
	ui.Row(c).Height(max(bar.Height, 28)+18).Padding(max(bar.Height, 28)-24, 10, 0, 14).AlignItems(ui.Center).DragWindow().Children(func() {
		title := copy.UserInfo
		switch ch.Kind {
		case tg.ChatGroup:
			title = copy.GroupInfo
		case tg.ChatChannel:
			title = copy.ChannelInfo
		}
		ui.Text(c, copy.T(title)).FontSize(theme.Heading).FontWeight(700).Grow(1)
		more := kit.IconButton(c.Key("more"), t, icons.DotsThree, copy.T(copy.More))
		more.PopoverMenuButton(func(m *ui.Menu) { chatactions.Menu(m, s, ch, s.Tab, &p.pending) })
		kit.IconButton(c.Key("close"), t, icons.X, copy.T(copy.Close)).OnClick(props.Close)
	})
	ui.Scroll(c).Grow(1).Children(func() {
		ui.Column(c).Padding(4, 16, 24, 16).Gap(theme.GapGroup).Children(func() {
			p.header(c, props, ch)
			p.actions(c, props, ch)
			p.info(c, props, ch)
			if len(p.members) > 0 {
				p.memberList(c, props)
			}
			p.sharedMedia(c, props)
		})
	})
	chatactions.Confirm(c, t, s, &p.pending)
	p.dialogs(c, props, ch)
}

func (p *Panel) header(c *ui.Context, props Props, ch tg.Chat) {
	t := props.Tokens
	ui.Column(c).Gap(6).AlignItems(ui.Center).Padding(8, 0).Children(func() {
		kit.Avatar(c, t, props.Images, ch.Avatar, ch.Title, 88, ch.Kind == tg.ChatSaved)
		name := ch.Title
		if ch.Kind == tg.ChatSaved {
			name = copy.T(copy.SavedMessages)
		}
		ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
			if ch.Kind == tg.ChatSecret {
				ui.Icon(c, icons.LockSimple).FontSize(15).TextColor(t.Success)
			}
			ui.Text(c, name).FontSize(theme.Title).FontWeight(700).TextAlign(ui.Center)
		})
		ui.Text(c, p.status(props, ch)).FontSize(theme.Callout).TextColor(t.Muted)
	})
}

func (p *Panel) status(props Props, ch tg.Chat) string {
	switch {
	case ch.Kind == tg.ChatGroup || ch.Kind == tg.ChatChannel:
		n := ch.MemberCount
		if p.profile != nil && p.profile.MemberCount > 0 {
			n = p.profile.MemberCount
		}
		if ch.Kind == tg.ChatChannel {
			return copy.Plural(n, copy.Subscriber, copy.Subscribers)
		}
		return copy.Plural(n, copy.Member, copy.Members)
	case ch.Online:
		return copy.T(copy.Online)
	case p.profile != nil && !p.profile.LastSeen.IsZero():
		return copy.F(copy.LastSeenAt, props.Formats.Ago(p.profile.LastSeen, props.Runtime.Clock()))
	}
	return ""
}

func (p *Panel) actions(c *ui.Context, props Props, ch tg.Chat) {
	t, s := props.Tokens, props.Store
	ui.Row(c).Gap(8).AlignItems(ui.Stretch).Children(func() {
		action := func(key string, icon *ui.SVG, label string, do func()) {
			b := ui.ButtonBase(c.Key(key)).Column().Grow(1).Basis(0).Padding(8, 4).Gap(4).Radius(theme.RadiusLG).Background(t.Subtle).AlignItems(ui.Center).Label(label)
			b.Children(func() {
				ui.Icon(c, icon).FontSize(18).TextColor(t.AccentInk)
				ui.Text(c, label).FontSize(theme.Caption).MaxLines(2).TextAlign(ui.Center)
			})
			kit.Press(b).OnClick(do)
		}
		if ch.ID != s.Selected {
			action("message", icons.ChatCircle, copy.T(copy.SendMessageAction), func() { s.Select(ch.ID) })
		}
		if ch.Kind != tg.ChatSaved {
			if ch.Muted {
				action("unmute", icons.Bell, copy.T(copy.UnmuteChat), func() { s.Mute(ch.ID, 0) })
			} else {
				action("mute", icons.BellSlash, copy.T(copy.MuteChat), func() { s.Mute(ch.ID, -1) })
			}
		}
		if ch.Kind == tg.ChatDirect && p.profile != nil {
			if !p.profile.IsContact {
				action("add", icons.UserPlus, copy.T(copy.AddToContacts), func() {
					first, last, _ := strings.Cut(ch.Title, " ")
					p.contact, p.first, p.last, p.share = true, first, last, p.profile.NeedPhonePrivacyException
				})
			}
			action("secret", icons.LockSimple, copy.T(copy.StartSecretChat), func() { p.secretAsk = true })
		}
	})
}

func (p *Panel) info(c *ui.Context, props Props, ch tg.Chat) {
	t := props.Tokens
	prof := p.profile
	if prof == nil {
		return
	}
	rows := []struct {
		label copy.Key
		value string
	}{{copy.Bio, prof.Bio}, {copy.Username, at(prof.Username)}, {copy.Phone, phone(prof.Phone)}, {copy.Description, prof.Description}, {copy.InviteLink, prof.InviteLink}}
	any := false
	for _, r := range rows {
		any = any || r.value != ""
	}
	if any || prof.CommonGroups > 0 || ch.Kind != tg.ChatSaved {
		kit.Card(c, t).Children(func() {
			first := true
			sep := func() {
				if !first {
					kit.Divider(c, t)
				}
				first = false
			}
			for _, r := range rows {
				if r.value == "" {
					continue
				}
				sep()
				value := r.value
				row := ui.ButtonBase(c.Key(r.label)).Padding(10, 16).Gap(2).AlignItems(ui.Start).Label(copy.T(r.label)).Tooltip(copy.T(copy.Copy))
				row.Children(func() {
					ui.Text(c, value).FontSize(theme.Body).Selectable()
					ui.Text(c, copy.T(r.label)).FontSize(theme.Caption).TextColor(t.Muted)
				}).Column()
				row.OnClick(func() {
					props.Runtime.Desktop.WriteClipboard(value)
					props.Store.Notify(copy.T(copy.Copied), false)
				})
			}
			if prof.CommonGroups > 0 {
				sep()
				kit.Row(c, t, copy.Plural(prof.CommonGroups, copy.GroupInCommon, copy.GroupsInCommon), "", nil)
			}
			if ch.Kind != tg.ChatSaved && ch.Kind != tg.ChatChannel {
				sep()
				p.autoDelete(c, props, ch)
			}
			if ch.Kind == tg.ChatDirect || ch.Kind == tg.ChatSecret {
				sep()
				label := copy.BlockUser
				if prof.Blocked {
					label = copy.UnblockUser
				}
				r := kit.NavRow(c.Key("block"), t, icons.Prohibit, copy.T(label), "")
				r.TextColor(t.Danger)
				blocked := !prof.Blocked
				r.OnClick(func() {
					p.call(props, func(ctx context.Context, repo tg.Repository) error { return repo.SetBlocked(ctx, ch.ID, blocked) })
				})
			}
			if prof.IsContact {
				sep()
				r := kit.NavRow(c.Key("remove-contact"), t, icons.UserMinus, copy.T(copy.RemoveContact), "")
				r.TextColor(t.Danger)
				user := prof.UserID
				r.OnClick(func() {
					p.call(props, func(ctx context.Context, repo tg.Repository) error { return repo.RemoveContact(ctx, user) })
				})
			}
		})
	}
}

func at(u string) string {
	if u == "" {
		return ""
	}
	return "@" + u
}

func phone(n string) string {
	if n == "" || strings.HasPrefix(n, "+") {
		return n
	}
	return "+" + n
}

var autoDeletes = []int{0, 86400, 7 * 86400, 30 * 86400}

func (p *Panel) autoDelete(c *ui.Context, props Props, ch tg.Chat) {
	t := props.Tokens
	names := map[int]copy.Key{0: copy.AutoDeleteOff, 86400: copy.AutoDelete1Day, 7 * 86400: copy.AutoDelete1Week, 30 * 86400: copy.AutoDelete1Month}
	kit.Row(c, t, copy.T(copy.AutoDelete), "", func() {
		v := ch.AutoDeleteSeconds
		if _, known := names[v]; !known {
			v = 0
		}
		if kit.Select(c.Key("auto-delete"), t, &v, copy.T(copy.AutoDelete), autoDeletes, func(s int) string { return copy.T(names[s]) }) {
			sec := v
			p.call(props, func(ctx context.Context, repo tg.Repository) error { return repo.SetAutoDelete(ctx, ch.ID, sec) })
		}
	})
}

func (p *Panel) call(props Props, do func(ctx context.Context, repo tg.Repository) error) {
	repo := props.Runtime.Repo()
	if repo == nil {
		return
	}
	store := props.Store
	props.Runtime.Go(func(ctx context.Context) func() {
		err := do(ctx, repo)
		return func() {
			if err != nil {
				store.Notify(err.Error(), true)
				return
			}
			p.reload(props)
		}
	})
}

func (p *Panel) memberList(c *ui.Context, props Props) {
	t := props.Tokens
	kit.Group(c, t, copy.T(copy.MembersTitle), "", func() {
		for i, m := range p.members {
			if i > 0 {
				kit.Divider(c, t)
			}
			m := m
			row := ui.ButtonBase(c.Key(m.ID)).Padding(8, 16).Gap(10).AlignItems(ui.Center).Label(m.DisplayName)
			if row.Hovered() {
				row.Background(t.Subtle)
			}
			row.Children(func() {
				kit.Avatar(c, t, props.Images, m.Avatar, m.DisplayName, 32, false)
				ui.Column(c).Grow(1).Gap(1).Children(func() {
					ui.Text(c, m.DisplayName).FontSize(theme.Body).SingleLine()
					if m.Online {
						ui.Text(c, copy.T(copy.Online)).FontSize(theme.Caption).TextColor(t.AccentInk)
					}
				})
				switch m.Role {
				case "owner":
					ui.Text(c, copy.T(copy.RoleCreator)).FontSize(theme.Caption).TextColor(t.Muted)
				case "admin":
					ui.Text(c, copy.T(copy.RoleAdmin)).FontSize(theme.Caption).TextColor(t.Muted)
				}
			})
			row.OnClick(func() { props.Store.OpenPrivate(m.ID) })
		}
	})
}

func (p *Panel) sharedMedia(c *ui.Context, props Props) {
	t := props.Tokens
	ui.Column(c).Gap(theme.GapRelated).Children(func() {
		kit.SectionTitle(c, t, copy.T(copy.SharedMedia))
		labels := make([]string, len(tabs))
		for i, tb := range tabs {
			labels[i] = copy.T(tb.title)
		}
		kit.Segmented(c.Key("tabs"), t, &p.tab, labels)
		items := p.media[tabs[p.tab].kind]
		if len(items) == 0 {
			kit.Empty(c, t, icons.ImageSquare, copy.T(copy.NoSharedMedia))
			return
		}
		if tabs[p.tab].kind == tg.MediaPhoto {
			ui.Grid(c).Columns(3).Gap(3).Children(func() {
				for _, m := range items {
					p.thumb(c, props, m)
				}
			})
			return
		}
		kit.Card(c, t).Children(func() {
			for i, m := range items {
				if i > 0 {
					kit.Divider(c, t)
				}
				p.mediaRow(c, props, m)
			}
		})
	})
}

func (p *Panel) thumb(c *ui.Context, props Props, m tg.Message) {
	t := props.Tokens
	md := m.Media
	cell := ui.ButtonBase(c.Key(m.ID)).AspectRatio(1).Radius(theme.RadiusMD).Background(t.Subtle).Clip().Label(chat.MediaName(md))
	cell.Children(func() {
		path := md.Path
		if path == "" {
			path = md.ThumbnailPath
		}
		switch {
		case path != "":
			if img := props.Images.File(path); img != nil {
				ui.Image(c, img).Fill().Fit(ui.Cover)
			}
		case len(md.Minithumbnail) > 0:
			if img := props.Images.Bytes(md.Minithumbnail); img != nil {
				ui.Image(c, img).Fill().Fit(ui.Cover).Blur(8)
			}
		}
	})
	if md.Path == "" && md.FileID != 0 {
		props.Store.Download(md.FileID)
	}
	msg := m
	cell.OnClick(func() {
		if props.OpenMedia != nil {
			props.OpenMedia(msg)
		}
	})
}

func (p *Panel) mediaRow(c *ui.Context, props Props, m tg.Message) {
	t := props.Tokens
	md := m.Media
	title, detail := md.FileName, props.Formats.Day(m.SentAt, props.Runtime.Clock())
	switch md.Kind {
	case tg.MediaWebPage:
		if md.WebPage != nil {
			title, detail = md.WebPage.Title, md.WebPage.URL
		}
	case tg.MediaVoice:
		title = chat.MediaName(md)
		detail += " · " + copy.Duration(md.Duration)
	}
	if title == "" {
		title = chat.Summary(m)
	}
	row := ui.ButtonBase(c.Key(m.ID)).Padding(8, 16).Gap(10).AlignItems(ui.Center).Label(title)
	row.Children(func() {
		icon := icons.File
		switch md.Kind {
		case tg.MediaWebPage:
			icon = icons.LinkSimple
		case tg.MediaVoice:
			icon = icons.Microphone
		}
		ui.Box(c).Size(32, 32).Radius(8).Background(t.AccentSoft).Justify(ui.Center).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, icon).FontSize(16).TextColor(t.AccentInk)
		})
		ui.Column(c).Grow(1).Shrink(1).Gap(1).Children(func() {
			ui.Text(c, title).FontSize(theme.Callout).SingleLine()
			ui.Text(c, detail).FontSize(theme.Caption).TextColor(t.Muted).SingleLine()
		})
	})
	chatID, id := m.ChatID, m.ID
	row.OnClick(func() {
		if md.Kind == tg.MediaWebPage && md.WebPage != nil {
			_ = props.Runtime.Desktop.OpenURL(md.WebPage.URL)
			return
		}
		props.Store.Select(chatID)
		props.Store.JumpTo(chatID, id, nil)
	})
}

func (p *Panel) dialogs(c *ui.Context, props Props, ch tg.Chat) {
	t := props.Tokens
	kit.Dialog(c, t, &p.contact, 400, copy.T(copy.AddToContacts), "", func() {
		kit.Field(ui.TextInput(c.Key("first"), &p.first).AutoFocus().Label(copy.T(copy.ContactFirstName)).Placeholder(copy.T(copy.ContactFirstName)), t)
		kit.Field(ui.TextInput(c.Key("last"), &p.last).Label(copy.T(copy.ContactLastName)).Placeholder(copy.T(copy.ContactLastName)), t)
		if p.profile != nil && p.profile.NeedPhonePrivacyException {
			kit.Toggle(c, t, &p.share, copy.T(copy.ShareMyPhone))
			ui.Text(c, copy.T(copy.ShareMyPhoneHint)).FontSize(theme.Caption).TextColor(t.Muted)
		}
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { p.contact = false })
		kit.Button(c.Key("add"), t, kit.Primary, copy.T(copy.Add), strings.TrimSpace(p.first) != "").OnClick(func() {
			p.contact = false
			in := tg.PeerContact{UserID: ch.UserID, FirstName: strings.TrimSpace(p.first), LastName: strings.TrimSpace(p.last), SharePhoneNumber: p.share}
			p.call(props, func(ctx context.Context, repo tg.Repository) error { return repo.SetPeerContact(ctx, in) })
		})
	})
	kit.Dialog(c, t, &p.secretAsk, 380, copy.T(copy.StartSecretChat), copy.F(copy.StartSecretChatConfirm, ch.Title), nil, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { p.secretAsk = false })
		kit.Button(c.Key("start"), t, kit.Primary, copy.T(copy.StartSecretChat), true).OnClick(func() {
			p.secretAsk = false
			repo, store, user := props.Runtime.Repo(), props.Store, ch.UserID
			if repo == nil {
				return
			}
			props.Runtime.Go(func(ctx context.Context) func() {
				c, err := repo.CreateSecretChat(ctx, user)
				return func() {
					if err != nil {
						store.Notify(err.Error(), true)
						return
					}
					store.Adopt(c)
				}
			})
		})
	})
}

var _ = time.Second
