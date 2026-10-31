package onboarding

import (
	"context"
	"testing"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/testkit"
	"github.com/AstraFoundry/telo/frontend/widgets/paperplane"
	"github.com/egoist/mygo/ui"
)

// signinAccounts answers sign-in like TDLib's first steps.
type signinAccounts struct {
	tg.Accounts
	auth  tg.AuthState
	phone string
	code  string
}

func (a *signinAccounts) Auth() tg.AuthState { return a.auth }
func (a *signinAccounts) SubmitPhone(_ context.Context, phone string) error {
	a.phone = phone
	a.auth = tg.AuthState{Step: tg.AuthWaitCode, Phone: phone, CodeLength: 5, CodeVia: "app"}
	return nil
}
func (a *signinAccounts) SubmitCode(_ context.Context, code string) error {
	a.code = code
	if code != "12345" {
		a.auth.Error = tg.AuthErrCodeInvalid
		return nil
	}
	a.auth = tg.AuthState{Step: tg.AuthWaitPassword, PasswordHint: "first pet"}
	return nil
}
func (a *signinAccounts) RequestQR(context.Context) error {
	a.auth = tg.AuthState{Step: tg.AuthWaitQR, QRLink: "tg://login?token=dGVsbw"}
	return nil
}

func TestSignInFlow(t *testing.T) {
	env := testkit.New(t, nil)
	accounts := &signinAccounts{Accounts: env.Runtime.Accounts, auth: tg.AuthState{Step: tg.AuthWaitPhone}}
	env.Runtime.Accounts = accounts
	page := New("PT")
	finished := false
	view := func(c *ui.Context) {
		env.Runtime.Drain()
		page.Render(c, env.Runtime, accounts.Auth(), func() { finished = true })
	}
	tt := ui.NewTester(view, Width, Height)
	frame := func() { tt.Frame() }
	testkit.Snapshot(t, tt, "onboarding-1-welcome")
	if err := tt.Click("Get started"); err != nil {
		t.Fatal(err)
	}
	tt.Advance(800e6)
	testkit.Snapshot(t, tt, "onboarding-2-phone")
	if !tt.HasText("+351") {
		t.Fatalf("Portugal's calling code missing: %q", tt.Texts())
	}
	tt.Type("912 345 678")
	if err := tt.Click("Continue"); err != nil {
		t.Fatal(err)
	}
	env.Settle(t, frame)
	if accounts.phone != "+351912345678" {
		t.Fatalf("submitted %q", accounts.phone)
	}
	tt.Advance(800e6)
	testkit.Snapshot(t, tt, "onboarding-3-code")
	tt.Type("11111")
	env.Settle(t, frame)
	if !tt.HasText("That sign-in code is not valid.") {
		t.Fatalf("no rejection: %q", tt.Texts())
	}
	testkit.Snapshot(t, tt, "onboarding-3-code-invalid")
	tt.Key(ui.Cmd, ui.KeyA)
	tt.Type("12345")
	env.Settle(t, frame)
	tt.Advance(800e6)
	if !tt.HasText("Hint: first pet") {
		t.Fatalf("no password step: %q", tt.Texts())
	}
	testkit.Snapshot(t, tt, "onboarding-4-password")
	if finished {
		t.Fatal("finished early")
	}
}

func TestQRSignIn(t *testing.T) {
	env := testkit.New(t, nil)
	accounts := &signinAccounts{Accounts: env.Runtime.Accounts, auth: tg.AuthState{Step: tg.AuthWaitPhone}}
	env.Runtime.Accounts = accounts
	page := New("US")
	tt := ui.NewTester(func(c *ui.Context) {
		env.Runtime.Drain()
		page.Render(c, env.Runtime, accounts.Auth(), func() {})
	}, Width, Height)
	_ = tt.Click("Get started")
	if err := tt.Click("Log in by QR code"); err != nil {
		t.Fatal(err)
	}
	env.Settle(t, func() { tt.Frame() })
	tt.Advance(800e6)
	if !tt.HasText("Scan with your phone") {
		t.Fatalf("%q", tt.Texts())
	}
	testkit.Snapshot(t, tt, "onboarding-qr")
}

func TestReadyFlowEndsInWorkspace(t *testing.T) {
	env := testkit.New(t, nil)
	page := New("US")
	page.flow.Started = true
	finished := false
	tt := ui.NewTester(func(c *ui.Context) {
		env.Runtime.Drain()
		page.Render(c, env.Runtime, tg.AuthState{Step: tg.AuthReady}, func() { finished = true })
	}, Width, Height)
	tt.Advance(800e6)
	testkit.Snapshot(t, tt, "onboarding-5-agent")
	if err := tt.Click("Set up later"); err != nil {
		t.Fatal(err)
	}
	tt.Advance(800e6)
	testkit.Snapshot(t, tt, "onboarding-6-done")
	if got := page.plane.Target(); got != paperplane.Stages {
		t.Fatalf("the plane heads for stage %d at the last step", got)
	}
	if want := copy.F(copy.OnbDoneBody, "⌘J"); !tt.HasText(want) {
		t.Fatalf("done step does not name the agent's shortcut: %q", tt.Texts())
	}
	if err := tt.Click("Start messaging"); err != nil {
		t.Fatal(err)
	}
	if !finished {
		t.Fatal("not finished")
	}
}

func TestNotConfiguredBuild(t *testing.T) {
	env := testkit.New(t, nil)
	env.Runtime.Info.TelegramConfigured = false
	page := New("US")
	page.flow.Started = true
	tt := ui.NewTester(func(c *ui.Context) {
		page.Render(c, env.Runtime, tg.AuthState{Step: tg.AuthNotConfigured}, func() {})
	}, Width, Height)
	tt.Advance(800e6)
	if !tt.HasText("This build has no Telegram application credentials. Set TELO_TELEGRAM_API_ID and TELO_TELEGRAM_API_HASH and build again.") {
		t.Fatalf("%q", tt.Texts())
	}
	if _, ok := tt.Find("Continue"); ok {
		t.Fatal("offers to continue without credentials")
	}
}
