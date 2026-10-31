// Package settings is the Settings page's panes and its search index.
// Every section and searchable setting names the telegram-macos settings
// item it matches, which `make check` resolves against the inventory.
package settings

import (
	"strings"

	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/egoist/mygo/ui"
)

// Section is a pane of Settings.
type Section string

const (
	SectionProfile       Section = "profile"
	SectionGeneral       Section = "general"
	SectionNotifications Section = "notifications"
	SectionPrivacy       Section = "privacy"
	SectionData          Section = "data"
	SectionAppearance    Section = "appearance"
	SectionLanguage      Section = "language"
	SectionStickers      Section = "stickers"
	SectionFolders       Section = "folders"
	SectionSessions      Section = "sessions"
	SectionProxy         Section = "proxy"
	SectionAgent         Section = "agent"
	SectionShortcuts     Section = "shortcuts"
	SectionAbout         Section = "about"
)

// SectionInfo is a row of the Settings list.
type SectionInfo struct {
	ID    Section
	Title copy.Key
	Icon  *ui.SVG
	// Upstream are the telegram-macos settings rows the section stands for.
	Upstream []string
}

// Sections lists the panes in the order of the list, grouped as
// telegram-macos groups its rows.
var Sections = [][]SectionInfo{
	{
		{SectionProfile, copy.SettingsEditProfile, icons.User, []string{"settings-row:accountRecord", "settings-row:info"}},
	},
	{
		{SectionGeneral, copy.SettingsGeneral, icons.GearSix, []string{"settings-row:general"}},
		{SectionNotifications, copy.SettingsNotifications, icons.Bell, []string{"settings-row:notifications"}},
		{SectionPrivacy, copy.SettingsPrivacy, icons.LockSimple, []string{"settings-row:privacy"}},
		{SectionData, copy.SettingsData, icons.HardDrives, []string{"settings-row:dataAndStorage"}},
		{SectionAppearance, copy.SettingsAppearance, icons.Palette, []string{"settings-row:appearance"}},
		{SectionLanguage, copy.SettingsLanguage, icons.Globe, []string{"settings-row:language"}},
		{SectionStickers, copy.SettingsStickers, icons.Sticker, []string{"settings-row:stickers"}},
		{SectionFolders, copy.SettingsFolders, icons.Folder, []string{"settings-row:filters"}},
	},
	{
		{SectionSessions, copy.SettingsSessions, icons.Devices, []string{"settings-row:activeSessions"}},
		{SectionProxy, copy.SettingsProxy, icons.ShieldCheck, []string{"settings-row:proxy"}},
	},
	{
		{SectionAgent, copy.SettingsAgent, icons.Sparkle, nil},
		{SectionShortcuts, copy.SettingsShortcuts, icons.Keyboard, nil},
		{SectionAbout, copy.SettingsAbout, icons.Info, []string{"settings-row:about"}},
	},
}

// SectionByID finds a section.
func SectionByID(id Section) (SectionInfo, bool) {
	for _, g := range Sections {
		for _, s := range g {
			if s.ID == id {
				return s, true
			}
		}
	}
	return SectionInfo{}, false
}

// Entry is one setting search answers with.
type Entry struct {
	Section Section
	Label   copy.Key
	// Upstream are the telegram-macos settings search items it matches.
	Upstream []string
}

// Entries is the search index: every setting the panes draw.
var Entries = []Entry{
	{SectionProfile, copy.SettingsEditProfile, []string{"setting:profile(0)"}},
	{SectionProfile, copy.ProfileBio, []string{"setting:profile(1)"}},
	{SectionProfile, copy.ProfileChangePhone, []string{"setting:profile(2)"}},
	{SectionProfile, copy.ProfileUsername, []string{"setting:profile(3)"}},
	{SectionProfile, copy.SettingsAddAccount, []string{"setting:profile(4)"}},
	{SectionProfile, copy.LogOut, []string{"setting:profile(5)"}},
	{SectionProfile, copy.ProfileSetPhoto, nil},

	{SectionGeneral, copy.GeneralSendWith, nil},
	{SectionGeneral, copy.GeneralTimeFormat, nil},
	{SectionGeneral, copy.GeneralReduceMotion, nil},
	{SectionGeneral, copy.GeneralTemplates, nil},
	{SectionGeneral, copy.ArchiveKeepUnmuted, nil},

	{SectionNotifications, copy.SettingsNotifications, []string{"setting:notifications(0)"}},
	{SectionNotifications, copy.NotifyDesktop, nil},
	{SectionNotifications, copy.NotifyPrivate, []string{"setting:notifications(base)"}},
	{SectionNotifications, copy.NotifyGroups, []string{"setting:notifications(18)"}},
	{SectionNotifications, copy.NotifyChannels, []string{"setting:notifications(19)"}},
	{SectionNotifications, copy.NotifyPreview, []string{"setting:notifications(2)"}},
	{SectionNotifications, copy.NotifySender, nil},
	{SectionNotifications, copy.NotifyCountMuted, []string{"setting:notifications(20)"}},
	{SectionNotifications, copy.NotifySound, []string{"setting:notifications(24)"}},
	{SectionNotifications, copy.NotifyReset, []string{"setting:notifications(22)"}},

	{SectionPrivacy, copy.SettingsPrivacy, []string{"setting:privacy(0)"}},
	{SectionPrivacy, copy.PrivacyBlocked, []string{"setting:privacy(1)"}},
	{SectionPrivacy, copy.PrivacyPhone, nil},
	{SectionPrivacy, copy.PrivacyLastSeen, []string{"setting:privacy(2)"}},
	{SectionPrivacy, copy.PrivacyProfilePhoto, []string{"setting:privacy(3)"}},
	{SectionPrivacy, copy.PrivacyForwards, []string{"setting:privacy(4)"}},
	{SectionPrivacy, copy.PrivacyCalls, []string{"setting:privacy(5)"}},
	{SectionPrivacy, copy.PrivacyGroups, []string{"setting:privacy(6)"}},
	{SectionPrivacy, copy.PrivacyBio, nil},
	{SectionPrivacy, copy.PrivacyVoice, nil},
	{SectionPrivacy, copy.PrivacyPasscode, []string{"setting:privacy(7)"}},
	{SectionPrivacy, copy.PrivacyTwoStep, []string{"setting:privacy(8)"}},
	{SectionPrivacy, copy.SettingsSessions, []string{"setting:privacy(9)"}},
	{SectionPrivacy, copy.PrivacyDeleteAccount, []string{"setting:privacy(10)"}},

	{SectionData, copy.SettingsData, []string{"setting:data(0)"}},
	{SectionData, copy.DataStorage, []string{"setting:data(1)"}},
	{SectionData, copy.DataCacheLimit, []string{"setting:data(2)"}},
	{SectionData, copy.DataClearCache, []string{"setting:data(3)"}},
	{SectionData, copy.DataNetwork, []string{"setting:data(4)"}},
	{SectionData, copy.DataAutoReset, []string{"setting:data(7)"}},
	{SectionData, copy.DataAutoPhotos, nil},
	{SectionData, copy.DataAutoVideos, []string{"setting:data(8)", "setting:data(9)"}},
	{SectionData, copy.DataAutoFiles, nil},

	{SectionAppearance, copy.SettingsAppearance, []string{"setting:appearance(0)"}},
	{SectionAppearance, copy.AppearanceTextSize, []string{"setting:appearance(1)"}},
	{SectionAppearance, copy.AppearanceWallpaper, []string{"setting:appearance(2)"}},
	{SectionAppearance, copy.AppearanceAutoNight, []string{"setting:appearance(5)"}},
	{SectionAppearance, copy.AppearanceAccent, []string{"setting:appearance(6)"}},
	{SectionAppearance, copy.AppearanceTheme, nil},

	{SectionLanguage, copy.SettingsLanguage, []string{"setting:language(0)", "setting:language(index)"}},
	{SectionLanguage, copy.LanguageTranslate, nil},

	{SectionStickers, copy.SettingsStickers, []string{"setting:stickers(0)"}},
	{SectionStickers, copy.StickersSuggest, []string{"setting:stickers(1)"}},
	{SectionStickers, copy.StickersTrending, []string{"setting:stickers(3)"}},
	{SectionStickers, copy.StickersArchived, []string{"setting:stickers(4)"}},
	{SectionStickers, copy.StickersLoop, nil},

	{SectionFolders, copy.FoldersTelegram, nil},
	{SectionFolders, copy.FoldersKeyword, nil},

	{SectionSessions, copy.SessionsTerminateAll, nil},

	{SectionProxy, copy.SettingsProxy, []string{"setting:proxy(0)"}},
	{SectionProxy, copy.ProxyAdd, []string{"setting:proxy(1)"}},

	{SectionAgent, copy.AgentProvider, nil},
	{SectionAgent, copy.AgentModel, nil},
	{SectionAgent, copy.AgentAPIKey, nil},
	{SectionAgent, copy.AgentInstructions, nil},
	{SectionAgent, copy.AgentRules, nil},
	{SectionAgent, copy.AgentTasks, nil},

	{SectionShortcuts, copy.SettingsShortcuts, nil},
	{SectionAbout, copy.SettingsAbout, nil},
}

// Search returns the entries whose label or section title contains q.
func Search(q string) []Entry {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return nil
	}
	var out []Entry
	for _, e := range Entries {
		s, _ := SectionByID(e.Section)
		if strings.Contains(strings.ToLower(copy.T(e.Label)), q) || strings.Contains(strings.ToLower(copy.T(s.Title)), q) {
			out = append(out, e)
		}
	}
	return out
}

// Upstream lists every telegram-macos settings item the page claims.
func Upstream() []string {
	var out []string
	for _, g := range Sections {
		for _, s := range g {
			out = append(out, s.Upstream...)
		}
	}
	for _, e := range Entries {
		out = append(out, e.Upstream...)
	}
	return out
}
