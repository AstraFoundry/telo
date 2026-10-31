package copy

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strconv"
	"testing"
	"time"
)

// Every generated key resolves, so a view can never ask for a message the
// catalog lacks.
func TestEveryKeyResolves(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "keys_gen.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	ast.Inspect(file, func(node ast.Node) bool {
		spec, ok := node.(*ast.ValueSpec)
		if !ok {
			return true
		}
		for _, v := range spec.Values {
			lit := v.(*ast.BasicLit)
			key, _ := strconv.Unquote(lit.Value)
			if T(Key(key)) == "" {
				t.Errorf("%s is empty", key)
			}
			n++
		}
		return true
	})
	if n != len(messages) {
		t.Fatalf("keys_gen.go has %d keys, en.copy %d: regenerate with go run ./cmd/copygen", n, len(messages))
	}
}

func TestFormatting(t *testing.T) {
	if got := Plural(1, Member, Members); got != "1 member" {
		t.Fatal(got)
	}
	if got := Plural(4, Member, Members); got != "4 members" {
		t.Fatal(got)
	}
	cases := map[int]string{999: "999", 1200: "1.2K", 1000: "1K", 15300: "15K", 2_400_000: "2.4M"}
	for n, want := range cases {
		if got := Count(n); got != want {
			t.Errorf("Count(%d) = %q, want %q", n, got, want)
		}
	}
	if got := Bytes(248_320); got != "242.5 KB" {
		t.Fatal(got)
	}
	if got := Duration(65 * time.Second); got != "1:05" {
		t.Fatal(got)
	}
	if got := Duration(3725 * time.Second); got != "1:02:05" {
		t.Fatal(got)
	}
}
