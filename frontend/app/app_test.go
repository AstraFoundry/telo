package app

import (
	"context"
	"strings"
	"testing"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	"github.com/AstraFoundry/telo/backend/infrastructure/telegram/demo"
	"github.com/AstraFoundry/telo/frontend/pages/workspace"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/testkit"
	panes "github.com/AstraFoundry/telo/frontend/widgets/settings"
	"github.com/egoist/mygo/ui"
)

type harness struct {
	env *testkit.Env
	app *App
	tt  *ui.Tester
}

func open(t *testing.T, edit func(*preferences.Preferences)) *harness {
	env := testkit.New(t, edit)
	env.Desktop.Focus = true
	a := New(env.Runtime, Options{Region: "PT", Mac: true})
	a.Start()
	t.Cleanup(a.Close)
	tt := ui.NewTester(a.View, 1180, 760)
	h := &harness{env: env, app: a, tt: tt}
	h.settle(t)
	return h
}

func (h *harness) settle(t *testing.T) {
	h.env.Settle(t, h.tt.Frame)
	h.tt.Advance(500e6)
	h.env.Settle(t, h.tt.Frame)
}

func (h *harness) click(t *testing.T, label string) {
	t.Helper()
	if err := h.tt.Click(label); err != nil {
		t.Fatalf("%s: %v in %q", label, err, h.tt.Texts())
	}
	h.settle(t)
}

func TestSettingsSearchAndPanes(t *testing.T) {
	h := open(t, nil)
	h.tt.Key(ui.Cmd, ui.KeyComma)
	h.settle(t)
	if !h.app.inSettings || !h.tt.HasText(copy.T(copy.SettingsGeneral)) {
		t.Fatalf("⌘, opens Settings: %q", h.tt.Texts())
	}
	testkit.Snapshot(t, h.tt, "settings-profile")
	for _, s := range []panes.Section{panes.SectionGeneral, panes.SectionNotifications, panes.SectionPrivacy, panes.SectionData,
		panes.SectionAppearance, panes.SectionStickers, panes.SectionFolders, panes.SectionSessions, panes.SectionProxy,
		panes.SectionAgent, panes.SectionShortcuts, panes.SectionAbout} {
		info, _ := panes.SectionByID(s)
		h.click(t, copy.T(info.Title))
		testkit.Snapshot(t, h.tt, "settings-"+string(s))
	}
	h.app.settings.FocusSearch()
	h.tt.Frame()
	h.tt.Type("blocked")
	h.settle(t)
	if !h.tt.HasText(copy.T(copy.PrivacyBlocked)) {
		t.Fatalf("search: %q", h.tt.Texts())
	}
	testkit.Snapshot(t, h.tt, "settings-search")
	h.click(t, copy.T(copy.PrivacyBlocked))
	if h.app.settings.Section != panes.SectionPrivacy {
		t.Fatalf("a hit opens its pane: %s", h.app.settings.Section)
	}
}

func TestPasscodeLocksAndUnlocks(t *testing.T) {
	hash, err := preferences.HashPasscode("2468")
	if err != nil {
		t.Fatal(err)
	}
	h := open(t, func(p *preferences.Preferences) { p.PasscodeHash = hash })
	if !h.tt.HasText(copy.T(copy.PasscodeLocked)) {
		t.Fatalf("a passcode locks at launch: %q", h.tt.Texts())
	}
	testkit.Snapshot(t, h.tt, "lock")
	h.tt.Type("1111")
	h.tt.Key(0, ui.KeyEnter)
	h.settle(t)
	if !h.tt.HasText(copy.T(copy.PasscodeWrong)) {
		t.Fatal("a wrong passcode is refused")
	}
	h.tt.Type("2468")
	h.tt.Key(0, ui.KeyEnter)
	h.settle(t)
	if h.app.locked {
		t.Fatal("the passcode unlocks")
	}
	h.tt.Key(ui.Cmd, ui.KeyL)
	h.settle(t)
	if !h.app.locked {
		t.Fatal("⌘L locks")
	}
}

func TestAgentPanelSummarizesUnread(t *testing.T) {
	h := open(t, nil)
	ctx := context.Background()
	cfg, _ := h.env.Runtime.Agent.Configuration(ctx)
	cfg.APIKey = "sk-demo"
	if _, err := h.env.Runtime.Agent.SaveConfiguration(ctx, cfg, false); err != nil {
		t.Fatal(err)
	}
	// In the background, opening the chat leaves its messages unread.
	h.env.Desktop.Focus = false
	h.click(t, "Telo Design")
	h.tt.Key(ui.Cmd, ui.KeyJ)
	h.settle(t)
	if h.app.workspace.Panel != workspace.PanelAgent {
		t.Fatal("⌘J opens the agent")
	}
	h.click(t, copy.T(copy.AgentSummarizeUnread))
	h.settle(t)
	if !h.tt.HasText("Demo summary of") {
		t.Fatalf("summary: %q", h.tt.Texts())
	}
	testkit.Snapshot(t, h.tt, "agent-summary")
	found := false
	for _, s := range h.tt.Texts() {
		found = found || strings.Contains(s, "weighed in")
	}
	if !found {
		t.Fatal("the summary cites its messages")
	}
}

func TestProfileAndAccountMenu(t *testing.T) {
	h := open(t, nil)
	h.click(t, "Mina")
	h.tt.Key(0, ui.KeyRight)
	h.settle(t)
	if h.app.workspace.Panel != workspace.PanelInfo || !h.tt.HasText(copy.T(copy.UserInfo)) {
		t.Fatalf("→ opens info: %q", h.tt.Texts())
	}
	testkit.Snapshot(t, h.tt, "profile")
	if err := h.tt.Click(copy.T(copy.OpenAccountMenu)); err != nil {
		t.Fatal(err)
	}
	h.tt.Frame()
	// The popover menu is drawn in the window.
	for _, want := range []string{copy.T(copy.MyProfile), copy.T(copy.Contacts), copy.T(copy.NewGroup), copy.T(copy.Settings)} {
		if !h.tt.HasText(want) {
			t.Fatalf("menu lacks %q: %q", want, h.tt.Texts())
		}
	}
	testkit.Snapshot(t, h.tt, "account-menu")
	h.click(t, copy.T(copy.NewChannel))
	h.tt.Type("Launch Notes")
	h.settle(t)
	testkit.Snapshot(t, h.tt, "new-channel")
	h.click(t, copy.T(copy.Create))
	c, ok := h.app.Store.Chat(h.app.Store.Selected)
	if !ok || c.Title != "Launch Notes" {
		t.Fatalf("created %+v", c)
	}
	_ = demo.SavedChat
}

func TestMediaViewer(t *testing.T) {
	h := open(t, nil)
	h.click(t, "Telo Design")
	h.app.workspace.Conversation.Composer.Focus()
	ms := h.app.Store.Transcript(demo.DesignChat).Messages
	var shown int
	for _, m := range ms {
		if m.Media != nil && m.Media.Kind == "photo" {
			shown++
			if shown == 1 {
				h.app.viewer.Open(h.app.Store, m)
			}
		}
	}
	h.settle(t)
	if !h.app.viewer.Showing() || !h.tt.HasText(copy.F(copy.MediaOf, 1, shown)) {
		t.Fatalf("viewer of %d photos: %q", shown, h.tt.Texts())
	}
	testkit.Snapshot(t, h.tt, "media-viewer")
	h.tt.Key(0, ui.KeyRight)
	h.settle(t)
	if shown > 1 && !h.tt.HasText(copy.F(copy.MediaOf, 2, shown)) {
		t.Fatal("→ steps to the next photo")
	}
	h.tt.Key(0, ui.KeyEscape)
	h.settle(t)
	if h.app.viewer.Showing() {
		t.Fatal("Escape closes the viewer")
	}
}
