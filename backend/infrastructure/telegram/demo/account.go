package demo

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

func (r *Repository) StickerCatalog(context.Context) (tg.StickerCatalog, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var sets []tg.StickerSetSummary
	if r.installed[demoStickerSet] {
		sets = append(sets, r.stickers.StickerSetSummary)
	}
	return tg.StickerCatalog{Recent: slices.Clone(r.recent), Favorites: slices.Clone(r.favorites), Sets: sets}, nil
}

func (r *Repository) StickerSet(_ context.Context, id int64) (tg.StickerSet, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if id != demoStickerSet {
		return tg.StickerSet{}, tg.ErrNotFound
	}
	s := r.stickers
	s.Installed = r.installed[id]
	s.Stickers = slices.Clone(s.Stickers)
	return s, nil
}

func (r *Repository) StickerSetByName(ctx context.Context, name string) (tg.StickerSet, error) {
	if !strings.EqualFold(name, r.stickers.ShortName) {
		return tg.StickerSet{}, tg.ErrNotFound
	}
	return r.StickerSet(ctx, demoStickerSet)
}

func (r *Repository) SearchStickers(_ context.Context, emoji string) ([]tg.Sticker, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []tg.Sticker
	for _, s := range r.stickers.Stickers {
		if strings.Contains(s.Emoji, emoji) || strings.Contains(emoji, s.Emoji) {
			out = append(out, s)
		}
	}
	return out, nil
}

func (r *Repository) SetStickerSetInstalled(_ context.Context, id int64, installed bool) error {
	r.mu.Lock()
	r.installed[id] = installed
	r.mu.Unlock()
	r.emit(tg.StickersChanged{})
	return nil
}

func (r *Repository) ReorderStickerSets(context.Context, []int64) error { return nil }

func (r *Repository) SetStickerFavorite(_ context.Context, s tg.Sticker, favorite bool) error {
	r.mu.Lock()
	r.favorites = slices.DeleteFunc(r.favorites, func(x tg.Sticker) bool { return x.ID == s.ID })
	if favorite {
		r.favorites = append([]tg.Sticker{s}, r.favorites...)
	}
	r.mu.Unlock()
	r.emit(tg.StickersChanged{})
	return nil
}

func (r *Repository) RemoveRecentSticker(_ context.Context, s tg.Sticker) error {
	r.mu.Lock()
	r.recent = slices.DeleteFunc(r.recent, func(x tg.Sticker) bool { return x.ID == s.ID })
	r.mu.Unlock()
	r.emit(tg.StickersChanged{})
	return nil
}

func (r *Repository) ClearRecentStickers(context.Context) error {
	r.mu.Lock()
	r.recent = nil
	r.mu.Unlock()
	r.emit(tg.StickersChanged{})
	return nil
}

func (r *Repository) TrendingStickerSets(context.Context) ([]tg.StickerSetSummary, error) {
	return []tg.StickerSetSummary{{ID: 77003, Title: "Desk Plants", ShortName: "DeskPlants"}, {ID: 77004, Title: "Night Owls", ShortName: "NightOwls"}}, nil
}

func (r *Repository) ArchivedStickerSets(context.Context) ([]tg.StickerSetSummary, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.archived), nil
}

func (r *Repository) Contacts(context.Context) ([]tg.Contact, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []tg.Contact
	for _, id := range []tg.UserID{Aron, Lev, Mina, Priya} {
		if !r.contacts[id] {
			continue
		}
		p := peers[id]
		out = append(out, tg.Contact{ID: id, DisplayName: p.name, Username: p.username, Phone: p.phone, Online: p.online, Avatar: tg.Avatar{Placeholder: tg.Placeholder(p.name, p.accent)}})
	}
	return out, nil
}

func (r *Repository) AddContactByPhone(_ context.Context, in tg.ContactByPhone) (*tg.Contact, error) {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, in.Phone)
	for id, p := range peers {
		if p.phone != "" && strings.HasSuffix(strings.ReplaceAll(strings.ReplaceAll(p.phone, " ", ""), "+", ""), digits) && len(digits) >= 7 {
			r.mu.Lock()
			r.contacts[id] = true
			r.mu.Unlock()
			return &tg.Contact{ID: id, DisplayName: strings.TrimSpace(in.FirstName + " " + in.LastName), Phone: p.phone, Avatar: tg.Avatar{Placeholder: tg.Placeholder(p.name, p.accent)}}, nil
		}
	}
	return nil, nil
}

func (r *Repository) SetPeerContact(_ context.Context, in tg.PeerContact) error {
	if _, ok := peers[in.UserID]; !ok {
		return tg.ErrNotFound
	}
	r.mu.Lock()
	r.contacts[in.UserID] = true
	r.mu.Unlock()
	return nil
}

func (r *Repository) RemoveContact(_ context.Context, user tg.UserID) error {
	r.mu.Lock()
	r.contacts[user] = false
	r.mu.Unlock()
	return nil
}

func (r *Repository) SetBlocked(_ context.Context, chat tg.ChatID, blocked bool) error {
	r.mu.Lock()
	r.blocked[chat] = blocked
	r.mu.Unlock()
	return r.update(chat, func(c *tg.Chat) { c.Blocked = blocked })
}

func (r *Repository) BlockedPeers(context.Context) ([]tg.BlockedPeer, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []tg.BlockedPeer
	for id, on := range r.blocked {
		if !on {
			continue
		}
		title := "Spam Bot"
		if c, ok := r.chatLocked(id); ok {
			title = c.Title
		}
		out = append(out, tg.BlockedPeer{ID: int64(id), Title: title, Avatar: tg.Avatar{Placeholder: tg.Placeholder(title, 0)}})
	}
	slices.SortFunc(out, func(a, b tg.BlockedPeer) int { return strings.Compare(a.Title, b.Title) })
	return out, nil
}

func (r *Repository) ReportChat(context.Context, tg.ChatID, string) error { return nil }

func (r *Repository) Calls(context.Context, string) (tg.CallPage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var page tg.CallPage
	for _, c := range r.sorted() {
		ms := r.messages[c.ID]
		for i := len(ms) - 1; i >= 0; i-- {
			if call := ms[i].Call; call != nil {
				page.Items = append(page.Items, tg.CallRecord{ChatID: c.ID, MessageID: ms[i].ID, Title: c.Title, Avatar: c.Avatar, Status: call.Status, Video: call.Video, OccurredAt: ms[i].SentAt, Duration: call.Duration})
			}
		}
	}
	return page, nil
}

func (r *Repository) PostStory(_ context.Context, f tg.UploadFile, in tg.StoryInput) (tg.PostedStory, error) {
	if !slices.Contains(tg.StoryActivePeriods, in.ActivePeriod) {
		return tg.PostedStory{}, fmt.Errorf("demo: unsupported story period %d", in.ActivePeriod)
	}
	now := r.opts.Now()
	return tg.PostedStory{ID: int32(now.Unix() % 100000), PostedAt: now, ExpiresAt: now.Add(time.Duration(in.ActivePeriod) * time.Second), Video: strings.HasPrefix(f.MIMEType, "video/")}, nil
}

func (r *Repository) Sessions(context.Context) ([]tg.Session, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.sessions), nil
}

func (r *Repository) TerminateSession(_ context.Context, id int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	i := slices.IndexFunc(r.sessions, func(s tg.Session) bool { return s.ID == id })
	if i < 0 {
		return tg.ErrNotFound
	}
	if r.sessions[i].Current {
		return fmt.Errorf("demo: the current session is ended by logging out")
	}
	r.sessions = slices.Delete(r.sessions, i, i+1)
	return nil
}

func (r *Repository) TerminateOtherSessions(context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions = slices.DeleteFunc(r.sessions, func(s tg.Session) bool { return !s.Current })
	return nil
}

func (r *Repository) Privacy(_ context.Context, key tg.PrivacyKey) (tg.PrivacyRule, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rule, ok := r.privacy[key]
	if !ok {
		return tg.PrivacyRule{}, tg.ErrNotFound
	}
	return rule, nil
}

func (r *Repository) SetPrivacy(_ context.Context, key tg.PrivacyKey, rule tg.PrivacyRule) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.privacy[key] = rule
	return nil
}

func (r *Repository) TwoStep(context.Context) (tg.TwoStepState, error) {
	return tg.TwoStepState{Enabled: true, Hint: "first pet", RecoveryEmailSet: true}, nil
}

func (r *Repository) Proxies(context.Context) ([]tg.Proxy, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.proxies), nil
}

func (r *Repository) AddProxy(_ context.Context, p tg.Proxy) (tg.Proxy, error) {
	if strings.TrimSpace(p.Server) == "" || p.Port <= 0 || p.Port > 65535 {
		return tg.Proxy{}, fmt.Errorf("demo: a proxy needs a server and a port")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	p.ID = r.nextProxy
	r.nextProxy++
	r.proxies = append(r.proxies, p)
	return p, nil
}

func (r *Repository) EnableProxy(_ context.Context, id int32, enabled bool) error {
	r.mu.Lock()
	found := false
	for i := range r.proxies {
		r.proxies[i].Enabled = enabled && r.proxies[i].ID == id
		found = found || r.proxies[i].ID == id
	}
	r.mu.Unlock()
	if !found {
		return tg.ErrNotFound
	}
	state := tg.ConnectionReady
	r.emit(tg.ConnectionChanged{State: state})
	return nil
}

func (r *Repository) RemoveProxy(_ context.Context, id int32) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.proxies = slices.DeleteFunc(r.proxies, func(p tg.Proxy) bool { return p.ID == id })
	return nil
}

func (r *Repository) StorageUsage(context.Context) (tg.StorageUsage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	u := tg.StorageUsage{ByKind: map[tg.MediaKind]int64{tg.MediaPhoto: 84 << 20, tg.MediaVideo: 212 << 20, tg.MediaFile: 31 << 20, tg.MediaSticker: 6 << 20}}
	for _, v := range u.ByKind {
		u.TotalBytes += v
	}
	u.FileCount = 1342
	return u, nil
}

func (r *Repository) ClearCache(context.Context, []tg.MediaKind) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.downloads = map[tg.FileID]string{}
	return nil
}

func (r *Repository) NetworkUsage(context.Context) (tg.NetworkUsage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.network, nil
}

func (r *Repository) ResetNetworkUsage(context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.network = tg.NetworkUsage{Since: r.opts.Now()}
	return nil
}

func (r *Repository) ScopeSettings(_ context.Context, scope tg.NotificationScope) (tg.ScopeSettings, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.scopes[scope], nil
}

func (r *Repository) SetScopeSettings(_ context.Context, scope tg.NotificationScope, s tg.ScopeSettings) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.scopes[scope] = s
	return nil
}

func (r *Repository) ResetNotifications(context.Context) error {
	r.mu.Lock()
	for k := range r.scopes {
		r.scopes[k] = tg.ScopeSettings{ShowPreview: true}
	}
	var changed []tg.Chat
	for i := range r.chats {
		if r.chats[i].Muted {
			r.chats[i].Muted = false
			changed = append(changed, r.chats[i])
		}
	}
	r.mu.Unlock()
	for _, c := range changed {
		r.emit(tg.ChatUpserted{Chat: c})
	}
	return nil
}

func (r *Repository) ResolveLink(_ context.Context, link string) (tg.Chat, tg.MessageID, error) {
	l := strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(link, "https://"), "http://"), "/")
	l = strings.TrimPrefix(l, "tg://resolve?domain=")
	l = strings.TrimPrefix(l, "t.me/")
	name, post, _ := strings.Cut(l, "/")
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.chats {
		username := ""
		if p, ok := peers[c.UserID]; ok {
			username = p.username
		}
		if c.ID == ProductChat {
			username = "telonotes"
		}
		if username != "" && strings.EqualFold(username, strings.TrimPrefix(name, "@")) {
			var id tg.MessageID
			fmt.Sscan(post, &id)
			return c, id, nil
		}
	}
	return tg.Chat{}, 0, tg.ErrNotFound
}
