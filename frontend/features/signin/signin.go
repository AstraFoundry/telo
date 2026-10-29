// Package signin is the Telegram sign-in scenario: the phone number with
// its country, the QR code a phone scans, the login code, the two-step
// password and, for a new number, the registration name. Each form
// submits to the account service in the background and shows Telegram's
// rejection inline.
package signin

import (
	"context"
	"strings"
	"unicode"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/config"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/runtime"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
	"rsc.io/qr"
)

// State keeps the forms' input between frames.
type State struct {
	Country  config.Country
	query    string
	Number   string
	Code     string
	Password string
	First    string
	Last     string
	Busy     bool
	// err is a local rejection, before Telegram answers.
	err string
	qr  *ui.Bitmap
	// qrLink is the link the bitmap encodes.
	qrLink string
}

// NewState starts with the country of the system's region, or the US.
func NewState(region string) *State {
	c, ok := config.CountryByCode(strings.ToUpper(region))
	if !ok {
		c, _ = config.CountryByCode("US")
	}
	return &State{Country: c, query: c.Flag() + " " + c.Name}
}

// ErrorText words a sign-in error code.
func ErrorText(code string) string {
	switch code {
	case "":
		return ""
	case tg.AuthErrPhoneInvalid:
		return copy.T(copy.LoginPhoneInvalid)
	case tg.AuthErrCodeInvalid:
		return copy.T(copy.LoginCodeInvalid)
	case tg.AuthErrCodeExpired:
		return copy.T(copy.LoginCodeExpired)
	case tg.AuthErrPasswordInvalid:
		return copy.T(copy.LoginPasswordInvalid)
	case tg.AuthErrFlood:
		return copy.T(copy.LoginFlood)
	}
	return copy.T(copy.LoginFailed)
}

// submit runs one sign-in call in the background.
func (s *State) submit(rt *runtime.Runtime, call func(ctx context.Context, a tg.Accounts) error) {
	if s.Busy {
		return
	}
	s.Busy, s.err = true, ""
	rt.Go(func(ctx context.Context) func() {
		err := call(ctx, rt.Accounts)
		return func() {
			s.Busy = false
			if err != nil && err != tg.ErrNotConfigured {
				s.err = tg.AuthErrFailed
			}
		}
	})
}

func errorLine(c *ui.Context, t theme.Tokens, auth tg.AuthState, s *State) {
	code := s.err
	if auth.Error != "" {
		code = auth.Error
	}
	if text := ErrorText(code); text != "" {
		ui.Text(c, text).FontSize(theme.Callout).TextColor(t.Danger).Role(ui.RoleStatus)
	}
}

// digits keeps the digits of a phone number.
func digits(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) {
			return r
		}
		return -1
	}, s)
}

// Phone returns the full international number the form holds.
func (s *State) Phone() string { return "+" + s.Country.Dial + digits(s.Number) }

// PhoneForm is the country and the number; Enter submits.
func PhoneForm(c *ui.Context, t theme.Tokens, rt *runtime.Runtime, auth tg.AuthState, s *State, width float32) {
	ui.Column(c).Width(width).Gap(10).Children(func() {
		ui.Text(c, copy.T(copy.OnbCountryLabel)).FontSize(theme.Caption).FontWeight(600).TextColor(t.Muted)
		cb := ui.ComboboxBase(c.Key("country"), &s.query)
		kit.Field(cb.Input, t).Label(copy.T(copy.OnbCountryLabel)).Placeholder(copy.T(copy.OnbSearchCountry))
		cb.Popup(func(panel ui.Element) {
			panel.Padding(4).Margin(4, 0, 0, 0).MaxHeight(240).Radius(theme.RadiusControl).Background(t.Card).Border(1, t.CardBorder)
			kit.Raise(panel, t, kit.Lifted)
			q := strings.ToLower(strings.TrimSpace(s.query))
			filter := cb.Filtering() && q != ""
			shown := 0
			for _, country := range config.Countries {
				label := country.Flag() + " " + country.Name
				if filter && !strings.Contains(strings.ToLower(country.Name), q) && !strings.HasPrefix(country.Dial, strings.TrimPrefix(q, "+")) {
					continue
				}
				shown++
				item := cb.Item(label).MinHeight(28).Padding(4, 10).Gap(8).Radius(theme.RadiusMD).AlignItems(ui.Center)
				if item.Highlighted() {
					item.Background(t.AccentSoft)
				}
				item.Children(func() {
					ui.Text(c, label).FontSize(theme.Callout).SingleLine().Grow(1)
					ui.Text(c, "+"+country.Dial).FontSize(theme.Callout).TextColor(t.Muted)
				})
			}
			if shown == 0 {
				ui.Text(c, copy.T(copy.OnbNoCountry)).FontSize(theme.Callout).TextColor(t.Muted).Padding(6, 10)
			}
		})
		if label, ok := cb.Chosen(); ok {
			for _, country := range config.Countries {
				if country.Flag()+" "+country.Name == label {
					s.Country = country
				}
			}
		}
		ui.Text(c, copy.T(copy.OnbPhoneLabel)).FontSize(theme.Caption).FontWeight(600).TextColor(t.Muted).Margin(4, 0, 0, 0)
		ui.Row(c).Gap(8).Children(func() {
			prefix := ui.Row(c).Height(34).Padding(0, 10).Radius(theme.RadiusControl).Background(t.Subtle).AlignItems(ui.Center)
			prefix.Children(func() { ui.Text(c, "+"+s.Country.Dial).FontSize(theme.Body).FontFeatures("tnum") })
			input := ui.TextInput(c.Key("phone"), &s.Number).AutoFocus().Label(copy.T(copy.OnbPhoneLabel)).Grow(1).FontFeatures("tnum")
			kit.Field(input, t)
			if input.Submitted() && len(digits(s.Number)) >= 5 {
				phone := s.Phone()
				s.submit(rt, func(ctx context.Context, a tg.Accounts) error { return a.SubmitPhone(ctx, phone) })
			}
		})
		errorLine(c, t, auth, s)
	})
}

// CanSubmitPhone tells whether the phone form holds a plausible number.
func (s *State) CanSubmitPhone() bool { return !s.Busy && len(digits(s.Number)) >= 5 }

// SubmitPhone sends the number.
func (s *State) SubmitPhone(rt *runtime.Runtime) {
	phone := s.Phone()
	s.submit(rt, func(ctx context.Context, a tg.Accounts) error { return a.SubmitPhone(ctx, phone) })
}

// CodeForm takes the login code; it submits on its own once complete.
func CodeForm(c *ui.Context, t theme.Tokens, rt *runtime.Runtime, auth tg.AuthState, s *State, width float32) {
	ui.Column(c).Width(width).Gap(10).Children(func() {
		input := ui.TextInput(c.Key("code"), &s.Code).AutoFocus().Label(copy.T(copy.OnbCodeLabel)).Placeholder(copy.T(copy.OnbCodeLabel)).
			FontSize(theme.Heading + 3).LetterSpacing(4).FontFeatures("tnum")
		kit.Field(input, t).Height(42)
		code := digits(s.Code)
		if input.Changed() && auth.CodeLength > 0 && len(code) == auth.CodeLength || input.Submitted() && code != "" {
			s.submit(rt, func(ctx context.Context, a tg.Accounts) error { return a.SubmitCode(ctx, code) })
		}
		errorLine(c, t, auth, s)
		ui.Row(c).Gap(4).Children(func() {
			if kit.Button(c.Key("resend"), t, kit.Ghost, copy.T(copy.OnbResendCode), !s.Busy).Clicked() {
				s.submit(rt, func(ctx context.Context, a tg.Accounts) error { return a.ResendCode(ctx) })
			}
			if kit.Button(c.Key("edit"), t, kit.Ghost, copy.T(copy.OnbEditPhone), !s.Busy).Clicked() {
				s.Code = ""
				s.submit(rt, func(ctx context.Context, a tg.Accounts) error { return a.CancelSignIn(ctx) })
			}
		})
	})
}

// CodeBody explains where the code went.
func CodeBody(auth tg.AuthState) string {
	switch auth.CodeVia {
	case "sms":
		return copy.F(copy.OnbCodeBodySms, auth.CodeLength, auth.Phone)
	case "call":
		return copy.F(copy.OnbCodeBodyCall, auth.Phone, auth.CodeLength)
	}
	return copy.F(copy.OnbCodeBodyApp, max(auth.CodeLength, 5))
}

// PasswordForm takes the two-step password.
func PasswordForm(c *ui.Context, t theme.Tokens, rt *runtime.Runtime, auth tg.AuthState, s *State, width float32) {
	ui.Column(c).Width(width).Gap(10).Children(func() {
		input := ui.TextInput(c.Key("password"), &s.Password).Password().AutoFocus().Label(copy.T(copy.OnbPasswordLabel)).Placeholder(copy.T(copy.OnbPasswordLabel))
		kit.Field(input, t)
		if auth.PasswordHint != "" {
			ui.Text(c, copy.F(copy.OnbPasswordHint, auth.PasswordHint)).FontSize(theme.Caption).TextColor(t.Muted)
		}
		if input.Submitted() && s.Password != "" {
			s.SubmitPassword(rt)
		}
		errorLine(c, t, auth, s)
	})
}

// SubmitPassword sends the password.
func (s *State) SubmitPassword(rt *runtime.Runtime) {
	password := s.Password
	s.submit(rt, func(ctx context.Context, a tg.Accounts) error { return a.SubmitPassword(ctx, password) })
}

// SubmitCode sends the code.
func (s *State) SubmitCode(rt *runtime.Runtime) {
	code := digits(s.Code)
	s.submit(rt, func(ctx context.Context, a tg.Accounts) error { return a.SubmitCode(ctx, code) })
}

// RegisterForm names a new account.
func RegisterForm(c *ui.Context, t theme.Tokens, rt *runtime.Runtime, auth tg.AuthState, s *State, width float32) {
	ui.Column(c).Width(width).Gap(10).Children(func() {
		kit.Field(ui.TextInput(c.Key("first"), &s.First).AutoFocus().Label(copy.T(copy.OnbFirstName)).Placeholder(copy.T(copy.OnbFirstName)), t)
		last := kit.Field(ui.TextInput(c.Key("last"), &s.Last).Label(copy.T(copy.OnbLastName)).Placeholder(copy.T(copy.OnbLastName)), t)
		if last.Submitted() {
			s.SubmitRegistration(rt)
		}
		errorLine(c, t, auth, s)
	})
}

// SubmitRegistration sends the new account's name.
func (s *State) SubmitRegistration(rt *runtime.Runtime) {
	first, last := strings.TrimSpace(s.First), strings.TrimSpace(s.Last)
	if first == "" {
		return
	}
	s.submit(rt, func(ctx context.Context, a tg.Accounts) error { return a.SubmitRegistration(ctx, first, last) })
}

// RequestQR switches sign-in to the QR code.
func (s *State) RequestQR(rt *runtime.Runtime) {
	s.submit(rt, func(ctx context.Context, a tg.Accounts) error { return a.RequestQR(ctx) })
}

// QRCode draws the tg://login link Telegram issued as a QR code on a card.
func QRCode(c *ui.Context, t theme.Tokens, auth tg.AuthState, s *State) {
	if auth.QRLink != s.qrLink {
		s.qrLink, s.qr = auth.QRLink, nil
		if code, err := qr.Encode(auth.QRLink, qr.M); err == nil && auth.QRLink != "" {
			s.qr, _ = ui.DecodeBitmap(code.PNG())
		}
	}
	card := kit.Card(c, t).Size(196, 196).Justify(ui.Center).AlignItems(ui.Center).Background(ui.RGB(255, 255, 255))
	card.Children(func() {
		if s.qr == nil {
			ui.Spinner(c)
			return
		}
		s.qr.Pixelated()
		ui.Image(c, s.qr).Size(172, 172).Label(copy.T(copy.OnbQrTitle))
	})
}
