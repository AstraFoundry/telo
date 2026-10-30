// Package lock is the passcode screen that hides everything while Telo
// is locked, as telegram-macos's passcode lock does.
package lock

import (
	"github.com/AstraFoundry/telo/backend/domain/preferences"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/icons"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Page keeps the typed passcode.
type Page struct {
	passcode string
	wrong    bool
}

// Render draws the lock; unlock runs once the passcode matches hash.
func (p *Page) Render(c *ui.Context, t theme.Tokens, hash string, unlock func()) {
	try := func() {
		if preferences.CheckPasscode(hash, p.passcode) {
			p.passcode, p.wrong = "", false
			unlock()
			return
		}
		p.passcode, p.wrong = "", true
	}
	ui.Column(c).Fill().Background(t.Canvas).Justify(ui.Center).AlignItems(ui.Center).DragWindow().Children(func() {
		kit.Card(c, t).Width(340).Padding(28).Gap(14).AlignItems(ui.Center).Children(func() {
			kit.Mark(c, 56)
			ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
				ui.Icon(c, icons.LockSimple).FontSize(16).TextColor(t.Muted)
				ui.Text(c, copy.T(copy.PasscodeLocked)).FontSize(theme.Heading).FontWeight(700).Role(ui.RoleHeading)
			})
			in := ui.TextInput(c.Key("passcode"), &p.passcode).Password().AutoFocus().Label(copy.T(copy.PasscodeEnter)).Placeholder(copy.T(copy.PasscodeEnter))
			kit.Field(in, t).Width(280)
			if in.Submitted() {
				try()
			}
			if p.wrong {
				ui.Text(c, copy.T(copy.PasscodeWrong)).FontSize(theme.Caption).TextColor(t.Danger).Role(ui.RoleStatus)
			}
			kit.Button(c.Key("unlock"), t, kit.Primary, copy.T(copy.PasscodeUnlock), p.passcode != "").Width(280).OnClick(try)
		})
	})
}
