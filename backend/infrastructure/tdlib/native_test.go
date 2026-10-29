package tdlib

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib/tdapi"
)

// stagedLibrary loads the libtdjson `make tdlib` staged. `make check`
// stages it first; a bare `go test` without it skips, unless
// TELO_REQUIRE_TDLIB=1 demands it.
func stagedLibrary(t *testing.T) *Library {
	t.Helper()
	path, err := Locate(filepath.Join("..", "..", "..", "build", "tdlib-native"))
	if err != nil {
		if os.Getenv("TELO_REQUIRE_TDLIB") == "1" {
			t.Fatal(err)
		}
		t.Skip(err)
	}
	lib, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return lib
}

func TestExecuteParsesEntities(t *testing.T) {
	lib := stagedLibrary(t)
	raw, err := lib.Execute(&tdapi.GetTextEntitiesRequest{Text: "ping @durov at https://telegram.org"})
	if err != nil {
		t.Fatal(err)
	}
	obj, err := tdapi.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	entities, ok := obj.(*tdapi.TextEntities)
	if !ok || len(entities.Entities) != 2 {
		t.Fatalf("got %#v", obj)
	}
	if _, ok := entities.Entities[0].Type.(*tdapi.TextEntityTypeMention); !ok {
		t.Fatalf("first entity %T", entities.Entities[0].Type)
	}
	if _, ok := entities.Entities[1].Type.(*tdapi.TextEntityTypeURL); !ok {
		t.Fatalf("second entity %T", entities.Entities[1].Type)
	}
}

func TestExecuteReportsErrors(t *testing.T) {
	lib := stagedLibrary(t)
	_, err := lib.Execute(&tdapi.ParseMarkdownRequest{})
	if err == nil {
		t.Fatal("want a TDLib error for an empty formatted text")
	}
	if _, ok := err.(*tdapi.Error); !ok {
		t.Fatalf("error %T %v", err, err)
	}
}

// A new client asks for its parameters first; the call/answer path is
// exercised with getOption, which needs no network.
func TestClientLifecycle(t *testing.T) {
	lib := stagedLibrary(t)
	c := lib.NewClient()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	for {
		select {
		case u := <-c.Updates():
			if s, ok := u.(*tdapi.UpdateAuthorizationState); ok {
				if _, ok := s.AuthorizationState.(*tdapi.AuthorizationStateWaitTdlibParameters); ok {
					value, err := tdapi.NewClient(c).GetOption(ctx, &tdapi.GetOptionRequest{Name: "version"})
					if err != nil {
						t.Fatal(err)
					}
					if v, ok := value.(*tdapi.OptionValueString); !ok || v.Value != "1.8.67" {
						t.Fatalf("version %#v", value)
					}
					if _, err := tdapi.NewClient(c).Close(ctx, &tdapi.CloseRequest{}); err != nil {
						t.Fatal(err)
					}
					return
				}
			}
		case <-ctx.Done():
			t.Fatal("no authorizationStateWaitTdlibParameters")
		}
	}
}
