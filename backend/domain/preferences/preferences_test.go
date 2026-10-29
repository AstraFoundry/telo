package preferences

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestNormalizeFallsBackToDefaults(t *testing.T) {
	p := Default()
	p.Theme, p.Accent, p.TextSize, p.TimeFormat, p.Wallpaper = "neon", "teal", 40, "36h", "stars"
	p.SidebarWidth, p.AgentPanelWidth, p.AutoLockMinutes = 10, 9000, 7
	n := p.Normalize()
	d := Default()
	if n.Theme != d.Theme || n.Accent != d.Accent || n.TextSize != d.TextSize || n.TimeFormat != d.TimeFormat || n.Wallpaper != d.Wallpaper {
		t.Fatalf("%+v", n)
	}
	if n.SidebarWidth != d.SidebarWidth || n.AgentPanelWidth != d.AgentPanelWidth || n.AutoLockMinutes != d.AutoLockMinutes {
		t.Fatalf("%+v", n)
	}
}

func TestNormalizeClampsCacheAndCapsLists(t *testing.T) {
	p := Default()
	p.CacheLimitMB = 99999
	for i := 0; i < 40; i++ {
		p.RecentEmojis = append(p.RecentEmojis, string(rune('a'+i%30)))
	}
	p.RecentSearches = []int64{5, 5, 0, 7}
	p.Templates = []Template{{Title: " A ", Body: " b "}, {Title: "", Body: "x"}}
	n := p.Normalize()
	if n.CacheLimitMB != CacheLimitMax {
		t.Fatal(n.CacheLimitMB)
	}
	if len(n.RecentEmojis) != RecentEmojisMax {
		t.Fatal(len(n.RecentEmojis))
	}
	if !slices.Equal(n.RecentSearches, []int64{5, 7}) {
		t.Fatal(n.RecentSearches)
	}
	if len(n.Templates) != 1 || n.Templates[0].Title != "A" || n.Templates[0].ID == "" {
		t.Fatal(n.Templates)
	}
}

// A file the Electron build wrote, missing newer fields, keeps the defaults
// for them.
func TestElectronFileUpgrades(t *testing.T) {
	p := Default()
	if err := json.Unmarshal([]byte(`{"theme":"dark","accentColor":"green","messageTextSize":16,"autoDownloadFiles":true}`), &p); err != nil {
		t.Fatal(err)
	}
	p = p.Normalize()
	if p.Theme != ThemeDark || p.Accent != AccentGreen || p.TextSize != 16 || !p.AutoFiles || !p.SendWithEnter || !p.SuggestStickers {
		t.Fatalf("%+v", p)
	}
}

func TestPushRecent(t *testing.T) {
	got := PushRecent([]string{"a", "b", "c"}, "b", 2)
	if !slices.Equal(got, []string{"b", "a"}) {
		t.Fatal(got)
	}
}
