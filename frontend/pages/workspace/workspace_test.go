package workspace

import (
	"testing"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	"github.com/AstraFoundry/telo/backend/infrastructure/telegram/demo"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/lib/timefmt"
	"github.com/AstraFoundry/telo/frontend/shared/media"
	"github.com/AstraFoundry/telo/frontend/shared/testkit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

type harness struct {
	env   *testkit.Env
	store *chat.Store
	page  *Page
	tt    *ui.Tester
}

func open(t *testing.T, appearance preferences.Theme) *harness {
	env := testkit.New(t, func(p *preferences.Preferences) { p.Theme = appearance })
	env.Desktop.Focus = true
	h := &harness{env: env, store: chat.New(env.Runtime), page: &Page{}}
	h.store.Start()
	t.Cleanup(h.store.Stop)
	images := media.NewImages(64, func() {})
	view := func(c *ui.Context) {
		env.Runtime.Drain()
		prefs := env.Runtime.Preferences.Get()
		tokens := theme.Apply(c, prefs.Theme, prefs.Accent)
		h.page.Render(c, Env{
			Tokens: tokens, Runtime: env.Runtime, Store: h.store, Images: images,
			Formats: timefmt.Formats{Locale: "en-US"}, Prefs: prefs, Mac: true,
		})
	}
	h.tt = ui.NewTester(view, 1180, 760)
	env.Settle(t, h.tt.Frame)
	return h
}

func TestWorkspaceShowsListAndConversation(t *testing.T) {
	for _, appearance := range []preferences.Theme{preferences.ThemeLight, preferences.ThemeDark} {
		h := open(t, appearance)
		if !h.tt.HasText("Saved Messages") || !h.tt.HasText("Telo Design") {
			t.Fatalf("chat list: %q", h.tt.Texts())
		}
		testkit.Snapshot(t, h.tt, "workspace-empty-"+string(appearance))
		if err := h.tt.Click("Telo Design"); err != nil {
			t.Fatal(err)
		}
		h.env.Settle(t, h.tt.Frame)
		h.tt.Advance(600e6)
		if h.store.Selected != demo.DesignChat {
			t.Fatalf("selected %v", h.store.Selected)
		}
		testkit.Snapshot(t, h.tt, "workspace-chat-"+string(appearance))
	}
}

func TestWorkspaceSendsAndSearches(t *testing.T) {
	h := open(t, preferences.ThemeLight)
	h.page.Open(Env{Store: h.store}, demo.DesignChat, 0)
	h.env.Settle(t, h.tt.Frame)
	if !h.tt.Focused(copy.T(copy.MessagePlaceholder)) {
		t.Fatal("opening a chat leaves the composer without the keyboard")
	}
	before := len(h.store.Transcript(demo.DesignChat).Messages)
	h.tt.Type("Ship it **today**")
	h.tt.Key(0, ui.KeyEnter)
	h.env.Settle(t, h.tt.Frame)
	ms := h.store.Transcript(demo.DesignChat).Messages
	if len(ms) != before+1 || ms[len(ms)-1].Body != "Ship it today" || len(ms[len(ms)-1].Entities) != 1 {
		t.Fatalf("sent %d → %d, last %+v", before, len(ms), ms[len(ms)-1])
	}
	h.tt.Key(ui.Cmd, ui.KeyK)
	h.tt.Frame()
	h.tt.Type("mina")
	h.tt.Advance(400e6)
	h.env.Settle(t, h.tt.Frame)
	testkit.Snapshot(t, h.tt, "workspace-search")
	if !h.tt.HasText("Mina") {
		t.Fatalf("search results: %q", h.tt.Texts())
	}
}
