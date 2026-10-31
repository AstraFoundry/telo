package keywordfolder

import (
	"strings"
	"testing"
)

func TestNew(t *testing.T) {
	f, err := New(-1, "  Invoices ", " invoice ")
	if err != nil || f.Title != "Invoices" || f.Query != "invoice" {
		t.Fatal(f, err)
	}
	if _, err := New(1, "a", "b"); err != ErrID {
		t.Fatal(err)
	}
	if _, err := New(-1, "", "b"); err != ErrTitleRequired {
		t.Fatal(err)
	}
	if _, err := New(-1, "a", " "); err != ErrQueryRequired {
		t.Fatal(err)
	}
	if _, err := New(-1, strings.Repeat("a", TitleMax+1), "b"); err == nil {
		t.Fatal("long title accepted")
	}
}

func TestNextIDAndMatches(t *testing.T) {
	if NextID(nil) != -1 || NextID([]Folder{{ID: -1}, {ID: -4}}) != -5 {
		t.Fatal("next id")
	}
	if !Matches("Your INVOICE is ready", "invoice") || Matches("hello", "invoice") || Matches("x", " ") {
		t.Fatal("matches")
	}
}
