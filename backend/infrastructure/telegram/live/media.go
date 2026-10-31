package live

import (
	"context"
	"slices"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib/tdapi"
)

// downloadPriority is the priority of downloads a person asked for, above
// the profile pictures fetched on their own.
const downloadPriority = 16

func (s *Session) Download(ctx context.Context, file tg.FileID) error {
	f, err := s.td.DownloadFile(ctx, &tdapi.DownloadFileRequest{FileID: int32(file), Priority: downloadPriority})
	if err != nil {
		s.emit(tg.DownloadProgressed{Download: tg.MediaDownload{FileID: file, State: tg.TransferFailed, Err: err.Error()}})
		return err
	}
	s.file(f)
	return nil
}

func (s *Session) CancelDownload(ctx context.Context, file tg.FileID) error {
	_, err := s.td.CancelDownloadFile(ctx, &tdapi.CancelDownloadFileRequest{FileID: int32(file)})
	return err
}

func regular() tdapi.StickerType { return &tdapi.StickerTypeRegular{} }

func (s *Session) stickers(list []*tdapi.Sticker) []tg.Sticker {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]tg.Sticker, 0, len(list))
	for _, st := range list {
		out = append(out, s.stickerLocked(st))
	}
	return out
}

func (s *Session) summary(info *tdapi.StickerSetInfo) tg.StickerSetSummary {
	out := tg.StickerSetSummary{ID: int64(info.ID), Title: info.Title, ShortName: info.Name, Archived: info.IsArchived}
	if len(info.Covers) > 0 {
		cover := s.sticker(info.Covers[0])
		out.Thumbnail = &cover
	}
	return out
}

func (s *Session) StickerCatalog(ctx context.Context) (tg.StickerCatalog, error) {
	recent, err := s.td.GetRecentStickers(ctx, &tdapi.GetRecentStickersRequest{})
	if err != nil {
		return tg.StickerCatalog{}, err
	}
	favorite, err := s.td.GetFavoriteStickers(ctx, &tdapi.GetFavoriteStickersRequest{})
	if err != nil {
		return tg.StickerCatalog{}, err
	}
	sets, err := s.td.GetInstalledStickerSets(ctx, &tdapi.GetInstalledStickerSetsRequest{StickerType: regular()})
	if err != nil {
		return tg.StickerCatalog{}, err
	}
	out := tg.StickerCatalog{Recent: s.stickers(recent.Stickers), Favorites: s.stickers(favorite.Stickers)}
	for _, info := range sets.Sets {
		out.Sets = append(out.Sets, s.summary(info))
	}
	return out, nil
}

func (s *Session) set(st *tdapi.StickerSet) tg.StickerSet {
	out := tg.StickerSet{StickerSetSummary: tg.StickerSetSummary{ID: int64(st.ID), Title: st.Title, ShortName: st.Name, Archived: st.IsArchived},
		Stickers: s.stickers(st.Stickers), Installed: st.IsInstalled}
	if len(out.Stickers) > 0 {
		cover := out.Stickers[0]
		out.Thumbnail = &cover
	}
	return out
}

func (s *Session) StickerSet(ctx context.Context, id int64) (tg.StickerSet, error) {
	st, err := s.td.GetStickerSet(ctx, &tdapi.GetStickerSetRequest{SetID: tdapi.Int64(id)})
	if err != nil {
		return tg.StickerSet{}, notFound(err)
	}
	return s.set(st), nil
}

func (s *Session) StickerSetByName(ctx context.Context, name string) (tg.StickerSet, error) {
	st, err := s.td.SearchStickerSet(ctx, &tdapi.SearchStickerSetRequest{Name: name})
	if err != nil {
		return tg.StickerSet{}, notFound(err)
	}
	return s.set(st), nil
}

func (s *Session) SearchStickers(ctx context.Context, emoji string) ([]tg.Sticker, error) {
	r, err := s.td.SearchStickers(ctx, &tdapi.SearchStickersRequest{StickerType: regular(), Emojis: emoji, Limit: 100})
	if err != nil {
		return nil, err
	}
	return s.stickers(r.Stickers), nil
}

func (s *Session) SetStickerSetInstalled(ctx context.Context, id int64, installed bool) error {
	_, err := s.td.ChangeStickerSet(ctx, &tdapi.ChangeStickerSetRequest{SetID: tdapi.Int64(id), IsInstalled: installed})
	return err
}

func (s *Session) ReorderStickerSets(ctx context.Context, ids []int64) error {
	order := make([]tdapi.Int64, len(ids))
	for i, id := range ids {
		order[i] = tdapi.Int64(id)
	}
	_, err := s.td.ReorderInstalledStickerSets(ctx, &tdapi.ReorderInstalledStickerSetsRequest{StickerType: regular(), StickerSetIDs: order})
	return err
}

func stickerFile(st tg.Sticker) tdapi.InputFile { return &tdapi.InputFileID{ID: int32(st.FileID)} }

func (s *Session) SetStickerFavorite(ctx context.Context, st tg.Sticker, favorite bool) error {
	if favorite {
		_, err := s.td.AddFavoriteSticker(ctx, &tdapi.AddFavoriteStickerRequest{Sticker: stickerFile(st)})
		return err
	}
	_, err := s.td.RemoveFavoriteSticker(ctx, &tdapi.RemoveFavoriteStickerRequest{Sticker: stickerFile(st)})
	return err
}

func (s *Session) RemoveRecentSticker(ctx context.Context, st tg.Sticker) error {
	_, err := s.td.RemoveRecentSticker(ctx, &tdapi.RemoveRecentStickerRequest{Sticker: stickerFile(st)})
	return err
}

func (s *Session) ClearRecentStickers(ctx context.Context) error {
	_, err := s.td.ClearRecentStickers(ctx, &tdapi.ClearRecentStickersRequest{})
	return err
}

func (s *Session) TrendingStickerSets(ctx context.Context) ([]tg.StickerSetSummary, error) {
	r, err := s.td.GetTrendingStickerSets(ctx, &tdapi.GetTrendingStickerSetsRequest{StickerType: regular(), Limit: 50})
	if err != nil {
		return nil, err
	}
	var out []tg.StickerSetSummary
	for _, info := range r.Sets {
		out = append(out, s.summary(info))
	}
	return out, nil
}

func (s *Session) ArchivedStickerSets(ctx context.Context) ([]tg.StickerSetSummary, error) {
	r, err := s.td.GetArchivedStickerSets(ctx, &tdapi.GetArchivedStickerSetsRequest{StickerType: regular(), Limit: 100})
	if err != nil {
		return nil, err
	}
	var out []tg.StickerSetSummary
	for _, info := range r.Sets {
		out = append(out, s.summary(info))
	}
	return out, nil
}

// fileKinds pairs Telo's media kinds with TDLib's file types.
var fileKinds = []struct {
	kind tg.MediaKind
	td   func() tdapi.FileType
}{
	{tg.MediaPhoto, func() tdapi.FileType { return &tdapi.FileTypePhoto{} }},
	{tg.MediaVideo, func() tdapi.FileType { return &tdapi.FileTypeVideo{} }},
	{tg.MediaFile, func() tdapi.FileType { return &tdapi.FileTypeDocument{} }},
	{tg.MediaAudio, func() tdapi.FileType { return &tdapi.FileTypeAudio{} }},
	{tg.MediaVoice, func() tdapi.FileType { return &tdapi.FileTypeVoiceNote{} }},
	{tg.MediaVideoNote, func() tdapi.FileType { return &tdapi.FileTypeVideoNote{} }},
	{tg.MediaAnimation, func() tdapi.FileType { return &tdapi.FileTypeAnimation{} }},
	{tg.MediaSticker, func() tdapi.FileType { return &tdapi.FileTypeSticker{} }},
}

func kindOf(t tdapi.FileType) (tg.MediaKind, bool) {
	for _, k := range fileKinds {
		if k.td().TDType() == t.TDType() {
			return k.kind, true
		}
	}
	return "", false
}

func (s *Session) StorageUsage(ctx context.Context) (tg.StorageUsage, error) {
	st, err := s.td.GetStorageStatistics(ctx, &tdapi.GetStorageStatisticsRequest{ChatLimit: 100})
	if err != nil {
		return tg.StorageUsage{}, err
	}
	out := tg.StorageUsage{TotalBytes: st.Size, FileCount: int(st.Count), ByKind: map[tg.MediaKind]int64{}}
	for _, chat := range st.ByChat {
		for _, ft := range chat.ByFileType {
			if k, ok := kindOf(ft.FileType); ok {
				out.ByKind[k] += ft.Size
			}
		}
	}
	return out, nil
}

func (s *Session) ClearCache(ctx context.Context, kinds []tg.MediaKind) error {
	var types []tdapi.FileType
	for _, k := range fileKinds {
		if len(kinds) == 0 || slices.Contains(kinds, k.kind) {
			types = append(types, k.td())
		}
	}
	_, err := s.td.OptimizeStorage(ctx, &tdapi.OptimizeStorageRequest{Size: 0, TTL: 0, Count: 0, ImmunityDelay: 0, FileTypes: types, ChatLimit: 1})
	return err
}

func (s *Session) NetworkUsage(ctx context.Context) (tg.NetworkUsage, error) {
	st, err := s.td.GetNetworkStatistics(ctx, &tdapi.GetNetworkStatisticsRequest{})
	if err != nil {
		return tg.NetworkUsage{}, err
	}
	out := tg.NetworkUsage{Since: unix(st.SinceDate)}
	for _, e := range st.Entries {
		switch e := e.(type) {
		case *tdapi.NetworkStatisticsEntryFile:
			out.Sent += e.SentBytes
			out.Received += e.ReceivedBytes
		case *tdapi.NetworkStatisticsEntryCall:
			out.Sent += e.SentBytes
			out.Received += e.ReceivedBytes
		}
	}
	return out, nil
}

func (s *Session) ResetNetworkUsage(ctx context.Context) error {
	_, err := s.td.ResetNetworkStatistics(ctx, &tdapi.ResetNetworkStatisticsRequest{})
	return err
}

func proxyOf(p *tdapi.AddedProxy) tg.Proxy {
	out := tg.Proxy{ID: p.ID, Enabled: p.IsEnabled, LastUsed: unix(p.LastUsedDate)}
	if p.Proxy == nil {
		return out
	}
	out.Server, out.Port = p.Proxy.Server, p.Proxy.Port
	switch t := p.Proxy.Type.(type) {
	case *tdapi.ProxyTypeSocks5:
		out.Kind, out.Username, out.Password = tg.ProxySOCKS5, t.Username, t.Password
	case *tdapi.ProxyTypeHTTP:
		out.Kind, out.Username, out.Password = tg.ProxyHTTP, t.Username, t.Password
	case *tdapi.ProxyTypeMtproto:
		out.Kind, out.Secret = tg.ProxyMTProto, t.Secret
	}
	return out
}

func (s *Session) Proxies(ctx context.Context) ([]tg.Proxy, error) {
	r, err := s.td.GetProxies(ctx, &tdapi.GetProxiesRequest{})
	if err != nil {
		return nil, err
	}
	out := make([]tg.Proxy, 0, len(r.Proxies))
	for _, p := range r.Proxies {
		out = append(out, proxyOf(p))
	}
	return out, nil
}

func (s *Session) AddProxy(ctx context.Context, p tg.Proxy) (tg.Proxy, error) {
	var kind tdapi.ProxyType
	switch p.Kind {
	case tg.ProxySOCKS5:
		kind = &tdapi.ProxyTypeSocks5{Username: p.Username, Password: p.Password}
	case tg.ProxyHTTP:
		kind = &tdapi.ProxyTypeHTTP{Username: p.Username, Password: p.Password}
	default:
		kind = &tdapi.ProxyTypeMtproto{Secret: p.Secret}
	}
	added, err := s.td.AddProxy(ctx, &tdapi.AddProxyRequest{Proxy: &tdapi.Proxy{Server: p.Server, Port: p.Port, Type: kind}, Enable: p.Enabled})
	if err != nil {
		return tg.Proxy{}, err
	}
	return proxyOf(added), nil
}

func (s *Session) EnableProxy(ctx context.Context, id int32, enabled bool) error {
	if enabled {
		_, err := s.td.EnableProxy(ctx, &tdapi.EnableProxyRequest{ProxyID: id})
		return err
	}
	_, err := s.td.DisableProxy(ctx, &tdapi.DisableProxyRequest{})
	return err
}

func (s *Session) RemoveProxy(ctx context.Context, id int32) error {
	_, err := s.td.RemoveProxy(ctx, &tdapi.RemoveProxyRequest{ProxyID: id})
	return err
}

func scope(sc tg.NotificationScope) tdapi.NotificationSettingsScope {
	switch sc {
	case tg.ScopeGroups:
		return &tdapi.NotificationSettingsScopeGroupChats{}
	case tg.ScopeChannels:
		return &tdapi.NotificationSettingsScopeChannelChats{}
	}
	return &tdapi.NotificationSettingsScopePrivateChats{}
}

func (s *Session) ScopeSettings(ctx context.Context, sc tg.NotificationScope) (tg.ScopeSettings, error) {
	r, err := s.td.GetScopeNotificationSettings(ctx, &tdapi.GetScopeNotificationSettingsRequest{Scope: scope(sc)})
	if err != nil {
		return tg.ScopeSettings{}, err
	}
	return tg.ScopeSettings{Muted: r.MuteFor > 0, ShowPreview: r.ShowPreview}, nil
}

func (s *Session) SetScopeSettings(ctx context.Context, sc tg.NotificationScope, in tg.ScopeSettings) error {
	cur, err := s.td.GetScopeNotificationSettings(ctx, &tdapi.GetScopeNotificationSettingsRequest{Scope: scope(sc)})
	if err != nil {
		return err
	}
	cur.ShowPreview = in.ShowPreview
	cur.MuteFor = 0
	if in.Muted {
		cur.MuteFor = muteForever
	}
	_, err = s.td.SetScopeNotificationSettings(ctx, &tdapi.SetScopeNotificationSettingsRequest{Scope: scope(sc), NotificationSettings: cur})
	return err
}

func (s *Session) ResetNotifications(ctx context.Context) error {
	_, err := s.td.ResetAllNotificationSettings(ctx, &tdapi.ResetAllNotificationSettingsRequest{})
	return err
}

// Connection returns the network state the last update reported.
func (s *Session) Connection() tg.ConnectionState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn
}

// UnreadCount sums the unread messages of the listed, unmuted chats, for
// the account switcher's badge.
func (s *Session) UnreadCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, c := range s.chats {
		if inList(c) && (c.NotificationSettings == nil || c.NotificationSettings.MuteFor == 0) {
			n += int(c.UnreadCount)
		}
	}
	return n
}

var _ tg.Repository = (*Session)(nil)

// pollTyping clears typing that its sender stopped reporting.
func (s *Session) pollTyping() {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-s.done:
			return
		case now := <-t.C:
			s.mu.Lock()
			var stale []int64
			for id, until := range s.typing {
				if now.After(until) {
					stale = append(stale, id)
					delete(s.typing, id)
				}
			}
			s.mu.Unlock()
			for _, id := range stale {
				s.emit(tg.TypingChanged{ChatID: tg.ChatID(id)})
			}
		}
	}
}
