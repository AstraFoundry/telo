// Command paritycheck is the telegram-macos parity gate of `make check`:
// it validates the committed ledger against the committed upstream
// inventory, resolves every evidence and test it cites in the Go source,
// and checks that the registries Telo binds (shortcuts, menus, settings,
// context menus) claim only upstream items the ledger marks shipped, with
// the upstream keys.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/AstraFoundry/telo/bootstrap"
	"github.com/AstraFoundry/telo/frontend/features/chatactions"
	"github.com/AstraFoundry/telo/frontend/features/compose"
	"github.com/AstraFoundry/telo/frontend/features/messageactions"
	"github.com/AstraFoundry/telo/frontend/shared/config"
	"github.com/AstraFoundry/telo/frontend/widgets/settings"
	"github.com/AstraFoundry/telo/internal/parity"
)

// Anchors gathers what Telo's registries claim.
func Anchors() []parity.Anchor {
	var out []parity.Anchor
	for _, s := range config.Shortcuts {
		if s.Upstream != "" {
			out = append(out, parity.Anchor{Upstream: s.Upstream, Keys: config.AllMacKeys(s), Owner: "shortcuts"})
		}
	}
	for _, m := range bootstrap.MenuAnchors() {
		out = append(out, parity.Anchor{Upstream: m.Upstream, Keys: m.Keys, Owner: "menus"})
	}
	for _, u := range settings.Upstream() {
		out = append(out, parity.Anchor{Upstream: u, Owner: "settings"})
	}
	for _, it := range messageactions.Items {
		if it.Upstream != "" {
			out = append(out, parity.Anchor{Upstream: it.Upstream, Owner: "message actions"})
		}
	}
	for _, it := range chatactions.Items {
		if it.Upstream != "" {
			out = append(out, parity.Anchor{Upstream: it.Upstream, Owner: "chat actions"})
		}
	}
	for _, it := range compose.AttachItems {
		out = append(out, parity.Anchor{Upstream: it.Upstream, Owner: "attach menu"})
	}
	return out
}

// Run checks the repository at root and prints the report.
func Run(root, ledgerPath string, verbose bool) (*parity.Report, error) {
	ledger, err := parity.LoadLedger(ledgerPath)
	if err != nil {
		return nil, err
	}
	inv, err := parity.LoadInventory(root + "/" + ledger.Inventory)
	if err != nil {
		return nil, err
	}
	return parity.Check(root, inv, ledger, Anchors()), nil
}

func main() {
	root := flag.String("root", ".", "repository root")
	ledger := flag.String("ledger", "docs/telegram/parity/ledger.json", "parity ledger")
	flag.Parse()
	r, err := Run(*root, *ledger, false)
	if err != nil {
		fmt.Fprintln(os.Stderr, "paritycheck:", err)
		os.Exit(2)
	}
	for _, f := range r.Failures {
		fmt.Fprintln(os.Stderr, "parity:", f)
	}
	fmt.Printf("telegram-macos parity: %d of %d upstream items classified; %d implemented, %d partial, %d planned, %d not applicable\n",
		r.Covered, r.Items, r.Counts[parity.Implemented], r.Counts[parity.Partial], r.Counts[parity.Planned], r.Counts[parity.NotApplicable])
	if len(r.Failures) > 0 {
		fmt.Fprintf(os.Stderr, "parity: %d failures\n", len(r.Failures))
		os.Exit(1)
	}
}
