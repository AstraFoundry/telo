// Package agent is the workspace agent's vocabulary: providers and their
// configuration, conversation threads, scoped context with redaction, the
// audit trail, and automation (trigger rules and scheduled tasks).
package agent

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"slices"
	"strings"
	"time"
)

// Provider is a bring-your-own-account model vendor.
type Provider string

const (
	ProviderOpenAI     Provider = "openai"
	ProviderAnthropic  Provider = "anthropic"
	ProviderGoogle     Provider = "google"
	ProviderGroq       Provider = "groq"
	ProviderXAI        Provider = "xai"
	ProviderKimi       Provider = "kimi"
	ProviderDeepSeek   Provider = "deepseek"
	ProviderMistral    Provider = "mistral"
	ProviderCompatible Provider = "openai-compatible"
)

// Providers lists the first-class vendors, then the OpenAI-compatible
// fallback for any other HTTPS endpoint.
var Providers = []Provider{ProviderOpenAI, ProviderAnthropic, ProviderGoogle, ProviderGroq, ProviderXAI, ProviderKimi, ProviderDeepSeek, ProviderMistral, ProviderCompatible}

// OAuthProviders are the vendors whose Connect account is desktop OAuth;
// the others use the API key the vendor issues.
var OAuthProviders = []Provider{ProviderOpenAI, ProviderAnthropic, ProviderGoogle, ProviderXAI, ProviderKimi}

// SupportsOAuth tells whether a vendor connects through OAuth.
func (p Provider) SupportsOAuth() bool { return slices.Contains(OAuthProviders, p) }

// Valid tells a known provider.
func (p Provider) Valid() bool { return slices.Contains(Providers, p) }

// DefaultModel is the model filled in when the provider is picked.
func (p Provider) DefaultModel() string {
	return map[Provider]string{
		ProviderOpenAI: "gpt-4.1-mini", ProviderAnthropic: "claude-sonnet-4-5", ProviderGoogle: "gemini-2.5-flash",
		ProviderGroq: "llama-3.3-70b-versatile", ProviderXAI: "grok-3", ProviderKimi: "kimi-k2.5",
		ProviderDeepSeek: "deepseek-chat", ProviderMistral: "mistral-small-latest", ProviderCompatible: "gpt-4.1-mini",
	}[p]
}

// Tuning bounds, inclusive.
const (
	TemperatureMin  = 0
	TemperatureMax  = 2
	MaxStepsMin     = 1
	MaxStepsMax     = 8
	HistoryLimitMin = 0
	HistoryLimitMax = 50
)

// OAuthTokens are a vendor session. They stay in the backend; the UI only
// sees AccountLabel.
type OAuthTokens struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken,omitempty"`
	ExpiresAt    time.Time `json:"expiresAt,omitzero"`
	AccountLabel string    `json:"accountLabel,omitempty"`
}

// AuthKind is which secret authenticates the next run.
type AuthKind string

const (
	AuthNone   AuthKind = ""
	AuthOAuth  AuthKind = "oauth"
	AuthAPIKey AuthKind = "api-key"
)

// Configuration is the agent's provider and behavior. Build it with
// NewConfiguration, which enforces the invariants.
type Configuration struct {
	Provider            Provider     `json:"provider"`
	Model               string       `json:"model"`
	BaseURL             string       `json:"baseUrl,omitempty"`
	Instructions        string       `json:"instructions"`
	APIKey              string       `json:"apiKey,omitempty"`
	OAuth               *OAuthTokens `json:"oauth,omitempty"`
	CanInspectWorkspace bool         `json:"canInspectWorkspace"`
	Temperature         float64      `json:"temperature"`
	MaxSteps            int          `json:"maxSteps"`
	HistoryLimit        int          `json:"historyLimit"`
}

// Errors of an invalid configuration.
var (
	ErrUnknownProvider      = errors.New("agent: unknown provider")
	ErrModelRequired        = errors.New("agent: model is required")
	ErrInstructionsRequired = errors.New("agent: instructions are required")
	ErrBaseURLRequired      = errors.New("agent: an OpenAI-compatible provider needs a base URL")
	ErrBaseURLNotHTTPS      = errors.New("agent: base URL must use HTTPS")
)

// NewConfiguration validates and normalizes c: a named provider drops a
// leftover compatible URL, and a vendor without OAuth drops leftover
// tokens, so one account's secrets never authenticate another vendor.
func NewConfiguration(c Configuration) (Configuration, error) {
	if !c.Provider.Valid() {
		return Configuration{}, ErrUnknownProvider
	}
	c.Model = strings.TrimSpace(c.Model)
	c.Instructions = strings.TrimSpace(c.Instructions)
	c.APIKey = strings.TrimSpace(c.APIKey)
	if c.Provider == ProviderCompatible {
		c.BaseURL = strings.TrimSpace(c.BaseURL)
	} else {
		c.BaseURL = ""
	}
	if !c.Provider.SupportsOAuth() || c.OAuth == nil || strings.TrimSpace(c.OAuth.AccessToken) == "" {
		c.OAuth = nil
	} else {
		t := *c.OAuth
		t.AccessToken, t.RefreshToken, t.AccountLabel = strings.TrimSpace(t.AccessToken), strings.TrimSpace(t.RefreshToken), strings.TrimSpace(t.AccountLabel)
		c.OAuth = &t
	}
	switch {
	case c.Model == "":
		return Configuration{}, ErrModelRequired
	case c.Instructions == "":
		return Configuration{}, ErrInstructionsRequired
	case c.Provider == ProviderCompatible && c.BaseURL == "":
		return Configuration{}, ErrBaseURLRequired
	}
	if c.BaseURL != "" {
		u, err := url.Parse(c.BaseURL)
		if err != nil || u.Scheme != "https" || u.Host == "" {
			return Configuration{}, ErrBaseURLNotHTTPS
		}
	}
	if math.IsNaN(c.Temperature) || c.Temperature < TemperatureMin || c.Temperature > TemperatureMax {
		return Configuration{}, fmt.Errorf("agent: temperature must be between %d and %d", TemperatureMin, TemperatureMax)
	}
	if c.MaxSteps < MaxStepsMin || c.MaxSteps > MaxStepsMax {
		return Configuration{}, fmt.Errorf("agent: max steps must be between %d and %d", MaxStepsMin, MaxStepsMax)
	}
	if c.HistoryLimit < HistoryLimitMin || c.HistoryLimit > HistoryLimitMax {
		return Configuration{}, fmt.Errorf("agent: history limit must be between %d and %d", HistoryLimitMin, HistoryLimitMax)
	}
	return c, nil
}

// DefaultInstructions is the agent's out-of-the-box instruction.
const DefaultInstructions = "Answer from the visible Telegram workspace. Ask before acting outside it."

// DefaultConfiguration is the configuration before the user sets one.
func DefaultConfiguration() Configuration {
	return Configuration{Provider: ProviderOpenAI, Model: ProviderOpenAI.DefaultModel(), Instructions: DefaultInstructions,
		CanInspectWorkspace: true, Temperature: 0.7, MaxSteps: 4, HistoryLimit: 20}
}

// HasCredential tells whether a key or a session is stored.
func (c Configuration) HasCredential() bool {
	return c.APIKey != "" || (c.OAuth != nil && c.OAuth.AccessToken != "")
}

// Auth is the secret the next run uses; a session wins over a key.
func (c Configuration) Auth() AuthKind {
	switch {
	case c.OAuth != nil && c.OAuth.AccessToken != "":
		return AuthOAuth
	case c.APIKey != "":
		return AuthAPIKey
	}
	return AuthNone
}

// OmitsTemperature tells whether requests must leave temperature out:
// Kimi models fix it per thinking mode and reject any other value.
func (c Configuration) OmitsTemperature() bool {
	return c.Provider == ProviderKimi || IsKimiFamily(c.Model)
}

// IsKimiFamily recognizes Kimi model ids ("kimi-k2.5", "moonshotai/kimi-k2.6").
func IsKimiFamily(model string) bool {
	m := strings.ToLower(model)
	if strings.Contains(m, "moonshotai/kimi") {
		return true
	}
	if i := strings.LastIndex(m, "/"); i >= 0 {
		m = m[i+1:]
	}
	return strings.HasPrefix(m, "kimi-") || strings.HasPrefix(m, "kimi.")
}

// Model is a vendor model the picker lists.
type Model struct {
	ID    string
	Label string
}
