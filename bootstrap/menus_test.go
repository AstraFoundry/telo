package bootstrap

import (
	"testing"

	"github.com/AstraFoundry/telo/frontend/shared/copy"
)

func TestMenus(t *testing.T) {
	if got := MacKeys("CmdOrCtrl+Shift+F"); got != "⇧⌘F" {
		t.Fatalf("MacKeys %q", got)
	}
	if got := MacKeys("Ctrl+Cmd+F"); got != "⌃⌘F" {
		t.Fatalf("MacKeys %q", got)
	}
	var ran []string
	items := MenuItems(Menus, func(a string) { ran = append(ran, a) })
	if len(items) != len(Menus) {
		t.Fatalf("%d top menus", len(items))
	}
	// Every action an item names is one App.action handles.
	known := map[string]bool{actAbout: true, actSettings: true, actQuickSearch: true, actHideWindow: true, actShowWindow: true, actUpdates: true, actAgent: true, actLock: true}
	walk(Menus, func(e MenuEntry) {
		if e.Action != "" && !known[e.Action] {
			t.Errorf("%s runs unknown action %q", e.Upstream, e.Action)
		}
		if e.Role == "" && e.Action == "" && e.Submenu == nil {
			t.Errorf("%s does nothing", e.Upstream)
		}
		if e.Label != "" && copy.T(e.Label) == string(e.Label) {
			t.Errorf("%s has no copy", e.Label)
		}
	})
	settings := items[0].Submenu[3]
	if settings.Label != copy.T(copy.MenuSettings) || settings.Accelerator != "CmdOrCtrl+," || settings.Click == nil {
		t.Fatalf("settings item %+v", settings)
	}
	settings.Click(settings, nil)
	if len(ran) != 1 || ran[0] != actSettings {
		t.Fatalf("ran %v", ran)
	}
	anchors := MenuAnchors()
	found := false
	for _, a := range anchors {
		found = found || a.Upstream == "menu:TelegramMac › Quick Switcher" && a.Keys == "⌘K"
	}
	if !found {
		t.Fatalf("anchors %v", anchors)
	}
}
