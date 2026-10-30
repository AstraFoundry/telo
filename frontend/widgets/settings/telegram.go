package settings

import (
	"context"
	"slices"
	"strconv"
	"strings"

	"github.com/AstraFoundry/telo/backend/domain/keywordfolder"
	"github.com/AstraFoundry/telo/backend/domain/preferences"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/config"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// privacyKeys names each privacy rule.
var privacyKeys = map[tg.PrivacyKey]copy.Key{
	tg.PrivacyPhoneNumber: copy.PrivacyPhone, tg.PrivacyLastSeen: copy.PrivacyLastSeen, tg.PrivacyProfilePhoto: copy.PrivacyProfilePhoto,
	tg.PrivacyBio: copy.PrivacyBio, tg.PrivacyForwards: copy.PrivacyForwards, tg.PrivacyCalls: copy.PrivacyCalls,
	tg.PrivacyVoiceNotes: copy.PrivacyVoice, tg.PrivacyGroupInvites: copy.PrivacyGroups,
}

var audiences = []choice[tg.Audience]{{tg.AudienceEveryone, copy.PrivacyEveryone}, {tg.AudienceContacts, copy.PrivacyContacts}, {tg.AudienceNobody, copy.PrivacyNobody}}

type privacyState struct {
	rules   map[tg.PrivacyKey]tg.PrivacyRule
	blocked []tg.BlockedPeer
	twoStep *tg.TwoStepState
	// Passcode dialog: setting, changing or turning it off.
	passOpen       bool
	passOff        bool
	current, first string
	second         string
	passErr        copy.Key
}

func (v *View) privacyPane(c *ui.Context, p Props) {
	t, st := p.Tokens, &v.privacy
	v.load(p, SectionPrivacy, func(ctx context.Context, repo tg.Repository) func() {
		rules := map[tg.PrivacyKey]tg.PrivacyRule{}
		for _, k := range tg.PrivacyKeys {
			if r, err := repo.Privacy(ctx, k); err == nil {
				rules[k] = r
			}
		}
		blocked, _ := repo.BlockedPeers(ctx)
		two, err := repo.TwoStep(ctx)
		return func() {
			st.rules, st.blocked = rules, blocked
			if err == nil {
				st.twoStep = &two
			}
		}
	})
	kit.Group(c, t, copy.T(copy.PrivacyPrivacy), "", func() {
		for i, k := range tg.PrivacyKeys {
			if i > 0 {
				kit.Divider(c, t)
			}
			rule, known := st.rules[k]
			if !known {
				kit.Row(c.Key(k), t, copy.T(privacyKeys[k]), "", func() { ui.Spinner(c).Size(14, 14) })
				continue
			}
			key := k
			selectRow(c.Key(k), p, privacyKeys[k], rule.Audience, audiences, func(a tg.Audience) {
				next := rule
				next.Audience = a
				call(p, func(ctx context.Context, repo tg.Repository) error { return repo.SetPrivacy(ctx, key, next) },
					func() { st.rules[key] = next })
			})
		}
	})
	kit.Group(c, t, copy.T(copy.PrivacySecurity), copy.T(copy.PasscodeHint), func() {
		value := copy.T(copy.Off)
		if p.Prefs.PasscodeHash != "" {
			value = copy.T(copy.On)
		}
		kit.NavRow(c.Key("passcode"), t, icons.LockSimple, copy.T(copy.PrivacyPasscode), value).OnClick(func() {
			st.passOpen, st.passOff, st.current, st.first, st.second, st.passErr = true, false, "", "", "", ""
		})
		if p.Prefs.PasscodeHash != "" {
			kit.Divider(c, t)
			v.autoLock(c, p)
			kit.Divider(c, t)
			kit.NavRow(c.Key("lock"), t, icons.LockSimpleOpen, copy.T(copy.PasscodeLockNow), "").OnClick(func() {
				if p.Lock != nil {
					p.Lock()
				}
			})
		}
		kit.Divider(c, t)
		two := ""
		if st.twoStep != nil {
			two = copy.T(copy.PrivacyTwoStepOff)
			if st.twoStep.Enabled {
				two = copy.T(copy.PrivacyTwoStepOn)
			}
		}
		kit.Row(c, t, copy.T(copy.PrivacyTwoStep), copy.T(copy.PrivacyTwoStepNote), func() {
			ui.Text(c, two).FontSize(theme.Callout).TextColor(t.Muted)
		})
	})
	kit.Group(c, t, copy.T(copy.PrivacyBlocked), "", func() {
		if len(st.blocked) == 0 {
			kit.Row(c, t, copy.T(copy.PrivacyNoBlocked), "", nil)
		}
		for i, b := range st.blocked {
			if i > 0 {
				kit.Divider(c, t)
			}
			id := b.ID
			ui.Row(c.Key(id)).Padding(8, 16).Gap(10).AlignItems(ui.Center).Children(func() {
				kit.Avatar(c, t, p.Images, b.Avatar, b.Title, 32, false)
				ui.Text(c, b.Title).FontSize(theme.Body).Grow(1).SingleLine()
				kit.SizedButton(c.Key("unblock"), t, kit.Ghost, kit.SizeSmall, nil, copy.T(copy.Unblock), true).OnClick(func() {
					call(p, func(ctx context.Context, repo tg.Repository) error { return repo.SetBlocked(ctx, tg.ChatID(id), false) },
						func() { st.blocked = slices.DeleteFunc(st.blocked, func(x tg.BlockedPeer) bool { return x.ID == id }) })
				})
			})
		}
	})
	kit.Group(c, t, "", copy.T(copy.PrivacyDeleteAccountNote), func() {
		r := kit.NavRow(c.Key("delete"), t, icons.ArrowSquareOut, copy.T(copy.PrivacyDeleteAccount), "")
		r.TextColor(t.Danger)
		r.OnClick(func() { _ = p.Runtime.Desktop.OpenURL(config.DeleteAccountURL) })
	})
	v.passcodeDialog(c, p)
}

func (v *View) autoLock(c *ui.Context, p Props) {
	var options []choice[int]
	for _, m := range preferences.AutoLockChoices {
		options = append(options, choice[int]{m, ""})
	}
	t := p.Tokens
	name := func(m int) string {
		switch {
		case m == 0:
			return copy.T(copy.PasscodeAutoLockOff)
		case m%60 == 0:
			return copy.F(copy.PasscodeAutoLockHours, m/60)
		}
		return copy.F(copy.PasscodeAutoLockMinutes, m)
	}
	kit.Row(c, t, copy.T(copy.PasscodeAutoLock), "", func() {
		value := p.Prefs.AutoLockMinutes
		if kit.Select(c.Key("autolock"), t, &value, copy.T(copy.PasscodeAutoLock), preferences.AutoLockChoices, name) {
			update(p, func(x *preferences.Preferences) { x.AutoLockMinutes = value })
		}
	})
}

func (v *View) passcodeDialog(c *ui.Context, p Props) {
	t, st, hash := p.Tokens, &v.privacy, p.Prefs.PasscodeHash
	title := copy.PasscodeSet
	if hash != "" {
		title = copy.PasscodeChange
	}
	kit.Dialog(c, t, &st.passOpen, 380, copy.T(title), copy.T(copy.PasscodeHint), func() {
		if hash != "" {
			kit.Field(ui.TextInput(c.Key("current"), &st.current).Password().AutoFocus().Label(copy.T(copy.PasscodeEnter)).Placeholder(copy.T(copy.PasscodeEnter)), t)
		}
		kit.Field(ui.TextInput(c.Key("first"), &st.first).Password().Label(copy.T(copy.PasscodeNew)).Placeholder(copy.T(copy.PasscodeNew)), t)
		kit.Field(ui.TextInput(c.Key("second"), &st.second).Password().Label(copy.T(copy.PasscodeRepeat)).Placeholder(copy.T(copy.PasscodeRepeat)), t)
		if st.passErr != "" {
			ui.Text(c, copy.T(st.passErr)).FontSize(theme.Caption).TextColor(t.Danger).Role(ui.RoleStatus)
		}
	}, func() {
		if hash != "" {
			kit.Button(c.Key("off"), t, kit.Ghost, copy.T(copy.PasscodeOff), st.current != "").OnClick(func() {
				if !preferences.CheckPasscode(hash, st.current) {
					st.passErr = copy.PasscodeWrong
					return
				}
				st.passOpen = false
				update(p, func(x *preferences.Preferences) { x.PasscodeHash = "" })
			})
		}
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { st.passOpen = false })
		kit.Button(c.Key("save"), t, kit.Primary, copy.T(copy.Save), len([]rune(st.first)) >= preferences.PasscodeMinLength).OnClick(func() {
			switch {
			case hash != "" && !preferences.CheckPasscode(hash, st.current):
				st.passErr = copy.PasscodeWrong
				return
			case st.first != st.second:
				st.passErr = copy.PasscodeMismatch
				return
			}
			next, err := preferences.HashPasscode(st.first)
			if err != nil {
				st.passErr = copy.PasscodeMismatch
				return
			}
			st.passOpen = false
			update(p, func(x *preferences.Preferences) {
				x.PasscodeHash = next
				if x.AutoLockMinutes == 0 {
					x.AutoLockMinutes = preferences.AutoLockDefault
				}
			})
		})
	})
}

type dataState struct {
	storage   *tg.StorageUsage
	network   *tg.NetworkUsage
	clearOpen bool
}

func (v *View) dataPane(c *ui.Context, p Props) {
	t, pr, st := p.Tokens, p.Prefs, &v.data
	reload := func() {
		delete(v.loaded, SectionData)
	}
	v.load(p, SectionData, func(ctx context.Context, repo tg.Repository) func() {
		s, err1 := repo.StorageUsage(ctx)
		n, err2 := repo.NetworkUsage(ctx)
		return func() {
			if err1 == nil {
				st.storage = &s
			}
			if err2 == nil {
				st.network = &n
			}
		}
	})
	kit.Group(c, t, copy.T(copy.DataAutoDownload), "", func() {
		switchRow(c, p, copy.DataAutoPhotos, "", pr.AutoPhotos, func(v bool) { update(p, func(x *preferences.Preferences) { x.AutoPhotos = v }) })
		kit.Divider(c, t)
		switchRow(c, p, copy.DataAutoVideos, "", pr.AutoVideos, func(v bool) { update(p, func(x *preferences.Preferences) { x.AutoVideos = v }) })
		kit.Divider(c, t)
		switchRow(c, p, copy.DataAutoFiles, "", pr.AutoFiles, func(v bool) { update(p, func(x *preferences.Preferences) { x.AutoFiles = v }) })
		kit.Divider(c, t)
		kit.NavRow(c.Key("reset"), t, icons.ArrowClockwise, copy.T(copy.DataAutoReset), "").OnClick(func() {
			d := preferences.Default()
			update(p, func(x *preferences.Preferences) {
				x.AutoPhotos, x.AutoVideos, x.AutoFiles = d.AutoPhotos, d.AutoVideos, d.AutoFiles
			})
		})
	})
	kit.Group(c, t, copy.T(copy.DataStorage), "", func() {
		total := ""
		if st.storage != nil {
			total = copy.Bytes(st.storage.TotalBytes)
		}
		kit.Row(c, t, copy.T(copy.DataStorage), "", func() { ui.Text(c, total).FontSize(theme.Callout).TextColor(t.Muted) })
		kit.Divider(c, t)
		limits := []int{preferences.CacheLimitMin, 256, preferences.CacheLimitDefault, 1024, 2048, preferences.CacheLimitMax}
		kit.Row(c, t, copy.T(copy.DataCacheLimit), "", func() {
			value := pr.CacheLimitMB
			if kit.Select(c.Key("limit"), t, &value, copy.T(copy.DataCacheLimit), limits, func(mb int) string { return copy.Bytes(int64(mb) << 20) }) {
				update(p, func(x *preferences.Preferences) { x.CacheLimitMB = value })
			}
		})
		kit.Divider(c, t)
		r := kit.NavRow(c.Key("clear"), t, icons.Trash, copy.T(copy.DataClearCache), "")
		r.TextColor(t.Danger)
		r.OnClick(func() { st.clearOpen = true })
	})
	kit.Group(c, t, copy.T(copy.DataNetwork), "", func() {
		sent, received, since := "", "", ""
		if n := st.network; n != nil {
			sent, received, since = copy.Bytes(n.Sent), copy.Bytes(n.Received), copy.F(copy.DataNetworkSince, p.Formats.Full(n.Since))
		}
		kit.Row(c, t, copy.T(copy.DataSent), since, func() { ui.Text(c, sent).FontSize(theme.Callout).TextColor(t.Muted) })
		kit.Divider(c, t)
		kit.Row(c, t, copy.T(copy.DataReceived), "", func() { ui.Text(c, received).FontSize(theme.Callout).TextColor(t.Muted) })
		kit.Divider(c, t)
		kit.NavRow(c.Key("reset-net"), t, icons.ArrowClockwise, copy.T(copy.DataNetworkReset), "").OnClick(func() {
			call(p, func(ctx context.Context, repo tg.Repository) error { return repo.ResetNetworkUsage(ctx) }, reload)
		})
	})
	kit.Dialog(c, t, &st.clearOpen, 380, copy.T(copy.DataClearCache), "", nil, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { st.clearOpen = false })
		kit.Button(c.Key("clear"), t, kit.Destructive, copy.T(copy.DataClearCache), true).OnClick(func() {
			st.clearOpen = false
			store := p.Store
			call(p, func(ctx context.Context, repo tg.Repository) error { return repo.ClearCache(ctx, nil) },
				func() { store.Notify(copy.T(copy.DataCacheCleared), false); reload() })
		})
	})
}

type stickersState struct {
	catalog  *tg.StickerCatalog
	trending []tg.StickerSetSummary
	archived []tg.StickerSetSummary
}

func (v *View) stickersPane(c *ui.Context, p Props) {
	t, pr, st := p.Tokens, p.Prefs, &v.stickers
	v.load(p, SectionStickers, func(ctx context.Context, repo tg.Repository) func() {
		cat, err := repo.StickerCatalog(ctx)
		trending, _ := repo.TrendingStickerSets(ctx)
		archived, _ := repo.ArchivedStickerSets(ctx)
		return func() {
			if err == nil {
				st.catalog = &cat
			}
			st.trending, st.archived = trending, archived
		}
	})
	kit.Group(c, t, "", "", func() {
		switchRow(c, p, copy.StickersSuggest, "", pr.SuggestStickers, func(v bool) { update(p, func(x *preferences.Preferences) { x.SuggestStickers = v }) })
		kit.Divider(c, t)
		switchRow(c, p, copy.StickersLoop, "", pr.LoopStickers, func(v bool) { update(p, func(x *preferences.Preferences) { x.LoopStickers = v }) })
	})
	setRow := func(s tg.StickerSetSummary, installed bool) {
		id := s.ID
		ui.Row(c.Key(id)).Padding(8, 16).Gap(10).AlignItems(ui.Center).Children(func() {
			box := ui.Box(c).Size(36, 36).Radius(8).Background(t.Subtle).Clip()
			box.Children(func() {
				if s.Thumbnail != nil && s.Thumbnail.Path != "" {
					if img := p.Images.File(s.Thumbnail.Path); img != nil {
						ui.Image(c, img).Size(36, 36).Fit(ui.Contain)
					}
				}
			})
			ui.Text(c, s.Title).FontSize(theme.Body).Grow(1).SingleLine()
			label, variant := copy.Remove, kit.Ghost
			if !installed {
				label, variant = copy.Add, kit.Outline
			}
			kit.SizedButton(c.Key("toggle"), t, variant, kit.SizeSmall, nil, copy.T(label), true).OnClick(func() {
				call(p, func(ctx context.Context, repo tg.Repository) error {
					return repo.SetStickerSetInstalled(ctx, id, !installed)
				},
					func() { delete(v.loaded, SectionStickers) })
			})
		})
	}
	kit.Group(c, t, copy.T(copy.StickersInstalled), "", func() {
		if st.catalog == nil {
			kit.Row(c, t, copy.T(copy.Loading), "", nil)
			return
		}
		for i, s := range st.catalog.Sets {
			if i > 0 {
				kit.Divider(c, t)
			}
			setRow(s, true)
		}
	})
	for _, g := range []struct {
		title copy.Key
		sets  []tg.StickerSetSummary
	}{{copy.StickersTrending, st.trending}, {copy.StickersArchived, st.archived}} {
		kit.Group(c, t, copy.T(g.title), "", func() {
			if len(g.sets) == 0 {
				kit.Row(c, t, copy.T(copy.StickersNoArchived), "", nil)
			}
			for i, s := range g.sets {
				if i > 0 {
					kit.Divider(c, t)
				}
				setRow(s, false)
			}
		})
	}
}

type foldersState struct {
	keyword      []keywordfolder.Folder
	open         bool
	editing      int
	title, query string
	tgOpen       bool
	tgEditing    int
	tgTitle      string
	tgChats      map[tg.ChatID]bool
}

func (v *View) foldersPane(c *ui.Context, p Props) {
	t, s, st := p.Tokens, p.Store, &v.folders
	if !v.loaded[SectionFolders] && p.Runtime.KeywordFolders != nil {
		if v.loaded == nil {
			v.loaded = map[Section]bool{}
		}
		v.loaded[SectionFolders] = true
		svc := p.Runtime.KeywordFolders
		p.Runtime.Go(func(ctx context.Context) func() {
			fs, err := svc.List(ctx)
			return func() {
				if err == nil {
					st.keyword = fs
				}
			}
		})
	}
	kit.Group(c, t, copy.T(copy.FoldersTelegram), copy.T(copy.FoldersTelegramHint), func() {
		native := 0
		for _, f := range s.Folders {
			if f.Kind != tg.FolderNative {
				continue
			}
			if native > 0 {
				kit.Divider(c, t)
			}
			native++
			id := f.ID
			kit.Row(c.Key(id), t, f.Title, "", func() {
				kit.IconButton(c.Key("edit"), t, icons.PencilSimple, copy.T(copy.FoldersEdit)).OnClick(func() { v.editFolder(p, id, f.Title) })
				kit.IconButton(c.Key("delete"), t, icons.Trash, copy.T(copy.Delete)).OnClick(func() {
					call(p, func(ctx context.Context, repo tg.Repository) error { return repo.DeleteFolder(ctx, id) }, nil)
				})
			})
		}
		if native > 0 {
			kit.Divider(c, t)
		}
		kit.NavRow(c.Key("create"), t, icons.Plus, copy.T(copy.FoldersCreate), "").OnClick(func() { v.editFolder(p, 0, "") })
	})
	kit.Group(c, t, copy.T(copy.FoldersKeyword), copy.T(copy.FoldersKeywordHint), func() {
		for i, f := range st.keyword {
			if i > 0 {
				kit.Divider(c, t)
			}
			f := f
			kit.Row(c.Key(f.ID), t, f.Title, f.Query, func() {
				kit.IconButton(c.Key("edit"), t, icons.PencilSimple, copy.T(copy.Edit)).OnClick(func() {
					st.open, st.editing, st.title, st.query = true, f.ID, f.Title, f.Query
				})
				kit.IconButton(c.Key("delete"), t, icons.Trash, copy.T(copy.Delete)).OnClick(func() { v.saveKeyword(p, f.ID, "", "", true) })
			})
		}
		if len(st.keyword) > 0 {
			kit.Divider(c, t)
		}
		kit.NavRow(c.Key("add-keyword"), t, icons.Plus, copy.T(copy.FoldersKeywordCreate), "").OnClick(func() {
			st.open, st.editing, st.title, st.query = true, 0, "", ""
		})
	})
	kit.Dialog(c, t, &st.open, 400, copy.T(copy.FoldersKeyword), copy.T(copy.FoldersKeywordHint), func() {
		kit.Field(ui.TextInput(c.Key("title"), &st.title).AutoFocus().Label(copy.T(copy.FoldersName)).Placeholder(copy.T(copy.FoldersName)), t)
		kit.Field(ui.TextInput(c.Key("query"), &st.query).Label(copy.T(copy.FoldersKeywordQuery)).Placeholder(copy.T(copy.FoldersKeywordQuery)), t)
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { st.open = false })
		kit.Button(c.Key("save"), t, kit.Primary, copy.T(copy.Save), strings.TrimSpace(st.title) != "" && strings.TrimSpace(st.query) != "").OnClick(func() {
			st.open = false
			v.saveKeyword(p, st.editing, st.title, st.query, false)
		})
	})
	v.folderDialog(c, p)
}

func (v *View) saveKeyword(p Props, id int, title, query string, remove bool) {
	svc, st, store := p.Runtime.KeywordFolders, &v.folders, p.Store
	p.Runtime.Go(func(ctx context.Context) func() {
		var err error
		switch {
		case remove:
			err = svc.Delete(ctx, id)
		case id == 0:
			_, err = svc.Create(ctx, title, query)
		default:
			_, err = svc.Update(ctx, id, title, query)
		}
		fs, _ := svc.List(ctx)
		return func() {
			if err != nil {
				store.Notify(err.Error(), true)
				return
			}
			st.keyword = fs
			store.RefreshKeywordFolders()
		}
	})
}

// editFolder opens a Telegram folder's editor, loading its chats.
func (v *View) editFolder(p Props, id int, title string) {
	st := &v.folders
	st.tgOpen, st.tgEditing, st.tgTitle, st.tgChats = true, id, title, map[tg.ChatID]bool{}
	if id == 0 {
		return
	}
	repo := p.Runtime.Repo()
	if repo == nil {
		return
	}
	p.Runtime.Go(func(ctx context.Context) func() {
		d, err := repo.FolderDetails(ctx, id)
		return func() {
			if err != nil || st.tgEditing != id {
				return
			}
			for _, c := range d.IncludedChatIDs {
				st.tgChats[c] = true
			}
		}
	})
}

func (v *View) folderDialog(c *ui.Context, p Props) {
	t, s, st := p.Tokens, p.Store, &v.folders
	title := copy.FoldersCreate
	if st.tgEditing != 0 {
		title = copy.FoldersEdit
	}
	kit.Dialog(c, t, &st.tgOpen, 440, copy.T(title), "", func() {
		kit.Field(ui.TextInput(c.Key("name"), &st.tgTitle).AutoFocus().Label(copy.T(copy.FoldersName)).Placeholder(copy.T(copy.FoldersName)), t)
		kit.SectionTitle(c, t, copy.T(copy.FoldersChats))
		ui.Scroll(c).MaxHeight(260).Children(func() {
			ui.Column(c).Gap(2).Children(func() {
				for _, ch := range s.All() {
					id := ch.ID
					on := st.tgChats[id]
					ui.Row(c.Key(id)).Gap(10).Padding(4, 2).AlignItems(ui.Center).Children(func() {
						kit.Avatar(c, t, p.Images, ch.Avatar, ch.Title, 24, ch.Kind == tg.ChatSaved)
						if ui.Checkbox(c, &on, ch.Title).Grow(1).Changed() {
							st.tgChats[id] = on
						}
					})
				}
			})
		})
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { st.tgOpen = false })
		var chats []tg.ChatID
		for id, on := range st.tgChats {
			if on {
				chats = append(chats, id)
			}
		}
		slices.Sort(chats)
		kit.Button(c.Key("save"), t, kit.Primary, copy.T(copy.Save), strings.TrimSpace(st.tgTitle) != "" && len(chats) > 0).OnClick(func() {
			st.tgOpen = false
			in, id := tg.FolderInput{Title: strings.TrimSpace(st.tgTitle), ChatIDs: chats}, st.tgEditing
			call(p, func(ctx context.Context, repo tg.Repository) error {
				var err error
				if id == 0 {
					_, err = repo.CreateFolder(ctx, in)
				} else {
					_, err = repo.EditFolder(ctx, id, in)
				}
				return err
			}, nil)
		})
	})
}

type sessionsState struct {
	list       []tg.Session
	ending     int64
	endAllOpen bool
}

func (v *View) sessionsPane(c *ui.Context, p Props) {
	t, st := p.Tokens, &v.sessions
	v.load(p, SectionSessions, func(ctx context.Context, repo tg.Repository) func() {
		list, err := repo.Sessions(ctx)
		return func() {
			if err == nil {
				st.list = list
			}
		}
	})
	row := func(s tg.Session) {
		ui.Row(c.Key(s.ID)).Padding(10, 16).Gap(12).AlignItems(ui.Center).Children(func() {
			icon := icons.Desktop
			if strings.Contains(strings.ToLower(s.Platform), "ios") || strings.Contains(strings.ToLower(s.Platform), "android") {
				icon = icons.DeviceMobile
			}
			ui.Icon(c, icon).FontSize(20).TextColor(t.Muted)
			ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
				ui.Text(c, s.Application+" "+s.Version).FontSize(theme.Body).FontWeight(600).SingleLine()
				ui.Text(c, strings.TrimSpace(s.Device+" · "+s.Platform+" "+s.SystemVersion)).FontSize(theme.Caption).TextColor(t.Muted).SingleLine()
				ui.Text(c, strings.TrimSpace(s.IP+" · "+s.Location)).FontSize(theme.Caption).TextColor(t.Muted).SingleLine()
			})
			if s.Current {
				return
			}
			ui.Text(c, copy.F(copy.SessionsActiveAt, ago(p, s.LastActive))).FontSize(theme.Caption).TextColor(t.Muted)
			id := s.ID
			kit.IconButton(c.Key("end"), t, icons.XCircle, copy.T(copy.SessionsTerminate)).OnClick(func() {
				call(p, func(ctx context.Context, repo tg.Repository) error { return repo.TerminateSession(ctx, id) },
					func() { st.list = slices.DeleteFunc(st.list, func(x tg.Session) bool { return x.ID == id }) })
			})
		})
	}
	others := slices.DeleteFunc(slices.Clone(st.list), func(s tg.Session) bool { return s.Current })
	kit.Group(c, t, copy.T(copy.SessionsCurrent), "", func() {
		for _, s := range st.list {
			if s.Current {
				row(s)
			}
		}
		if len(others) > 0 {
			kit.Divider(c, t)
			r := kit.NavRow(c.Key("end-all"), t, icons.HandWaving, copy.T(copy.SessionsTerminateAll), "")
			r.TextColor(t.Danger)
			r.OnClick(func() { st.endAllOpen = true })
		}
	})
	kit.Group(c, t, copy.T(copy.SessionsOthers), "", func() {
		if len(others) == 0 {
			kit.Row(c, t, copy.T(copy.SessionsNone), "", nil)
		}
		for i, s := range others {
			if i > 0 {
				kit.Divider(c, t)
			}
			row(s)
		}
	})
	kit.Dialog(c, t, &st.endAllOpen, 380, copy.T(copy.SessionsTerminateAll), copy.T(copy.SessionsTerminateAllConfirm), nil, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { st.endAllOpen = false })
		kit.Button(c.Key("end"), t, kit.Destructive, copy.T(copy.SessionsTerminateAll), true).OnClick(func() {
			st.endAllOpen = false
			call(p, func(ctx context.Context, repo tg.Repository) error { return repo.TerminateOtherSessions(ctx) },
				func() { st.list = slices.DeleteFunc(st.list, func(x tg.Session) bool { return !x.Current }) })
		})
	})
}

type proxyState struct {
	list                             []tg.Proxy
	open                             bool
	kind                             tg.ProxyKind
	server, port, user, pass, secret string
}

func (v *View) proxyPane(c *ui.Context, p Props) {
	t, st := p.Tokens, &v.proxy
	reload := func() { delete(v.loaded, SectionProxy) }
	v.load(p, SectionProxy, func(ctx context.Context, repo tg.Repository) func() {
		list, err := repo.Proxies(ctx)
		return func() {
			if err == nil {
				st.list = list
			}
		}
	})
	kit.Group(c, t, "", "", func() {
		if len(st.list) == 0 {
			kit.Row(c, t, copy.T(copy.ProxyNone), "", nil)
		}
		for i, x := range st.list {
			if i > 0 {
				kit.Divider(c, t)
			}
			x := x
			detail := string(x.Kind)
			if x.Enabled {
				detail = copy.T(copy.ProxyConnected)
			}
			kit.Row(c.Key(x.ID), t, x.Server+":"+strconv.Itoa(int(x.Port)), detail, func() {
				on := x.Enabled
				if ui.Switch(c.Key("use"), &on).Label(copy.T(copy.ProxyUse)).Changed() {
					call(p, func(ctx context.Context, repo tg.Repository) error { return repo.EnableProxy(ctx, x.ID, on) }, reload)
				}
				kit.IconButton(c.Key("remove"), t, icons.Trash, copy.T(copy.Remove)).OnClick(func() {
					call(p, func(ctx context.Context, repo tg.Repository) error { return repo.RemoveProxy(ctx, x.ID) }, reload)
				})
			})
		}
		kit.Divider(c, t)
		kit.NavRow(c.Key("add"), t, icons.Plus, copy.T(copy.ProxyAdd), "").OnClick(func() {
			*st = proxyState{list: st.list, open: true, kind: tg.ProxySOCKS5}
		})
	})
	kit.Dialog(c, t, &st.open, 420, copy.T(copy.ProxyAdd), "", func() {
		kind := 0
		kinds := []tg.ProxyKind{tg.ProxySOCKS5, tg.ProxyHTTP, tg.ProxyMTProto}
		for i, k := range kinds {
			if k == st.kind {
				kind = i
			}
		}
		kit.Segmented(c.Key("kind"), t, &kind, []string{"SOCKS5", "HTTP", "MTProto"})
		st.kind = kinds[kind]
		kit.Field(ui.TextInput(c.Key("server"), &st.server).AutoFocus().Label(copy.T(copy.ProxyServer)).Placeholder(copy.T(copy.ProxyServer)), t)
		kit.Field(ui.TextInput(c.Key("port"), &st.port).Label(copy.T(copy.ProxyPort)).Placeholder("1080").FontFeatures("tnum"), t)
		if st.kind == tg.ProxyMTProto {
			kit.Field(ui.TextInput(c.Key("secret"), &st.secret).Label(copy.T(copy.ProxySecret)).Placeholder(copy.T(copy.ProxySecret)), t)
		} else {
			kit.Field(ui.TextInput(c.Key("user"), &st.user).Label(copy.T(copy.ProxyUsername)).Placeholder(copy.T(copy.Optional)), t)
			kit.Field(ui.TextInput(c.Key("pass"), &st.pass).Password().Label(copy.T(copy.ProxyPassword)).Placeholder(copy.T(copy.Optional)), t)
		}
	}, func() {
		kit.Button(c.Key("cancel"), t, kit.Ghost, copy.T(copy.Cancel), true).OnClick(func() { st.open = false })
		port, err := strconv.Atoi(strings.TrimSpace(st.port))
		ok := strings.TrimSpace(st.server) != "" && err == nil && port > 0 && port < 65536 && (st.kind != tg.ProxyMTProto || st.secret != "")
		kit.Button(c.Key("add"), t, kit.Primary, copy.T(copy.Add), ok).OnClick(func() {
			st.open = false
			x := tg.Proxy{Server: strings.TrimSpace(st.server), Port: int32(port), Kind: st.kind, Username: st.user, Password: st.pass, Secret: st.secret, Enabled: true}
			call(p, func(ctx context.Context, repo tg.Repository) error {
				_, err := repo.AddProxy(ctx, x)
				return err
			}, reload)
		})
	})
}
