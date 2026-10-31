package demo

import (
	"context"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// Accounts is the demo's account service: one signed-in account that is
// always ready. Logging out of the demo is a no-op; leaving the demo is
// the app relaunching without TELO_DEMO_WORKSPACE.
type Accounts struct{ repo *Repository }

var _ tg.Accounts = (*Accounts)(nil)

// NewAccounts wraps the workspace as the active account.
func NewAccounts(r *Repository) *Accounts { return &Accounts{repo: r} }

func (a *Accounts) Subscribe(f func(tg.Event)) func() { return a.repo.Subscribe(f) }
func (a *Accounts) Restore(context.Context) error     { return nil }
func (a *Accounts) Auth() tg.AuthState                { return tg.AuthState{Step: tg.AuthReady} }
func (a *Accounts) Active() tg.Repository             { return a.repo }

func (a *Accounts) Registry() tg.AccountRegistry {
	u := a.repo.user
	return tg.AccountRegistry{Active: "demo", Accounts: []tg.AccountRecord{{ID: "demo", UserID: u.ID, DisplayName: u.DisplayName, Username: u.Username, Avatar: u.Avatar, CreatedAt: Base, LastActiveAt: Base}}}
}

func (a *Accounts) StartSignIn(context.Context) error  { return tg.ErrAccountLimit }
func (a *Accounts) CancelSignIn(context.Context) error { return nil }
func (a *Accounts) SubmitPhone(context.Context, string) error {
	return tg.ErrNotConfigured
}
func (a *Accounts) SubmitCode(context.Context, string) error     { return tg.ErrNotConfigured }
func (a *Accounts) SubmitPassword(context.Context, string) error { return tg.ErrNotConfigured }
func (a *Accounts) SubmitRegistration(context.Context, string, string) error {
	return tg.ErrNotConfigured
}
func (a *Accounts) RequestQR(context.Context) error            { return tg.ErrNotConfigured }
func (a *Accounts) ResendCode(context.Context) error           { return tg.ErrNotConfigured }
func (a *Accounts) Switch(context.Context, tg.AccountID) error { return nil }
func (a *Accounts) Logout(context.Context) error               { return nil }
func (a *Accounts) Close() error                               { a.repo.Close(); return nil }
