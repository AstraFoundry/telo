package config

import (
	"strings"

	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/egoist/mygo/ui"
)

// Action names what a shortcut or menu item does; the app layer maps each
// to its handler.
type Action string

// Actions of the shortcut registry.
const (
	ActOpenInfo      Action = "open-info"
	ActReplyPrev     Action = "reply-previous"
	ActReplyNext     Action = "reply-next"
	ActEditLast      Action = "edit-last"
	ActSearchChat    Action = "search-chat"
	ActQuickSearch   Action = "quick-search"
	ActGlobalSearch  Action = "global-search"
	ActSwitchAccount Action = "switch-account"
	ActBold          Action = "format-bold"
	ActItalic        Action = "format-italic"
	ActMonospace     Action = "format-monospace"
	ActLink          Action = "format-link"
	ActStrikethrough Action = "format-strikethrough"
	ActUnderline     Action = "format-underline"
	ActSpoiler       Action = "format-spoiler"
	ActLock          Action = "lock"
	ActToggleAgent   Action = "toggle-agent"
	ActSettings      Action = "settings"
	ActNextChat      Action = "next-chat"
	ActPrevChat      Action = "previous-chat"
	ActCloseChat     Action = "close-chat"
	ActSavedMessages Action = "saved-messages"
	ActFastReply     Action = "fast-reply"
	ActScheduleSend  Action = "schedule-send"
	ActSendSilent    Action = "send-silent"
)

// Binding is one key combination: modifiers and a key.
type Binding struct {
	Mods ui.Modifiers
	Key  ui.Key
}

// Shortcut is a row of the shortcut registry: an action, the keys that
// run it, the telegram-macos item it matches (Upstream, an inventory id
// the parity check resolves) and how the Shortcuts screen lists it.
type Shortcut struct {
	Action   Action
	Upstream string
	Section  copy.Key
	Title    copy.Key
	// Bindings run the action; the first is the one shown.
	Bindings []Binding
	// Gesture describes a pointer gesture instead of keys.
	Gesture copy.Key
	// InText tells whether the shortcut works while a text field has the
	// keyboard (formatting does; navigation does not).
	InText bool
}

// Shortcuts is the registry. Keys use ui.Cmd, which is Command on macOS
// and Control elsewhere, as telegram-macos's ⌘ becomes Ctrl on Windows.
var Shortcuts = []Shortcut{
	{Action: ActOpenInfo, Upstream: "shortcut:chat_open_info", Section: copy.ShortcutsChat, Title: copy.ShortcutOpenInfo, Bindings: []Binding{{0, ui.KeyRight}}},
	{Action: ActReplyPrev, Upstream: "shortcut:reply_to_message", Section: copy.ShortcutsChat, Title: copy.ShortcutReplyTo, Bindings: []Binding{{ui.Cmd, ui.KeyUp}, {ui.Cmd, ui.KeyDown}}, InText: true},
	{Action: ActEditLast, Upstream: "shortcut:edit_message", Section: copy.ShortcutsChat, Title: copy.ShortcutEditLast, Bindings: []Binding{{0, ui.KeyUp}}, InText: true},
	{Action: ActSearchChat, Upstream: "shortcut:search_in_chat", Section: copy.ShortcutsChat, Title: copy.ShortcutSearchChat, Bindings: []Binding{{ui.Cmd, ui.KeyF}}, InText: true},
	{Action: ActQuickSearch, Upstream: "shortcut:quick_search", Section: copy.ShortcutsSearch, Title: copy.ShortcutQuickSearch, Bindings: []Binding{{ui.Cmd, ui.KeyK}}, InText: true},
	{Action: ActGlobalSearch, Upstream: "shortcut:global_search", Section: copy.ShortcutsSearch, Title: copy.ShortcutGlobalSearch, Bindings: []Binding{{ui.Cmd | ui.Shift, ui.KeyF}}, InText: true},
	{Action: ActSwitchAccount, Upstream: "shortcut:switch_account", Section: copy.ShortcutsSearch, Title: copy.ShortcutSwitchAccount, Bindings: []Binding{{ui.Cmd | ui.Shift, ui.KeyM}}, InText: true},
	{Action: ActBold, Upstream: "shortcut:markdown_bold", Section: copy.ShortcutsMarkdown, Title: copy.ShortcutBold, Bindings: []Binding{{ui.Cmd, ui.KeyB}}, InText: true},
	{Action: ActItalic, Upstream: "shortcut:markdown_italic", Section: copy.ShortcutsMarkdown, Title: copy.ShortcutItalic, Bindings: []Binding{{ui.Cmd, ui.KeyI}}, InText: true},
	{Action: ActMonospace, Upstream: "shortcut:markdown_monospace", Section: copy.ShortcutsMarkdown, Title: copy.ShortcutMonospace, Bindings: []Binding{{ui.Cmd | ui.Shift, ui.KeyK}}, InText: true},
	{Action: ActLink, Upstream: "shortcut:markdown_url", Section: copy.ShortcutsMarkdown, Title: copy.ShortcutLink, Bindings: []Binding{{ui.Cmd, ui.KeyU}}, InText: true},
	{Action: ActStrikethrough, Upstream: "shortcut:markdown_strikethrough", Section: copy.ShortcutsMarkdown, Title: copy.ShortcutStrike, Bindings: []Binding{{ui.Cmd | ui.Shift, ui.KeyX}}, InText: true},
	{Action: ActLock, Upstream: "shortcut:lock_passcode", Section: copy.ShortcutsOther, Title: copy.ShortcutLock, Bindings: []Binding{{ui.Cmd, ui.KeyL}}, InText: true},
	{Action: ActToggleAgent, Section: copy.ShortcutsOther, Title: copy.ShortcutAgent, Bindings: []Binding{{ui.Cmd, ui.KeyB}}},
	{Action: ActSettings, Section: copy.ShortcutsOther, Title: copy.ShortcutSettings, Bindings: []Binding{{ui.Cmd, ui.KeyComma}}, InText: true},
	{Action: ActNextChat, Section: copy.ShortcutsChat, Title: copy.ShortcutNextChat, Bindings: []Binding{{ui.Ctrl, ui.KeyTab}, {ui.Alt, ui.KeyDown}}, InText: true},
	{Action: ActPrevChat, Section: copy.ShortcutsChat, Title: copy.ShortcutPrevChat, Bindings: []Binding{{ui.Ctrl | ui.Shift, ui.KeyTab}, {ui.Alt, ui.KeyUp}}, InText: true},
	{Action: ActFastReply, Upstream: "shortcut:fast_reply", Section: copy.ShortcutsMouse, Title: copy.ShortcutFastReply, Gesture: copy.ShortcutFastReplyValue},
	{Action: ActScheduleSend, Upstream: "shortcut:schedule", Section: copy.ShortcutsMouse, Title: copy.ShortcutSchedule, Gesture: copy.ShortcutScheduleValue},
}

// ByAction finds an action's shortcut.
func ByAction(a Action) (Shortcut, bool) {
	for _, s := range Shortcuts {
		if s.Action == a {
			return s, true
		}
	}
	return Shortcut{}, false
}

// Pressed tells whether one of the action's bindings was pressed this
// frame, anywhere in the window.
func Pressed(c *ui.Context, a Action) bool {
	s, ok := ByAction(a)
	if !ok {
		return false
	}
	for _, b := range s.Bindings {
		if c.Shortcut(b.Mods, b.Key) {
			return true
		}
	}
	return false
}

var keyGlyphs = map[ui.Key]string{
	ui.KeyUp: "↑", ui.KeyDown: "↓", ui.KeyLeft: "←", ui.KeyRight: "→", ui.KeyComma: ",", ui.KeyTab: "⇥",
	ui.KeyEnter: "↩", ui.KeyEscape: "⎋", ui.KeyPeriod: ".", ui.KeySlash: "/",
}

// MacKeys writes a binding in macOS glyphs ("⇧⌘F"), the notation of
// telegram-macos's Shortcuts screen and of the parity inventory.
func MacKeys(b Binding) string {
	var sb strings.Builder
	mods := b.Mods
	if mods&ui.Cmd != 0 && ui.Cmd != ui.Super {
		// On Linux and Windows ui.Cmd is Control: the macOS build binds ⌘.
		mods = mods&^ui.Cmd | ui.Super
	}
	if mods&ui.Ctrl != 0 {
		sb.WriteString("⌃")
	}
	if mods&ui.Alt != 0 {
		sb.WriteString("⌥")
	}
	if mods&ui.Shift != 0 {
		sb.WriteString("⇧")
	}
	if mods&ui.Super != 0 {
		sb.WriteString("⌘")
	}
	sb.WriteString(KeyName(b.Key))
	return sb.String()
}

// KeyName is a key's printed name.
func KeyName(k ui.Key) string {
	if g, ok := keyGlyphs[k]; ok {
		return g
	}
	if k >= ui.KeyA && k <= ui.KeyZ {
		return string(rune('A' + (k - ui.KeyA)))
	}
	return ""
}

// Label writes a binding for the platform the app runs on: glyphs on
// macOS, Ctrl+Shift+F elsewhere.
func Label(b Binding, mac bool) string {
	if mac {
		return MacKeys(b)
	}
	var parts []string
	if b.Mods&ui.Ctrl != 0 || b.Mods&ui.Cmd != 0 {
		parts = append(parts, "Ctrl")
	}
	if b.Mods&ui.Alt != 0 {
		parts = append(parts, "Alt")
	}
	if b.Mods&ui.Shift != 0 {
		parts = append(parts, "Shift")
	}
	names := map[ui.Key]string{ui.KeyUp: "Up", ui.KeyDown: "Down", ui.KeyLeft: "Left", ui.KeyRight: "Right", ui.KeyTab: "Tab", ui.KeyComma: ","}
	name, ok := names[b.Key]
	if !ok {
		name = KeyName(b.Key)
	}
	return strings.Join(append(parts, name), "+")
}

// AllMacKeys writes every binding of a shortcut, "⌘↑ / ⌘↓".
func AllMacKeys(s Shortcut) string {
	var out []string
	for _, b := range s.Bindings {
		out = append(out, MacKeys(b))
	}
	return strings.Join(out, " / ")
}
