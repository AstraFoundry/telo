// Package parity compares Telo with Telegram for macOS.
//
// The upstream inventory is extracted from a pinned telegram-macos checkout
// (cmd/parityinventory) and committed as JSON, so `make check` validates the
// ledger offline. The ledger classifies every inventory item; the checker
// (cmd/paritycheck) resolves the Telo evidence each classification cites.
package parity

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
)

// Kind groups upstream inventory items by what they describe.
type Kind string

const (
	// KindModule is a Swift package under telegram-macos packages/.
	KindModule Kind = "module"
	// KindShortcut is a row of the upstream Shortcuts screen.
	KindShortcut Kind = "shortcut"
	// KindSetting is an entry of the upstream settings search index.
	KindSetting Kind = "setting"
	// KindSettingsRow is a row of the upstream Settings root list.
	KindSettingsRow Kind = "settings-row"
	// KindMenu is an item of the upstream application menu.
	KindMenu Kind = "menu"
	// KindMessageAction is an item of the upstream message context menu.
	KindMessageAction Kind = "message-action"
	// KindChatAction is an item of the upstream chat list context menu.
	KindChatAction Kind = "chat-action"
	// KindAttachAction is an item of the upstream composer attach menu.
	KindAttachAction Kind = "attach-action"
)

// Kinds lists every kind in the order reports print them.
var Kinds = []Kind{KindModule, KindShortcut, KindSetting, KindSettingsRow, KindMenu, KindMessageAction, KindChatAction, KindAttachAction}

// Item is one upstream feature surface.
type Item struct {
	// ID is unique across the inventory: "<kind>:<upstream identifier>".
	ID    string `json:"id"`
	Kind  Kind   `json:"kind"`
	Title string `json:"title"`
	// Keys is the upstream accelerator for shortcuts and menu items, as the
	// upstream client prints it (⌘, ⇧, ⌥, ⌃ glyphs).
	Keys string `json:"keys,omitempty"`
	// Section is the upstream group the item is listed under.
	Section string `json:"section,omitempty"`
	// Source is the upstream file the item was extracted from.
	Source string `json:"source"`
}

// Inventory is the extracted upstream surface at one commit.
type Inventory struct {
	Repository string `json:"repository"`
	Commit     string `json:"commit"`
	Items      []Item `json:"items"`
}

// Sort orders items by kind, then identifier, so the committed JSON diffs
// cleanly between refreshes.
func (inv *Inventory) Sort() {
	rank := map[Kind]int{}
	for i, k := range Kinds {
		rank[k] = i
	}
	sort.SliceStable(inv.Items, func(a, b int) bool {
		ia, ib := inv.Items[a], inv.Items[b]
		if ia.Kind != ib.Kind {
			return rank[ia.Kind] < rank[ib.Kind]
		}
		return ia.ID < ib.ID
	})
}

// Index maps item identifiers to items.
func (inv *Inventory) Index() map[string]Item {
	out := make(map[string]Item, len(inv.Items))
	for _, it := range inv.Items {
		out[it.ID] = it
	}
	return out
}

// LoadInventory reads a committed inventory.
func LoadInventory(path string) (*Inventory, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var inv Inventory
	if err := json.Unmarshal(raw, &inv); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &inv, nil
}

// WriteJSON writes v as indented JSON with a trailing newline.
func WriteJSON(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o644)
}
