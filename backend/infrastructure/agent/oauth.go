// Package agent implements the agent's ports: provider gateways over
// HTTP, vendor OAuth, model catalogs, the stores and the demo gateway.
package agent

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
)

// publicClientIDs are the native client ids these vendors ship in their
// own desktop apps. Google has none: Telo registers its own Desktop
// client, supplied at build time. TELO_<VENDOR>_OAUTH_CLIENT_ID overrides.
var publicClientIDs = map[domain.Provider]string{
	domain.ProviderOpenAI:    "app_EMoamEEZ73f0CkXaXp7hrann",
	domain.ProviderAnthropic: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
	domain.ProviderXAI:       "b1a00492-073a-47ea-816f-4c329264a828",
	domain.ProviderKimi:      "17e5f671-d194-4dfb-9706-5516cb48c098",
}

// AnthropicOAuthBeta is the beta header Anthropic requires with OAuth.
const AnthropicOAuthBeta = "oauth-2025-04-20"

// KimiCodingBaseURL is the OpenAI-compatible endpoint Kimi sessions use.
const KimiCodingBaseURL = "https://api.kimi.com/coding/v1"

const deviceCodeGrant = "urn:ietf:params:oauth:grant-type:device_code"

type profile struct {
	device bool
	// Authorization code with PKCE on a loopback redirect.
	authorizeURL, tokenURL string
	json                   bool
	scopes                 string
	host, path             string
	port                   int
	redirect               string
	authorizeParams        map[string]string
	tokenHeaders           map[string]string
	// Device code.
	deviceURL   string
	kimiHeaders bool
	userInfoURL string
}

var profiles = map[domain.Provider]profile{
	domain.ProviderOpenAI: {authorizeURL: "https://auth.openai.com/oauth/authorize", tokenURL: "https://auth.openai.com/oauth/token",
		scopes: "openid profile email offline_access", host: "localhost", path: "/auth/callback", port: 1455,
		redirect:        "http://localhost:1455/auth/callback",
		authorizeParams: map[string]string{"id_token_add_organizations": "true", "codex_cli_simplified_flow": "true", "originator": "telo"}},
	domain.ProviderAnthropic: {authorizeURL: "https://claude.ai/oauth/authorize", tokenURL: "https://console.anthropic.com/v1/oauth/token", json: true,
		scopes: "org:create_api_key user:profile user:inference", host: "localhost", path: "/callback", port: 54545,
		redirect: "http://localhost:54545/callback", authorizeParams: map[string]string{"code": "true"},
		tokenHeaders: map[string]string{"anthropic-beta": AnthropicOAuthBeta}},
	domain.ProviderGoogle: {authorizeURL: "https://accounts.google.com/o/oauth2/v2/auth", tokenURL: "https://oauth2.googleapis.com/token",
		scopes: "https://www.googleapis.com/auth/generative-language openid email", host: "127.0.0.1", path: "/callback",
		authorizeParams: map[string]string{"access_type": "offline", "prompt": "consent"}, userInfoURL: "https://www.googleapis.com/oauth2/v2/userinfo"},
	domain.ProviderXAI: {device: true, deviceURL: "https://auth.x.ai/oauth/device/code", tokenURL: "https://auth.x.ai/oauth/token",
		scopes: "openid profile email offline_access grok-cli:access api:access", userInfoURL: "https://auth.x.ai/oidc/userinfo"},
	domain.ProviderKimi: {device: true, deviceURL: "https://auth.kimi.com/api/oauth/device_authorization", tokenURL: "https://auth.kimi.com/api/oauth/token", kimiHeaders: true},
}

// OAuth runs the vendors' desktop sign-ins.
type OAuth struct {
	// ClientIDs are the build's client ids, over the public defaults.
	ClientIDs map[domain.Provider]string
	// Open shows a URL in the browser.
	Open func(url string) error
	// KimiHeaders identify the device to Kimi.
	KimiHeaders map[string]string
	HTTP        *http.Client
	Timeout     time.Duration
}

// ClientIDsFromEnv reads TELO_<VENDOR>_OAUTH_CLIENT_ID.
func ClientIDsFromEnv() map[domain.Provider]string {
	out := map[domain.Provider]string{}
	for _, p := range domain.OAuthProviders {
		if v := strings.TrimSpace(os.Getenv("TELO_" + strings.ToUpper(string(p)) + "_OAUTH_CLIENT_ID")); v != "" {
			out[p] = v
		}
	}
	return out
}

func (o *OAuth) client() *http.Client {
	if o.HTTP != nil {
		return o.HTTP
	}
	return http.DefaultClient
}

func (o *OAuth) clientID(p domain.Provider) string {
	if id := o.ClientIDs[p]; id != "" {
		return id
	}
	return publicClientIDs[p]
}

// Configured lists the vendors this build can connect.
func (o *OAuth) Configured() []domain.Provider {
	var out []domain.Provider
	for _, p := range domain.OAuthProviders {
		if o.clientID(p) != "" {
			out = append(out, p)
		}
	}
	return out
}

func (o *OAuth) Authorize(ctx context.Context, p domain.Provider) (domain.OAuthTokens, error) {
	pr, ok := profiles[p]
	if !ok || !slices.Contains(o.Configured(), p) {
		return domain.OAuthTokens{}, domain.ErrOAuthUnavailable
	}
	timeout := o.Timeout
	if timeout == 0 {
		timeout = 5 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var t domain.OAuthTokens
	var err error
	if pr.device {
		t, err = o.device(ctx, p, pr)
	} else {
		t, err = o.code(ctx, p, pr)
	}
	if err != nil {
		return domain.OAuthTokens{}, fmt.Errorf("%w: %v", domain.ErrOAuthFailed, err)
	}
	t.AccountLabel = o.label(ctx, t.AccessToken, pr.userInfoURL)
	return t, nil
}

func (o *OAuth) Refresh(ctx context.Context, p domain.Provider, t domain.OAuthTokens) (domain.OAuthTokens, error) {
	pr, ok := profiles[p]
	if !ok || t.RefreshToken == "" {
		return domain.OAuthTokens{}, domain.ErrOAuthFailed
	}
	next, err := o.token(ctx, p, pr, map[string]string{"grant_type": "refresh_token", "refresh_token": t.RefreshToken})
	if err != nil {
		return domain.OAuthTokens{}, fmt.Errorf("%w: %v", domain.ErrOAuthFailed, err)
	}
	if next.RefreshToken == "" {
		next.RefreshToken = t.RefreshToken
	}
	next.AccountLabel = t.AccountLabel
	return next, nil
}

func random(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// AuthorizeURL builds a vendor's authorization URL with a PKCE challenge.
func AuthorizeURL(p domain.Provider, clientID, redirect, challenge, state string) string {
	pr := profiles[p]
	q := url.Values{"client_id": {clientID}, "redirect_uri": {redirect}, "response_type": {"code"}, "scope": {pr.scopes},
		"code_challenge": {challenge}, "code_challenge_method": {"S256"}, "state": {state}}
	for k, v := range pr.authorizeParams {
		q.Set(k, v)
	}
	return pr.authorizeURL + "?" + q.Encode()
}

const callbackPage = "<!doctype html><title>Telo</title><p>You can close this window.</p>"

// code runs authorization code with PKCE: a loopback server receives the
// redirect.
func (o *OAuth) code(ctx context.Context, p domain.Provider, pr profile) (domain.OAuthTokens, error) {
	verifier := random(32)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	state := random(16)
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", pr.port))
	if err != nil {
		return domain.OAuthTokens{}, err
	}
	defer ln.Close()
	redirect := pr.redirect
	if redirect == "" {
		redirect = fmt.Sprintf("http://%s:%d%s", pr.host, ln.Addr().(*net.TCPAddr).Port, pr.path)
	}
	codes := make(chan string, 1)
	failures := make(chan error, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != pr.path {
			http.NotFound(w, r)
			return
		}
		q := r.URL.Query()
		switch {
		case q.Get("state") != state:
			w.WriteHeader(http.StatusBadRequest)
			failures <- errors.New("state mismatch")
		case q.Get("error") != "" || q.Get("code") == "":
			w.WriteHeader(http.StatusBadRequest)
			failures <- errors.New("authorization refused")
		default:
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(callbackPage))
			codes <- q.Get("code")
		}
	}), ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	defer srv.Close()
	if err := o.Open(AuthorizeURL(p, o.clientID(p), redirect, challenge, state)); err != nil {
		return domain.OAuthTokens{}, err
	}
	select {
	case code := <-codes:
		return o.token(ctx, p, pr, map[string]string{"grant_type": "authorization_code", "code": code, "code_verifier": verifier,
			"redirect_uri": redirect, "state": state})
	case err := <-failures:
		return domain.OAuthTokens{}, err
	case <-ctx.Done():
		return domain.OAuthTokens{}, ctx.Err()
	}
}

func (o *OAuth) headers(pr profile) map[string]string {
	out := map[string]string{}
	if pr.kimiHeaders {
		for k, v := range o.KimiHeaders {
			out[k] = v
		}
	}
	for k, v := range pr.tokenHeaders {
		out[k] = v
	}
	return out
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
}

func (r tokenResponse) tokens() domain.OAuthTokens {
	t := domain.OAuthTokens{AccessToken: strings.TrimSpace(r.AccessToken), RefreshToken: strings.TrimSpace(r.RefreshToken)}
	if r.ExpiresIn > 0 {
		t.ExpiresAt = time.Now().Add(time.Duration(r.ExpiresIn) * time.Second)
	}
	return t
}

func (o *OAuth) post(ctx context.Context, endpoint string, fields map[string]string, asJSON bool, headers map[string]string, out any) (int, error) {
	var body string
	ctype := "application/x-www-form-urlencoded"
	if asJSON {
		raw, err := json.Marshal(fields)
		if err != nil {
			return 0, err
		}
		body, ctype = string(raw), "application/json"
	} else {
		v := url.Values{}
		for k, x := range fields {
			v.Set(k, x)
		}
		body = v.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", ctype)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := o.client().Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	return res.StatusCode, json.NewDecoder(res.Body).Decode(out)
}

func (o *OAuth) token(ctx context.Context, p domain.Provider, pr profile, fields map[string]string) (domain.OAuthTokens, error) {
	fields["client_id"] = o.clientID(p)
	var r tokenResponse
	status, err := o.post(ctx, pr.tokenURL, fields, pr.json, o.headers(pr), &r)
	if err != nil {
		return domain.OAuthTokens{}, err
	}
	t := r.tokens()
	if status/100 != 2 || t.AccessToken == "" {
		return domain.OAuthTokens{}, fmt.Errorf("token endpoint answered %d", status)
	}
	return t, nil
}

// device runs the device-code grant: the user confirms a code in the
// browser while Telo polls.
func (o *OAuth) device(ctx context.Context, p domain.Provider, pr profile) (domain.OAuthTokens, error) {
	fields := map[string]string{"client_id": o.clientID(p)}
	if pr.scopes != "" {
		fields["scope"] = pr.scopes
	}
	var auth struct {
		DeviceCode              string `json:"device_code"`
		UserCode                string `json:"user_code"`
		VerificationURIComplete string `json:"verification_uri_complete"`
		Interval                int    `json:"interval"`
		ExpiresIn               int    `json:"expires_in"`
	}
	status, err := o.post(ctx, pr.deviceURL, fields, false, o.headers(pr), &auth)
	if err != nil {
		return domain.OAuthTokens{}, err
	}
	if status/100 != 2 || auth.DeviceCode == "" || auth.UserCode == "" || auth.VerificationURIComplete == "" {
		return domain.OAuthTokens{}, fmt.Errorf("device authorization answered %d", status)
	}
	if err := o.Open(auth.VerificationURIComplete); err != nil {
		return domain.OAuthTokens{}, err
	}
	interval := time.Duration(max(auth.Interval, 5)) * time.Second
	if auth.ExpiresIn > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(auth.ExpiresIn)*time.Second)
		defer cancel()
	}
	for {
		select {
		case <-ctx.Done():
			return domain.OAuthTokens{}, ctx.Err()
		case <-time.After(interval):
		}
		var r tokenResponse
		if _, err := o.post(ctx, pr.tokenURL, map[string]string{"client_id": o.clientID(p), "device_code": auth.DeviceCode, "grant_type": deviceCodeGrant},
			false, o.headers(pr), &r); err != nil {
			return domain.OAuthTokens{}, err
		}
		switch {
		case strings.TrimSpace(r.AccessToken) != "":
			return r.tokens(), nil
		case r.Error == "authorization_pending":
		case r.Error == "slow_down":
			interval += 5 * time.Second
		default:
			return domain.OAuthTokens{}, fmt.Errorf("device token: %s", r.Error)
		}
	}
}

// label is the account's email: from the vendor's user info, else the
// token's own claims.
func (o *OAuth) label(ctx context.Context, token, userInfo string) string {
	if userInfo != "" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, userInfo, nil)
		if err == nil {
			req.Header.Set("Authorization", "Bearer "+token)
			if res, err := o.client().Do(req); err == nil {
				var info struct {
					Email string `json:"email"`
				}
				ok := res.StatusCode/100 == 2 && json.NewDecoder(res.Body).Decode(&info) == nil
				res.Body.Close()
				if ok && strings.TrimSpace(info.Email) != "" {
					return strings.TrimSpace(info.Email)
				}
			}
		}
	}
	claims := jwtClaims(token)
	email, _ := claims["email"].(string)
	return strings.TrimSpace(email)
}

func jwtClaims(token string) map[string]any {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return nil
	}
	var out map[string]any
	if json.Unmarshal(raw, &out) != nil {
		return nil
	}
	return out
}

// chatGPTAccount is the ChatGPT account an OpenAI session acts for.
func chatGPTAccount(token string) string {
	auth, _ := jwtClaims(token)["https://api.openai.com/auth"].(map[string]any)
	id, _ := auth["chatgpt_account_id"].(string)
	return strings.TrimSpace(id)
}

var _ domain.OAuthClient = (*OAuth)(nil)
