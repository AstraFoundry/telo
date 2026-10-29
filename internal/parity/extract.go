package parity

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf16"
)

// Upstream source paths inside a telegram-macos checkout.
const (
	upstreamStrings   = "Telegram-Mac/en.lproj/Localizable.strings"
	upstreamMainMenu  = "Telegram-Mac/en.lproj/MainMenu.xib"
	upstreamShortcuts = "packages/SettingsUI/Sources/SettingsUI/ShortcutListController.swift"
	upstreamSearch    = "packages/SettingsUI/Sources/SettingsUI/SettingsSearchableItems.swift"
	upstreamAccount   = "packages/SettingsUI/Sources/SettingsUI/AccountViewController.swift"
	upstreamPackages  = "packages"
	upstreamMessage   = "packages/ChatUI/Sources/ChatUI/ChatMessageMenuItems.swift"
	upstreamChatRow   = "packages/ChatListUI/Sources/ChatListUI/ChatListRowItem.swift"
	upstreamAttach    = "packages/ChatUI/Sources/ChatUI/ChatInputAttachView.swift"
)

// UpstreamRepository is the canonical upstream URL recorded in inventories.
const UpstreamRepository = "https://github.com/TelegramMessenger/telegram-macos"

// Extract reads the inventory from a telegram-macos checkout at root. The
// checkout needs the files named by the upstream constants; a sparse
// checkout of exactly those (plus packages/*/Package.swift) suffices.
func Extract(root string) (*Inventory, error) {
	commit, err := gitHead(root)
	if err != nil {
		return nil, err
	}
	strs, err := loadStrings(filepath.Join(root, upstreamStrings))
	if err != nil {
		return nil, err
	}
	inv := &Inventory{Repository: UpstreamRepository, Commit: commit}
	steps := []func(string, localizer) ([]Item, error){
		extractModules, extractShortcuts, extractSettings, extractSettingsRows, extractMenu,
		contextMenu(KindMessageAction, upstreamMessage),
		contextMenu(KindChatAction, upstreamChatRow),
		contextMenu(KindAttachAction, upstreamAttach),
	}
	for _, step := range steps {
		items, err := step(root, strs)
		if err != nil {
			return nil, err
		}
		inv.Items = append(inv.Items, items...)
	}
	seen := map[string]bool{}
	for _, it := range inv.Items {
		if seen[it.ID] {
			return nil, fmt.Errorf("duplicate upstream item %s", it.ID)
		}
		seen[it.ID] = true
	}
	inv.Sort()
	return inv, nil
}

func gitHead(root string) (string, error) {
	out, err := exec.Command("git", "-C", root, "rev-parse", "HEAD").Output()
	if err != nil {
		return "", fmt.Errorf("read upstream commit: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// localizer resolves the generated Swift accessor `strings().fooBarBaz` to
// the English value of the Localizable key `Foo.Bar.Baz`.
type localizer map[string]string

var stringsLine = regexp.MustCompile(`^"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)";`)

func loadStrings(path string) (localizer, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	text := decodeUTF16(raw)
	out := localizer{}
	for _, line := range strings.Split(text, "\n") {
		m := stringsLine.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		out[accessorName(m[1])] = strings.ReplaceAll(m[2], `\"`, `"`)
	}
	return out, nil
}

// decodeUTF16 decodes Apple's UTF-16 .strings files; UTF-8 passes through.
func decodeUTF16(raw []byte) string {
	if len(raw) >= 2 && raw[0] == 0xff && raw[1] == 0xfe {
		units := make([]uint16, 0, len(raw)/2)
		for i := 2; i+1 < len(raw); i += 2 {
			units = append(units, uint16(raw[i])|uint16(raw[i+1])<<8)
		}
		return string(utf16.Decode(units))
	}
	if len(raw) >= 2 && raw[0] == 0xfe && raw[1] == 0xff {
		units := make([]uint16, 0, len(raw)/2)
		for i := 2; i+1 < len(raw); i += 2 {
			units = append(units, uint16(raw[i])<<8|uint16(raw[i+1]))
		}
		return string(utf16.Decode(units))
	}
	return string(raw)
}

// accessorName is the generated accessor for a Localizable key: separators
// removed, first letter lowered ("ShortcutsController.Chat.OpenInfo" →
// "shortcutsControllerChatOpenInfo").
func accessorName(key string) string {
	var b strings.Builder
	upper := false
	for _, r := range key {
		if r == '.' || r == '_' || r == '-' || r == ' ' {
			upper = true
			continue
		}
		if upper {
			r = unicode.ToUpper(r)
			upper = false
		}
		b.WriteRune(r)
	}
	s := []rune(b.String())
	if len(s) > 0 {
		s[0] = unicode.ToLower(s[0])
	}
	return string(s)
}

var accessorCall = regexp.MustCompile(`strings\(\)\.([A-Za-z0-9_]+)`)

// text resolves the first strings() accessor in expr, or returns expr.
func (l localizer) text(expr string) string {
	if m := accessorCall.FindStringSubmatch(expr); m != nil {
		if v, ok := l[m[1]]; ok {
			return v
		}
		return m[1]
	}
	return strings.TrimSpace(expr)
}

func extractModules(root string, _ localizer) ([]Item, error) {
	manifests, err := filepath.Glob(filepath.Join(root, upstreamPackages, "*", "Package.swift"))
	if err != nil {
		return nil, err
	}
	if len(manifests) == 0 {
		return nil, fmt.Errorf("no %s/*/Package.swift in %s", upstreamPackages, root)
	}
	sort.Strings(manifests)
	items := make([]Item, 0, len(manifests))
	for _, m := range manifests {
		name := filepath.Base(filepath.Dir(m))
		rel, _ := filepath.Rel(root, m)
		items = append(items, Item{ID: "module:" + name, Kind: KindModule, Title: name, Source: filepath.ToSlash(rel)})
	}
	return items, nil
}

var (
	shortcutSection = regexp.MustCompile(`\.desc\(sectionId: sectionId, index: index, text: \.plain\((strings\(\)\.[A-Za-z0-9]+)\)`)
	shortcutRow     = regexp.MustCompile(`identifier: InputDataIdentifier\("([a-z_]+)"\), data: InputDataGeneralData\(name: (strings\(\)\.[A-Za-z0-9]+), .*?type: \.context\(((?:"[^"]*")|(?:strings\(\)\.[A-Za-z0-9]+))\)`)
)

func extractShortcuts(root string, l localizer) ([]Item, error) {
	raw, err := os.ReadFile(filepath.Join(root, upstreamShortcuts))
	if err != nil {
		return nil, err
	}
	var items []Item
	section := ""
	for _, line := range strings.Split(string(raw), "\n") {
		if m := shortcutSection.FindStringSubmatch(line); m != nil {
			section = l.text(m[1])
			continue
		}
		m := shortcutRow.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		keys := strings.Trim(m[3], `"`)
		if strings.HasPrefix(m[3], "strings()") {
			keys = l.text(m[3])
		}
		items = append(items, Item{ID: "shortcut:" + m[1], Kind: KindShortcut, Title: l.text(m[2]), Keys: keys, Section: section, Source: upstreamShortcuts})
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("no shortcuts found in %s", upstreamShortcuts)
	}
	return items, nil
}

var searchItem = regexp.MustCompile(`SettingsSearchableItem\(id: \.([a-zA-Z]+)\(([^()]*(?:\([^()]*\))?[^()]*)\), title: ([^,]+(?:\([^)]*\))?[^,]*), alternate:`)

func extractSettings(root string, l localizer) ([]Item, error) {
	raw, err := os.ReadFile(filepath.Join(root, upstreamSearch))
	if err != nil {
		return nil, err
	}
	var items []Item
	seen := map[string]bool{}
	for _, m := range searchItem.FindAllStringSubmatch(string(raw), -1) {
		arg := strings.Join(strings.Fields(m[2]), "")
		id := "setting:" + m[1] + "(" + arg + ")"
		if seen[id] {
			continue
		}
		seen[id] = true
		items = append(items, Item{ID: id, Kind: KindSetting, Title: l.text(m[3]), Section: m[1], Source: upstreamSearch})
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("no searchable settings found in %s", upstreamSearch)
	}
	return items, nil
}

var accountCase = regexp.MustCompile(`^\s*case ([a-zA-Z0-9]+)\(`)

func extractSettingsRows(root string, _ localizer) ([]Item, error) {
	raw, err := os.ReadFile(filepath.Join(root, upstreamAccount))
	if err != nil {
		return nil, err
	}
	text := string(raw)
	start := strings.Index(text, "enum AccountInfoEntry<")
	if start < 0 {
		return nil, fmt.Errorf("AccountInfoEntry not found in %s", upstreamAccount)
	}
	var items []Item
	for _, line := range strings.Split(text[start:], "\n")[1:] {
		if strings.Contains(line, "var stableId") || strings.Contains(line, "func ") {
			break
		}
		m := accountCase.FindStringSubmatch(line)
		if m == nil || m[1] == "whiteSpace" {
			continue
		}
		items = append(items, Item{ID: "settings-row:" + m[1], Kind: KindSettingsRow, Title: m[1], Source: upstreamAccount})
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("no settings rows found in %s", upstreamAccount)
	}
	return items, nil
}

var (
	menuOpen  = regexp.MustCompile(`<menuItem\b([^>]*?)(/?)>`)
	menuClose = regexp.MustCompile(`</menuItem>`)
	attr      = regexp.MustCompile(`(\w+)="([^"]*)"`)
)

// extractMenu walks MainMenu.xib, naming each item by its title path so
// "Edit › Copy" stays distinct from a Copy elsewhere.
func extractMenu(root string, _ localizer) ([]Item, error) {
	raw, err := os.ReadFile(filepath.Join(root, upstreamMainMenu))
	if err != nil {
		return nil, err
	}
	var items []Item
	var path []string
	pos := 0
	for pos < len(raw) {
		open := menuOpen.FindSubmatchIndex(raw[pos:])
		closeAt := menuClose.FindIndex(raw[pos:])
		if open == nil && closeAt == nil {
			break
		}
		if open == nil || (closeAt != nil && closeAt[0] < open[0]) {
			if len(path) > 0 {
				path = path[:len(path)-1]
			}
			pos += closeAt[1]
			continue
		}
		attrs := map[string]string{}
		for _, a := range attr.FindAllSubmatch(raw[pos+open[2]:pos+open[3]], -1) {
			attrs[string(a[1])] = xmlUnescape(string(a[2]))
		}
		selfClosing := len(bytes.TrimSpace(raw[pos+open[4]:pos+open[5]])) > 0
		title := attrs["title"]
		if attrs["isSeparatorItem"] != "YES" && title != "" {
			full := append(append([]string{}, path...), title)
			keys := ""
			if k := attrs["keyEquivalent"]; k != "" {
				keys = menuKeys(k, modifierMask(raw[pos+open[1]:]))
			}
			items = append(items, Item{ID: "menu:" + strings.Join(full, " › "), Kind: KindMenu, Title: title, Keys: keys, Section: strings.Join(path, " › "), Source: upstreamMainMenu})
		}
		if !selfClosing {
			path = append(path, title)
		}
		pos += open[1]
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("no menu items found in %s", upstreamMainMenu)
	}
	return items, nil
}

var (
	maskTag  = regexp.MustCompile(`<modifierMask key="keyEquivalentModifierMask"([^>]*)/>`)
	nextMenu = regexp.MustCompile(`<menu\b|</menuItem>`)
)

// modifierMask returns the modifiers ("option command") an item's child
// modifierMask element sets, from the bytes after the item's open tag.
func modifierMask(rest []byte) string {
	if end := nextMenu.FindIndex(rest); end != nil {
		rest = rest[:end[0]]
	}
	m := maskTag.FindSubmatch(rest)
	if m == nil {
		return ""
	}
	var mods []string
	for _, a := range attr.FindAllSubmatch(m[1], -1) {
		if string(a[2]) == "YES" {
			mods = append(mods, string(a[1]))
		}
	}
	return strings.Join(mods, " ")
}

var (
	menuItemCall  = regexp.MustCompile(`ContextMenuItem\((strings\(\)\.[A-Za-z0-9]+|[a-z][A-Za-z0-9]*)\b`)
	titleAssigned = regexp.MustCompile(`(?:let |var )?([a-z][A-Za-z0-9]*)(?:\s*:\s*String)?\s*=\s*(.*strings\(\)\..*)$`)
)

// contextMenu extracts the titles a source file passes to ContextMenuItem:
// localized accessors directly, or a local variable assigned from them
// (`let pinText = pinned ? strings().messageContextUnpin : strings().messageContextPin`).
func contextMenu(kind Kind, file string) func(string, localizer) ([]Item, error) {
	return func(root string, l localizer) ([]Item, error) {
		raw, err := os.ReadFile(filepath.Join(root, file))
		if err != nil {
			return nil, err
		}
		lines := strings.Split(string(raw), "\n")
		assigned := map[string][]string{}
		for _, line := range lines {
			if m := titleAssigned.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
				for _, a := range accessorCall.FindAllStringSubmatch(m[2], -1) {
					assigned[m[1]] = append(assigned[m[1]], a[1])
				}
			}
		}
		seen := map[string]bool{}
		var items []Item
		add := func(accessor string) {
			id := string(kind) + ":" + accessor
			title := l.text("strings()." + accessor)
			// Alerts, toasts and explanations reach ContextMenuItem as
			// headers; they are copy, not actions.
			if seen[id] || strings.Contains(title, "\\n") || strings.Contains(title, "](") || len([]rune(title)) > 48 {
				return
			}
			seen[id] = true
			items = append(items, Item{ID: id, Kind: kind, Title: title, Source: file})
		}
		for _, line := range lines {
			for _, m := range menuItemCall.FindAllStringSubmatch(line, -1) {
				if a := accessorCall.FindStringSubmatch(m[1]); a != nil {
					add(a[1])
					continue
				}
				for _, accessor := range assigned[m[1]] {
					add(accessor)
				}
			}
		}
		if len(items) == 0 {
			return nil, fmt.Errorf("no context menu items found in %s", file)
		}
		return items, nil
	}
}

func xmlUnescape(s string) string {
	return strings.NewReplacer("&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", `"`, "&apos;", "'").Replace(s)
}

// menuKeys prints an AppKit key equivalent the way the upstream Shortcuts
// screen does: modifier glyphs then the key, ⌘ implied unless a mask says
// otherwise and an upper-case key implying ⇧.
func menuKeys(key, mask string) string {
	var mods string
	if mask == "" {
		mods = "⌘"
	} else {
		for _, part := range []struct{ name, glyph string }{{"control", "⌃"}, {"option", "⌥"}, {"shift", "⇧"}, {"command", "⌘"}} {
			if strings.Contains(mask, part.name) || strings.Contains(strings.ToLower(mask), part.name) {
				mods += part.glyph
			}
		}
	}
	if r := []rune(key); len(r) == 1 && unicode.IsUpper(r[0]) && !strings.Contains(mods, "⇧") {
		mods = strings.Replace(mods, "⌘", "⇧⌘", 1)
	}
	return mods + strings.ToUpper(key)
}
