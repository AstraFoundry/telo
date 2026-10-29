// Package preferences holds the user's local settings and their
// invariants. A persisted file may predate a field or carry a value a
// later build does not know; Normalize turns either into the default, so
// a damaged file never stops the app.
package preferences

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"slices"
	"strings"
	"unicode/utf8"
)

// Theme is the window appearance.
type Theme string

const (
	ThemeSystem Theme = "system"
	ThemeLight  Theme = "light"
	ThemeDark   Theme = "dark"
)

// Accent is the accent palette.
type Accent string

const (
	AccentBlue   Accent = "blue"
	AccentGreen  Accent = "green"
	AccentPurple Accent = "purple"
	AccentRed    Accent = "red"
	AccentOrange Accent = "orange"
)

// Accents lists the palettes in picker order.
var Accents = []Accent{AccentBlue, AccentGreen, AccentPurple, AccentRed, AccentOrange}

// TimeFormat is how times are written.
type TimeFormat string

const (
	TimeSystem TimeFormat = "system"
	Time12h    TimeFormat = "12h"
	Time24h    TimeFormat = "24h"
)

// Wallpaper is the backdrop behind the transcript, drawn from tokens.
type Wallpaper string

const (
	WallpaperPlain    Wallpaper = "plain"
	WallpaperDots     Wallpaper = "dots"
	WallpaperGrid     Wallpaper = "grid"
	WallpaperGradient Wallpaper = "gradient"
)

// Wallpapers lists the backdrops in picker order.
var Wallpapers = []Wallpaper{WallpaperPlain, WallpaperDots, WallpaperGrid, WallpaperGradient}

// Template is a quick reply the composer inserts.
type Template struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
}

// Bounds of the numeric settings.
const (
	TextSizeDefault, TextSizeMin, TextSizeMax                 = 14, 12, 18
	SidebarWidthDefault, SidebarWidthMin, SidebarWidthMax     = 300, 240, 480
	AgentPanelWidthDefault, AgentPanelWidthMin, AgentPanelMax = 380, 300, 600
	RecentEmojisMax                                           = 24
	RecentSearchesMax                                         = 20
	TemplatesMax, TemplateTitleMax, TemplateBodyMax           = 50, 80, 2000
	CacheLimitDefault, CacheLimitMin, CacheLimitMax           = 512, 64, 4096
	AutoLockDefault                                           = 60
)

// AutoLockChoices are the passcode auto-lock delays offered, in minutes;
// 0 locks only by hand or at launch.
var AutoLockChoices = []int{0, 1, 5, 60, 300}

// Preferences is every local setting. JSON field names match the files the
// Electron build wrote, so an upgrade keeps them.
type Preferences struct {
	AgentPanelOpen  bool       `json:"agentPanelOpen"`
	DemoWorkspace   bool       `json:"demoWorkspace"`
	Theme           Theme      `json:"theme"`
	Accent          Accent     `json:"accentColor"`
	TextSize        int        `json:"messageTextSize"`
	TimeFormat      TimeFormat `json:"timeFormat"`
	SendWithEnter   bool       `json:"sendWithEnter"`
	Notifications   bool       `json:"notificationsEnabled"`
	SidebarWidth    float32    `json:"sidebarWidth"`
	AgentPanelWidth float32    `json:"agentPanelWidth"`
	RecentEmojis    []string   `json:"recentEmojis"`
	RecentSearches  []int64    `json:"recentSearches"`
	Templates       []Template `json:"messageTemplates"`
	ReduceMotion    bool       `json:"reduceMotion"`
	LoopStickers    bool       `json:"loopStickers"`
	NotifySender    bool       `json:"notificationSenderName"`
	NotifyPreview   bool       `json:"notificationPreview"`
	CountMuted      bool       `json:"countMutedChats"`
	CacheLimitMB    int        `json:"mediaCacheLimitMb"`
	Wallpaper       Wallpaper  `json:"chatWallpaper"`
	NotifyDirect    bool       `json:"notifyDirectChats"`
	NotifyGroups    bool       `json:"notifyGroupChats"`
	NotifyChannels  bool       `json:"notifyChannels"`
	NotifySound     bool       `json:"notificationSound"`
	AutoPhotos      bool       `json:"autoDownloadPhotos"`
	AutoVideos      bool       `json:"autoDownloadVideos"`
	// AutoFiles is off by default: a file is as likely a 200 MB archive
	// as a PDF, so it waits to be asked for.
	AutoFiles bool `json:"autoDownloadFiles"`
	// SuggestStickers offers stickers matching a typed emoji.
	SuggestStickers bool `json:"suggestStickers"`
	// PasscodeHash is the salted hash of the local lock passcode; empty
	// when the app has no passcode.
	PasscodeHash string `json:"passcodeHash,omitempty"`
	// AutoLockMinutes locks after that many idle minutes (0: never).
	AutoLockMinutes int `json:"autoLockMinutes"`
	// ArchiveKeepUnmuted keeps archived chats archived when an unmuted one
	// gets a message (Telegram's archive setting, mirrored to TDLib).
	ArchiveKeepUnmuted bool `json:"archiveKeepUnmuted"`
	// OnboardingDone is set once the first-run flow finished.
	OnboardingDone bool `json:"onboardingDone"`
	// SpellCheck draws the system's spelling suggestions in the composer.
	SpellCheck bool `json:"spellCheck"`
}

// Default returns the settings of a fresh install.
func Default() Preferences {
	return Preferences{
		Theme: ThemeSystem, Accent: AccentBlue, TextSize: TextSizeDefault, TimeFormat: TimeSystem,
		SendWithEnter: true, Notifications: true, SidebarWidth: SidebarWidthDefault, AgentPanelWidth: AgentPanelWidthDefault,
		LoopStickers: true, NotifySender: true, NotifyPreview: true, CacheLimitMB: CacheLimitDefault,
		Wallpaper: WallpaperPlain, NotifyDirect: true, NotifyGroups: true, NotifyChannels: true, NotifySound: true,
		AutoPhotos: true, AutoVideos: true, SuggestStickers: true, AutoLockMinutes: AutoLockDefault, SpellCheck: true,
	}
}

// Normalize returns p with every out-of-range or unknown value replaced by
// its default, the lists deduplicated and capped.
func (p Preferences) Normalize() Preferences {
	d := Default()
	if !slices.Contains([]Theme{ThemeSystem, ThemeLight, ThemeDark}, p.Theme) {
		p.Theme = d.Theme
	}
	if !slices.Contains(Accents, p.Accent) {
		p.Accent = d.Accent
	}
	if p.TextSize < TextSizeMin || p.TextSize > TextSizeMax {
		p.TextSize = d.TextSize
	}
	if !slices.Contains([]TimeFormat{TimeSystem, Time12h, Time24h}, p.TimeFormat) {
		p.TimeFormat = d.TimeFormat
	}
	if !slices.Contains(Wallpapers, p.Wallpaper) {
		p.Wallpaper = d.Wallpaper
	}
	if p.SidebarWidth < SidebarWidthMin || p.SidebarWidth > SidebarWidthMax {
		p.SidebarWidth = d.SidebarWidth
	}
	if p.AgentPanelWidth < AgentPanelWidthMin || p.AgentPanelWidth > AgentPanelMax {
		p.AgentPanelWidth = d.AgentPanelWidth
	}
	// The cache ceiling clamps rather than resets: asking for more than
	// the cache may hold lands on the ceiling.
	if p.CacheLimitMB == 0 {
		p.CacheLimitMB = d.CacheLimitMB
	}
	p.CacheLimitMB = min(CacheLimitMax, max(CacheLimitMin, p.CacheLimitMB))
	if !slices.Contains(AutoLockChoices, p.AutoLockMinutes) {
		p.AutoLockMinutes = d.AutoLockMinutes
	}
	p.RecentEmojis = uniqueCapped(p.RecentEmojis, func(s string) bool { return s != "" }, RecentEmojisMax)
	p.RecentSearches = uniqueCapped(p.RecentSearches, func(id int64) bool { return id != 0 }, RecentSearchesMax)
	var templates []Template
	for _, t := range p.Templates {
		t.Title, t.Body = truncate(strings.TrimSpace(t.Title), TemplateTitleMax), truncate(strings.TrimSpace(t.Body), TemplateBodyMax)
		if t.Title == "" || t.Body == "" {
			continue
		}
		if strings.TrimSpace(t.ID) == "" {
			t.ID = NewID()
		}
		templates = append(templates, t)
		if len(templates) == TemplatesMax {
			break
		}
	}
	p.Templates = templates
	return p
}

func uniqueCapped[T comparable](in []T, keep func(T) bool, limit int) []T {
	var out []T
	for _, v := range in {
		if keep(v) && !slices.Contains(out, v) {
			out = append(out, v)
			if len(out) == limit {
				break
			}
		}
	}
	return out
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// PushRecent puts v first in list, without duplicates, capped at limit.
func PushRecent[T comparable](list []T, v T, limit int) []T {
	out := append([]T{v}, slices.DeleteFunc(slices.Clone(list), func(x T) bool { return x == v })...)
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// NewID mints a random identifier for templates and other local records.
func NewID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// DemoTemplates seed the demo workspace's quick replies.
var DemoTemplates = []Template{
	{ID: "demo-template-on-it", Title: "On it", Body: "On it — I'll take this."},
	{ID: "demo-template-thanks", Title: "Thanks", Body: "Thanks, this is exactly what we needed."},
}

// Store persists preferences.
type Store interface {
	Get(ctx context.Context) (Preferences, error)
	Save(ctx context.Context, p Preferences) error
}
