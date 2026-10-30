package main

import "testing"

// TestLedgerResolves runs the gate in `go test`: the committed ledger
// classifies the inventory, its evidence and tests exist, and every
// registry anchor agrees with it.
func TestLedgerResolves(t *testing.T) {
	r, err := Run("../..", "../../docs/telegram/parity/ledger.json", false)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range r.Failures {
		t.Error(f)
	}
	if r.Covered != r.Items {
		t.Fatalf("%d of %d classified", r.Covered, r.Items)
	}
}
