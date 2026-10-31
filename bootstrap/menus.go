package bootstrap

import (
	"strings"

	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/egoist/mygo"
)

// MenuEntry is an item of the menu bar and the telegram-macos menu item it
// matches. The parity check reads the registry; Menu builds the bar.
type MenuEntry struct {
	// Upstream is the inventory id, "" for Telo's own items.
	Upstream string
	// Label is the item's copy; "" keeps the role's own label.
	Label copy.Key
	Role  mygo.MenuRole
	// Accelerator is the key in MyGo's notation, "CmdOrCtrl+Shift+F".
	Accelerator string
	// Action names what the item does when it has no role.
	Action  string
	Submenu []MenuEntry
	// Separator draws a line instead of an item.
	Separator bool
}

// Actions a menu item runs.
const (
	actAbout       = "about"
	actSettings    = "settings"
	actQuickSearch = "quick-search"
	actHideWindow  = "hide-window"
	actShowWindow  = "show-window"
	actUpdates     = "updates"
	actAgent       = "toggle-agent"
	actLock        = "lock"
)

var separator = MenuEntry{Separator: true}

// Menus is the menu bar: the app menu, Edit, View and Window, as
// telegram-macos's MainMenu.xib lays them out.
var Menus = []MenuEntry{
	{Upstream: "menu:TelegramMac", Label: copy.MenuMainWindow, Submenu: []MenuEntry{
		{Upstream: "menu:TelegramMac › About Telegram", Label: copy.MenuAbout, Action: actAbout},
		{Upstream: "menu:TelegramMac › Check for Updates", Label: copy.MenuCheckUpdates, Action: actUpdates},
		separator,
		{Upstream: "menu:TelegramMac › Preferences…", Label: copy.MenuSettings, Accelerator: "CmdOrCtrl+,", Action: actSettings},
		{Upstream: "menu:TelegramMac › Quick Switcher", Label: copy.MenuQuickSwitcher, Accelerator: "CmdOrCtrl+K", Action: actQuickSearch},
		{Label: copy.MenuLock, Accelerator: "CmdOrCtrl+L", Action: actLock},
		separator,
		{Upstream: "menu:TelegramMac › Hide", Label: copy.Close, Accelerator: "CmdOrCtrl+W", Action: actHideWindow},
		{Upstream: "menu:TelegramMac › Hide Telegram", Label: copy.MenuHide, Role: mygo.RoleHide, Accelerator: "Cmd+H"},
		{Upstream: "menu:TelegramMac › Hide Others", Label: copy.MenuHideOthers, Role: mygo.RoleHideOthers, Accelerator: "Cmd+Alt+H"},
		{Upstream: "menu:TelegramMac › Show All", Label: copy.MenuShowAll, Role: mygo.RoleUnhide},
		separator,
		{Upstream: "menu:TelegramMac › Quit Telegram", Label: copy.MenuQuit, Role: mygo.RoleQuit, Accelerator: "CmdOrCtrl+Q"},
	}},
	{Upstream: "menu:Edit", Label: copy.MenuEdit, Submenu: []MenuEntry{
		{Upstream: "menu:Edit › Undo", Role: mygo.RoleUndo, Accelerator: "CmdOrCtrl+Z"},
		{Upstream: "menu:Edit › Redo", Role: mygo.RoleRedo, Accelerator: "CmdOrCtrl+Shift+Z"},
		separator,
		{Upstream: "menu:Edit › Cut", Role: mygo.RoleCut, Accelerator: "CmdOrCtrl+X"},
		{Upstream: "menu:Edit › Copy", Role: mygo.RoleCopy, Accelerator: "CmdOrCtrl+C"},
		{Upstream: "menu:Edit › Paste", Role: mygo.RolePaste, Accelerator: "CmdOrCtrl+V"},
		{Upstream: "menu:Edit › Paste and Match Style", Role: mygo.RolePasteAndMatchStyle, Accelerator: "CmdOrCtrl+Alt+Shift+V"},
		{Upstream: "menu:Edit › Delete", Role: mygo.RoleDelete},
		{Upstream: "menu:Edit › Select All", Role: mygo.RoleSelectAll, Accelerator: "CmdOrCtrl+A"},
	}},
	{Upstream: "menu:View", Label: copy.MenuView, Submenu: []MenuEntry{
		{Label: copy.MenuToggleAgent, Accelerator: "CmdOrCtrl+J", Action: actAgent},
		separator,
		{Upstream: "menu:View › Enter Full Screen", Label: copy.MenuFullScreen, Role: mygo.RoleToggleFullScreen, Accelerator: "Ctrl+Cmd+F"},
	}},
	{Upstream: "menu:Window", Label: copy.MenuWindow, Submenu: []MenuEntry{
		{Upstream: "menu:Window › Minimize", Label: copy.MenuMinimize, Role: mygo.RoleMinimize, Accelerator: "CmdOrCtrl+M"},
		{Upstream: "menu:Window › Zoom", Label: copy.MenuZoom, Role: mygo.RoleZoom},
		separator,
		{Upstream: "menu:Window › Telegram", Label: copy.MenuMainWindow, Accelerator: "CmdOrCtrl+O", Action: actShowWindow},
		{Upstream: "menu:Window › Bring All to Front", Label: copy.MenuBringAllToFront, Role: mygo.RoleFront},
	}},
}

// MacKeys writes an accelerator in the macOS glyphs telegram-macos and
// the inventory use: "CmdOrCtrl+Shift+F" is "⇧⌘F".
func MacKeys(accelerator string) string {
	if accelerator == "" {
		return ""
	}
	parts := strings.Split(accelerator, "+")
	key := parts[len(parts)-1]
	var mods strings.Builder
	order := []struct{ name, glyph string }{{"Ctrl", "⌃"}, {"Alt", "⌥"}, {"Shift", "⇧"}, {"Cmd", "⌘"}}
	for _, o := range order {
		for _, p := range parts[:len(parts)-1] {
			if p == o.name || o.name == "Cmd" && p == "CmdOrCtrl" {
				mods.WriteString(o.glyph)
			}
		}
	}
	return mods.String() + key
}

// MenuItems builds MyGo's items; run performs an item's action.
func MenuItems(entries []MenuEntry, run func(action string)) []*mygo.MenuItem {
	var out []*mygo.MenuItem
	for _, e := range entries {
		if e.Separator {
			out = append(out, mygo.Separator())
			continue
		}
		item := &mygo.MenuItem{Role: e.Role, Accelerator: e.Accelerator}
		if e.Label != "" {
			item.Label = copy.T(e.Label)
		}
		if e.Submenu != nil {
			item.Submenu = MenuItems(e.Submenu, run)
		}
		if action := e.Action; action != "" {
			item.Click = func(*mygo.MenuItem, *mygo.Window) { run(action) }
		}
		out = append(out, item)
	}
	return out
}

// walk visits every entry of the registry.
func walk(entries []MenuEntry, f func(MenuEntry)) {
	for _, e := range entries {
		if e.Separator {
			continue
		}
		f(e)
		walk(e.Submenu, f)
	}
}

// MenuAnchors lists the upstream menu items the bar claims, with keys.
func MenuAnchors() (out []struct{ Upstream, Keys string }) {
	walk(Menus, func(e MenuEntry) {
		if e.Upstream != "" {
			out = append(out, struct{ Upstream, Keys string }{e.Upstream, MacKeys(e.Accelerator)})
		}
	})
	return out
}
