// Command parityinventory extracts the telegram-macos feature inventory
// from a local checkout into docs/telegram/parity/upstream-inventory.json.
//
//	go run ./cmd/parityinventory -upstream ../telegram-macos
//
// Refreshing the inventory is deliberate: a new upstream commit adds and
// removes items, and `make check` then names every unclassified one.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/AstraFoundry/telo/internal/parity"
)

func main() {
	upstream := flag.String("upstream", "", "path to a telegram-macos checkout")
	out := flag.String("out", "docs/telegram/parity/upstream-inventory.json", "inventory file to write")
	flag.Parse()
	if *upstream == "" {
		fmt.Fprintln(os.Stderr, "parityinventory: -upstream is required")
		os.Exit(2)
	}
	inv, err := parity.Extract(*upstream)
	if err != nil {
		fmt.Fprintln(os.Stderr, "parityinventory:", err)
		os.Exit(1)
	}
	if err := parity.WriteJSON(*out, inv); err != nil {
		fmt.Fprintln(os.Stderr, "parityinventory:", err)
		os.Exit(1)
	}
	counts := map[parity.Kind]int{}
	for _, it := range inv.Items {
		counts[it.Kind]++
	}
	fmt.Printf("telegram-macos %s: %d items", inv.Commit[:12], len(inv.Items))
	for _, k := range parity.Kinds {
		fmt.Printf(", %d %s", counts[k], k)
	}
	fmt.Println()
}
