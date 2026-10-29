package parity

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestNormalizeKeys(t *testing.T) {
	cases := map[string][]string{
		"⌘B / **":      {"⌘B"},
		"⇧⌘K / `":      {"⇧⌘K"},
		"⌘↑ / ⌘↓":      {"⌘↑", "⌘↓"},
		"Double Click": nil,
		"⌘⇧F":          {"⇧⌘F"},
		"↑":            {"↑"},
	}
	for in, want := range cases {
		if got := NormalizeKeys(in); !slices.Equal(got, want) {
			t.Errorf("NormalizeKeys(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestAccessorName(t *testing.T) {
	if got := accessorName("ShortcutsController.Chat.OpenInfo"); got != "shortcutsControllerChatOpenInfo" {
		t.Fatal(got)
	}
}

func TestMenuKeys(t *testing.T) {
	if got := menuKeys("h", "option command"); got != "⌥⌘H" {
		t.Fatal(got)
	}
	if got := menuKeys("Z", ""); got != "⇧⌘Z" {
		t.Fatal(got)
	}
}

// fixture writes a Go package with one declaration and one test.
func fixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "frontend", "feature")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("feature.go", "package feature\n\ntype Panel struct{}\n\nfunc (p *Panel) Open() {}\n\nfunc Search() {}\n")
	write("feature_test.go", "package feature\n\nimport \"testing\"\n\nfunc TestSearch(t *testing.T) {}\n")
	if err := os.MkdirAll(filepath.Join(root, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "docs", "adr.md"), []byte("# ADR\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func sampleInventory() *Inventory {
	return &Inventory{Commit: "abc", Items: []Item{
		{ID: "shortcut:quick_search", Kind: KindShortcut, Title: "Quick Search", Keys: "⌘K"},
		{ID: "module:WalletUI", Kind: KindModule, Title: "WalletUI"},
		{ID: "shortcut:fast_reply", Kind: KindShortcut, Title: "Fast Reply", Keys: "Double Click"},
	}}
}

func sampleLedger() *Ledger {
	l := &Ledger{Commit: "abc", Entries: []Entry{
		{ID: "search.quick", Title: "Quick search", Upstream: []string{"shortcut:quick_search"}, Status: Implemented,
			Evidence: []string{"frontend/feature.Search", "frontend/feature.Panel.Open"}, Tests: []string{"frontend/feature.TestSearch"}},
		{ID: "wallet", Title: "Wallet", Upstream: []string{"module:WalletUI"}, Status: NotApplicable, Reason: "No wallets.", Decision: "docs/adr.md"},
		{ID: "message.fast-reply", Title: "Fast reply", Upstream: []string{"shortcut:fast_reply"}, Status: Planned, Priority: "P1", Reason: "Double click is not wired."},
	}}
	l.Summary = l.Count()
	return l
}

func TestCheckPasses(t *testing.T) {
	root := fixture(t)
	r := Check(root, sampleInventory(), sampleLedger(), []Anchor{{Upstream: "shortcut:quick_search", Keys: "⌘K", Owner: "shortcuts"}})
	if len(r.Failures) > 0 {
		t.Fatalf("unexpected failures: %q", r.Failures)
	}
	if r.Covered != 3 {
		t.Fatalf("covered %d", r.Covered)
	}
}

func TestCheckFailures(t *testing.T) {
	root := fixture(t)
	cases := []struct {
		name    string
		edit    func(*Inventory, *Ledger, *[]Anchor)
		message string
	}{
		{"unclassified upstream item", func(inv *Inventory, _ *Ledger, _ *[]Anchor) {
			inv.Items = append(inv.Items, Item{ID: "module:StarsUI", Kind: KindModule, Title: "StarsUI"})
		}, "upstream module:StarsUI (StarsUI) is not classified"},
		{"missing evidence declaration", func(_ *Inventory, l *Ledger, _ *[]Anchor) {
			l.Entries[0].Evidence = []string{"frontend/feature.Missing"}
		}, "declares no Missing"},
		{"missing test", func(_ *Inventory, l *Ledger, _ *[]Anchor) {
			l.Entries[0].Tests = []string{"frontend/feature.TestMissing"}
		}, "has no test TestMissing"},
		{"wrong accelerator", func(_ *Inventory, _ *Ledger, a *[]Anchor) {
			(*a)[0].Keys = "⌘J"
		}, `upstream binds "⌘K"`},
		{"implemented without registry", func(_ *Inventory, _ *Ledger, a *[]Anchor) {
			*a = nil
		}, "no Telo registry binds it"},
		{"stale summary", func(_ *Inventory, l *Ledger, _ *[]Anchor) {
			l.Summary[Implemented] = 5
		}, "summary states 5 implemented"},
		{"missing decision", func(_ *Inventory, l *Ledger, _ *[]Anchor) {
			l.Entries[1].Decision = "docs/none.md"
		}, "decision docs/none.md does not exist"},
		{"planned without priority", func(_ *Inventory, l *Ledger, _ *[]Anchor) {
			l.Entries[2].Priority = ""
		}, "without a P0/P1/P2 priority"},
		{"registry binds a planned item", func(_ *Inventory, _ *Ledger, a *[]Anchor) {
			*a = append(*a, Anchor{Upstream: "shortcut:fast_reply", Owner: "shortcuts"})
		}, "which the ledger marks planned"},
		{"double claim", func(_ *Inventory, l *Ledger, _ *[]Anchor) {
			l.Entries[2].Upstream = []string{"module:WalletUI"}
		}, "claimed by both"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			inv, l := sampleInventory(), sampleLedger()
			anchors := []Anchor{{Upstream: "shortcut:quick_search", Keys: "⌘K", Owner: "shortcuts"}}
			tc.edit(inv, l, &anchors)
			r := Check(root, inv, l, anchors)
			if !slices.ContainsFunc(r.Failures, func(f string) bool { return strings.Contains(f, tc.message) }) {
				t.Fatalf("want a failure containing %q, got %q", tc.message, r.Failures)
			}
		})
	}
}
