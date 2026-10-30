package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRepositoryFollowsTheRules(t *testing.T) {
	fails, err := Check("../..")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range fails {
		t.Error(f)
	}
}

func TestViolationsAreCaught(t *testing.T) {
	root := t.TempDir()
	write := func(path, body string) {
		full := filepath.Join(root, path)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	imp := func(pkg, dep string) string {
		return "package " + filepath.Base(pkg) + "\n\nimport _ \"" + module + dep + "\"\n"
	}
	write("backend/domain/x/x.go", imp("x", "backend/infrastructure/storage"))
	write("frontend/entities/chat/chat.go", imp("chat", "frontend/features/compose"))
	write("frontend/features/a/a.go", imp("a", "frontend/features/b"))
	write("frontend/widgets/w/w.go", imp("w", "backend/infrastructure/tdlib"))
	write("frontend/pages/p/p.go", imp("p", "frontend/widgets/w"))
	fails, err := Check(root)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(fails, "\n")
	for _, want := range []string{"backend/domain/x/x.go", "frontend/entities/chat/chat.go", "frontend/features/a/a.go", "frontend/widgets/w/w.go"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missed %s in:\n%s", want, joined)
		}
	}
	if strings.Contains(joined, "frontend/pages/p/p.go") {
		t.Error("a page may import a widget")
	}
}
