package parity

import (
	"encoding/json"
	"fmt"
	"os"
)

// Status is how far Telo matches an upstream surface.
type Status string

const (
	// Implemented matches the upstream behavior; evidence and tests resolve.
	Implemented Status = "implemented"
	// Partial ships part of the upstream behavior; Reason names the gap.
	Partial Status = "partial"
	// Planned is a gap Telo intends to close, with a priority.
	Planned Status = "planned"
	// NotApplicable is out of Telo's scope by a recorded decision.
	NotApplicable Status = "not-applicable"
)

// Statuses lists every status in report order.
var Statuses = []Status{Implemented, Partial, Planned, NotApplicable}

// Entry classifies one or more upstream items as one Telo feature.
type Entry struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Upstream []string `json:"upstream"`
	Status   Status   `json:"status"`
	// Priority orders planned and partial work: P0, P1 or P2.
	Priority string `json:"priority,omitempty"`
	// Reason explains a partial, planned or not-applicable status.
	Reason string `json:"reason,omitempty"`
	// Decision is the repository document (an ADR) that puts a
	// not-applicable surface out of scope.
	Decision string `json:"decision,omitempty"`
	// Evidence names the Go declarations implementing the feature, as
	// "<package dir>.<Name>" or "<package dir>.<Type>.<Method>".
	Evidence []string `json:"evidence,omitempty"`
	// Tests names the Go tests proving it, as "<package dir>.<TestName>".
	Tests []string `json:"tests,omitempty"`
}

// Summary counts entries by status. The committed ledger states it, so a
// change in coverage is a reviewed edit rather than a silent drift.
type Summary map[Status]int

// Ledger is the committed classification of the upstream inventory.
type Ledger struct {
	// Inventory is the inventory file the ledger classifies, relative to
	// the repository root.
	Inventory string  `json:"inventory"`
	Commit    string  `json:"commit"`
	Summary   Summary `json:"summary"`
	Entries   []Entry `json:"entries"`
}

// LoadLedger reads a committed ledger.
func LoadLedger(path string) (*Ledger, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var l Ledger
	dec := json.NewDecoder(bytesReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&l); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &l, nil
}

// Count returns the ledger's actual status counts.
func (l *Ledger) Count() Summary {
	s := Summary{}
	for _, st := range Statuses {
		s[st] = 0
	}
	for _, e := range l.Entries {
		s[e.Status]++
	}
	return s
}
