package live

import (
	"context"
	"errors"
	"strings"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/backend/infrastructure/tdlib/tdapi"
)

// authorization follows TDLib's sign-in states: it answers the request
// for parameters itself and publishes the others.
func (s *Session) authorization(state tdapi.AuthorizationState) {
	if _, ok := state.(*tdapi.AuthorizationStateWaitTdlibParameters); ok {
		go s.setParameters()
	}
	s.mu.Lock()
	s.auth = state
	s.mu.Unlock()
	s.emit(tg.AuthChanged{State: s.Auth()})
}

func (s *Session) setParameters() {
	ctx, cancel := context.WithTimeout(context.Background(), 30e9)
	defer cancel()
	c := s.cfg
	_, err := s.td.SetTdlibParameters(ctx, &tdapi.SetTdlibParametersRequest{
		DatabaseDirectory: c.Directory, DatabaseEncryptionKey: c.DatabaseKey,
		UseFileDatabase: true, UseChatInfoDatabase: true, UseMessageDatabase: true, UseSecretChats: true,
		APIID: c.APIID, APIHash: c.APIHash, SystemLanguageCode: c.Language, DeviceModel: c.Device,
		SystemVersion: c.System, ApplicationVersion: c.Version,
	})
	if err != nil {
		s.fail(err)
	}
}

// Auth maps TDLib's state to the sign-in step the UI shows.
func (s *Session) Auth() tg.AuthState {
	s.mu.Lock()
	state, failure := s.auth, s.authErr
	s.mu.Unlock()
	out := tg.AuthState{Step: tg.AuthStarting, Error: failure}
	switch st := state.(type) {
	case *tdapi.AuthorizationStateWaitPhoneNumber:
		out.Step = tg.AuthWaitPhone
	case *tdapi.AuthorizationStateWaitCode:
		out.Step = tg.AuthWaitCode
		if info := st.CodeInfo; info != nil {
			out.Phone = info.PhoneNumber
			out.CodeLength, out.CodeVia = codeType(info.Type)
		}
	case *tdapi.AuthorizationStateWaitPassword:
		out.Step, out.PasswordHint = tg.AuthWaitPassword, st.PasswordHint
	case *tdapi.AuthorizationStateWaitRegistration:
		out.Step = tg.AuthWaitRegister
	case *tdapi.AuthorizationStateWaitOtherDeviceConfirmation:
		out.Step, out.QRLink = tg.AuthWaitQR, st.Link
	case *tdapi.AuthorizationStateWaitEmailAddress, *tdapi.AuthorizationStateWaitEmailCode:
		out.Step = tg.AuthWaitEmail
	case *tdapi.AuthorizationStateReady:
		out.Step = tg.AuthReady
	case *tdapi.AuthorizationStateLoggingOut, *tdapi.AuthorizationStateClosing, *tdapi.AuthorizationStateClosed:
		out.Step = tg.AuthLoggingOut
	}
	return out
}

func codeType(t tdapi.AuthenticationCodeType) (int, string) {
	switch t := t.(type) {
	case *tdapi.AuthenticationCodeTypeTelegramMessage:
		return int(t.Length), "app"
	case *tdapi.AuthenticationCodeTypeSMS:
		return int(t.Length), "sms"
	case *tdapi.AuthenticationCodeTypeCall:
		return int(t.Length), "call"
	case *tdapi.AuthenticationCodeTypeFragment:
		return int(t.Length), "fragment"
	}
	return 0, ""
}

// fail records why the last sign-in step was refused and republishes.
func (s *Session) fail(err error) {
	s.mu.Lock()
	s.authErr = authError(err)
	s.mu.Unlock()
	s.emit(tg.AuthChanged{State: s.Auth()})
}

// authError names a refusal the sign-in screens explain.
func authError(err error) string {
	var e *tdapi.Error
	if !errors.As(err, &e) {
		return tg.AuthErrFailed
	}
	switch {
	case strings.Contains(e.Message, "PHONE_NUMBER_INVALID"), strings.Contains(e.Message, "PHONE_NUMBER_BANNED"):
		return tg.AuthErrPhoneInvalid
	case strings.Contains(e.Message, "PHONE_CODE_INVALID"), strings.Contains(e.Message, "PHONE_CODE_EMPTY"):
		return tg.AuthErrCodeInvalid
	case strings.Contains(e.Message, "PHONE_CODE_EXPIRED"):
		return tg.AuthErrCodeExpired
	case strings.Contains(e.Message, "PASSWORD_HASH_INVALID"):
		return tg.AuthErrPasswordInvalid
	case e.Code == 429 || strings.HasPrefix(e.Message, "FLOOD_WAIT"), strings.Contains(e.Message, "Too Many Requests"):
		return tg.AuthErrFlood
	}
	return tg.AuthErrFailed
}

// step runs one sign-in call, clearing the last refusal first.
func (s *Session) step(call func() error) error {
	s.mu.Lock()
	s.authErr = ""
	s.mu.Unlock()
	if err := call(); err != nil {
		s.fail(err)
		return nil
	}
	return nil
}

func (s *Session) SubmitPhone(ctx context.Context, phone string) error {
	return s.step(func() error {
		_, err := s.td.SetAuthenticationPhoneNumber(ctx, &tdapi.SetAuthenticationPhoneNumberRequest{PhoneNumber: phone,
			Settings: &tdapi.PhoneNumberAuthenticationSettings{}})
		return err
	})
}

func (s *Session) SubmitCode(ctx context.Context, code string) error {
	return s.step(func() error {
		_, err := s.td.CheckAuthenticationCode(ctx, &tdapi.CheckAuthenticationCodeRequest{Code: code})
		return err
	})
}

func (s *Session) SubmitPassword(ctx context.Context, password string) error {
	return s.step(func() error {
		_, err := s.td.CheckAuthenticationPassword(ctx, &tdapi.CheckAuthenticationPasswordRequest{Password: password})
		return err
	})
}

func (s *Session) SubmitRegistration(ctx context.Context, first, last string) error {
	return s.step(func() error {
		_, err := s.td.RegisterUser(ctx, &tdapi.RegisterUserRequest{FirstName: first, LastName: last})
		return err
	})
}

func (s *Session) RequestQR(ctx context.Context) error {
	return s.step(func() error {
		_, err := s.td.RequestQrCodeAuthentication(ctx, &tdapi.RequestQrCodeAuthenticationRequest{})
		return err
	})
}

func (s *Session) ResendCode(ctx context.Context) error {
	return s.step(func() error {
		_, err := s.td.ResendAuthenticationCode(ctx, &tdapi.ResendAuthenticationCodeRequest{})
		return err
	})
}
