package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"slices"
	"strings"
	"sync"
	"time"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// Deps are the ports the use cases run on.
type Deps struct {
	Configurations domain.ConfigurationStore
	OAuth          domain.OAuthClient
	Catalog        domain.ModelCatalog
	Gateway        domain.Gateway
	Threads        domain.ThreadStore
	Audits         domain.AuditLog
	Rules          domain.RuleStore
	Tasks          domain.TaskStore
	// Telegram is the active account, nil before sign-in.
	Telegram func() tg.Repository
	Now      func() time.Time
	NewID    func() string
}

// Service runs the agent.
type Service struct {
	d Deps

	mu         sync.Mutex
	automation *Automation
}

// NewID mints a random identifier.
func NewID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// New wires the use cases.
func New(d Deps) *Service {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.NewID == nil {
		d.NewID = NewID
	}
	return &Service{d: d}
}

// refreshSkew renews a session a minute early, so a run never starts on a
// token that expires mid-stream.
const refreshSkew = time.Minute

// Configuration returns the stored configuration, renewing an expiring
// vendor session first. A failed renewal keeps the stored session: the
// provider then rejects it as it would an expired key.
func (s *Service) Configuration(ctx context.Context) (domain.Configuration, error) {
	c, err := s.d.Configurations.Get(ctx)
	if err != nil {
		return domain.Configuration{}, err
	}
	o := c.OAuth
	if o == nil || o.ExpiresAt.IsZero() || o.ExpiresAt.Add(-refreshSkew).After(s.d.Now()) || o.RefreshToken == "" {
		return c, nil
	}
	next, err := s.d.OAuth.Refresh(ctx, c.Provider, *o)
	if err != nil {
		return c, nil
	}
	c.OAuth = &next
	if err := s.d.Configurations.Save(ctx, c); err != nil {
		return domain.Configuration{}, err
	}
	return c, nil
}

// SaveConfiguration validates and stores a configuration. A blank key or
// a dropped session in c keeps the stored one when the provider is the
// same: the UI never holds secrets to send back.
func (s *Service) SaveConfiguration(ctx context.Context, c domain.Configuration, clearKey bool) (domain.Configuration, error) {
	stored, err := s.d.Configurations.Get(ctx)
	if err != nil {
		return domain.Configuration{}, err
	}
	if c.Provider == stored.Provider {
		if c.APIKey == "" && !clearKey {
			c.APIKey = stored.APIKey
		}
		if c.OAuth == nil {
			c.OAuth = stored.OAuth
		}
	}
	next, err := domain.NewConfiguration(c)
	if err != nil {
		return domain.Configuration{}, err
	}
	return next, s.d.Configurations.Save(ctx, next)
}

// Connect signs in to a vendor and stores the session for its provider.
func (s *Service) Connect(ctx context.Context, p domain.Provider) (domain.Configuration, error) {
	tokens, err := s.d.OAuth.Authorize(ctx, p)
	if err != nil {
		return domain.Configuration{}, err
	}
	c, err := s.d.Configurations.Get(ctx)
	if err != nil {
		return domain.Configuration{}, err
	}
	if c.Provider != p {
		c.Provider, c.Model, c.APIKey = p, p.DefaultModel(), ""
	}
	c.OAuth = &tokens
	next, err := domain.NewConfiguration(c)
	if err != nil {
		return domain.Configuration{}, err
	}
	return next, s.d.Configurations.Save(ctx, next)
}

// Disconnect forgets the vendor session.
func (s *Service) Disconnect(ctx context.Context) (domain.Configuration, error) {
	c, err := s.d.Configurations.Get(ctx)
	if err != nil {
		return domain.Configuration{}, err
	}
	c.OAuth = nil
	return c, s.d.Configurations.Save(ctx, c)
}

// OAuthProviders lists the vendors this build signs in to.
func (s *Service) OAuthProviders() []domain.Provider { return s.d.OAuth.Configured() }

// Models lists a provider's chat models with the key being typed, or the
// stored credential of the same provider.
func (s *Service) Models(ctx context.Context, p domain.Provider, typedKey, baseURL string) ([]domain.Model, error) {
	stored, err := s.Configuration(ctx)
	if err != nil {
		return nil, err
	}
	probe := domain.Configuration{Provider: p, Model: p.DefaultModel(), Instructions: domain.DefaultInstructions,
		Temperature: stored.Temperature, MaxSteps: stored.MaxSteps, HistoryLimit: stored.HistoryLimit, BaseURL: strings.TrimSpace(baseURL)}
	typedKey = strings.TrimSpace(typedKey)
	switch {
	case typedKey != "":
		probe.APIKey = typedKey
	case stored.Provider == p:
		probe.APIKey, probe.OAuth = stored.APIKey, stored.OAuth
		if probe.BaseURL == "" {
			probe.BaseURL = stored.BaseURL
		}
	}
	probe, err = domain.NewConfiguration(probe)
	if err != nil {
		return nil, err
	}
	if !probe.HasCredential() {
		return nil, domain.ErrNoCredential
	}
	models, err := s.d.Catalog.List(ctx, probe)
	if err != nil {
		return nil, err
	}
	var out []domain.Model
	seen := map[string]bool{}
	for _, m := range models {
		m.ID, m.Label = strings.TrimSpace(m.ID), strings.TrimSpace(m.Label)
		if m.ID == "" || seen[m.ID] {
			continue
		}
		seen[m.ID] = true
		if m.Label == m.ID {
			m.Label = ""
		}
		out = append(out, m)
	}
	return out, nil
}

// Threads lists the conversations, newest first, and the active one.
func (s *Service) Threads(ctx context.Context) ([]domain.ThreadSummary, string, error) {
	ts, err := s.d.Threads.Threads(ctx)
	if err != nil {
		return nil, "", err
	}
	out := make([]domain.ThreadSummary, len(ts))
	for i, t := range ts {
		out[i] = t.Summary()
	}
	slices.SortFunc(out, func(a, b domain.ThreadSummary) int { return b.UpdatedAt.Compare(a.UpdatedAt) })
	active, err := s.d.Threads.ActiveThread(ctx)
	return out, active, err
}

// Thread returns one conversation.
func (s *Service) Thread(ctx context.Context, id string) (domain.Thread, bool, error) {
	return s.d.Threads.Thread(ctx, id)
}

// CreateThread starts a conversation and makes it active.
func (s *Service) CreateThread(ctx context.Context) (domain.Thread, error) {
	t, err := domain.NewThread(s.d.NewID(), s.d.Now())
	if err != nil {
		return domain.Thread{}, err
	}
	if err := s.d.Threads.SaveThread(ctx, t); err != nil {
		return domain.Thread{}, err
	}
	return t, s.d.Threads.SetActiveThread(ctx, t.ID)
}

// SelectThread makes a conversation active.
func (s *Service) SelectThread(ctx context.Context, id string) (domain.Thread, error) {
	t, ok, err := s.d.Threads.Thread(ctx, id)
	if err != nil {
		return domain.Thread{}, err
	}
	if !ok {
		return domain.Thread{}, tg.ErrNotFound
	}
	return t, s.d.Threads.SetActiveThread(ctx, id)
}

// DeleteThread removes a conversation.
func (s *Service) DeleteThread(ctx context.Context, id string) error {
	return s.d.Threads.DeleteThread(ctx, id)
}

// RunInput is a panel run.
type RunInput struct {
	Thread string
	Prompt string
	// Label is what the transcript shows for a prompt Telo assembled.
	Label    string
	Scope    *ScopeInput
	Snapshot domain.Snapshot
}

// Preview is the payload a scope would send now.
func (s *Service) Preview(ctx context.Context, in ScopeInput) (domain.ScopedContext, error) {
	repo := s.d.Telegram()
	if repo == nil {
		return domain.ScopedContext{}, tg.ErrNotFound
	}
	return Assemble(ctx, repo, in)
}

func (s *Service) append(ctx context.Context, t *domain.Thread, role domain.Role, body string, failed bool) error {
	next, err := t.Append(domain.ThreadMessage{ID: s.d.NewID(), Role: role, Body: body, SentAt: s.d.Now(), Error: failed})
	if err != nil {
		return err
	}
	*t = next
	return s.d.Threads.SaveThread(ctx, next)
}

// Run streams a panel run into its thread. The question is saved before
// the model answers, so a crash never loses it; every run that sent a
// payload is audited by the hash of its exact prompt.
func (s *Service) Run(ctx context.Context, in RunInput, emit func(domain.Output)) error {
	cfg, err := s.Configuration(ctx)
	if err != nil {
		return err
	}
	t, ok, err := s.d.Threads.Thread(ctx, in.Thread)
	if err != nil {
		return err
	}
	if !ok {
		if t, err = domain.NewThread(in.Thread, s.d.Now()); err != nil {
			return err
		}
	}
	history := make([]domain.HistoryMessage, 0, len(t.Messages))
	for _, m := range t.History(cfg.HistoryLimit) {
		if !m.Error {
			history = append(history, domain.HistoryMessage{Role: m.Role, Body: m.Body})
		}
	}
	label := in.Label
	if label == "" {
		label = in.Prompt
	}
	if err := s.append(ctx, &t, domain.RoleUser, label, false); err != nil {
		return err
	}
	if err := s.d.Threads.SetActiveThread(ctx, t.ID); err != nil {
		return err
	}
	prompt := in.Prompt
	var payload domain.ScopedContext
	if in.Scope != nil {
		repo := s.d.Telegram()
		if repo == nil {
			return tg.ErrNotFound
		}
		// An invalid scope fails before anything leaves the device.
		payload, err = Assemble(ctx, repo, *in.Scope)
		if err != nil {
			emit(domain.Output{Kind: domain.OutputError, Err: err})
			return s.append(ctx, &t, domain.RoleAssistant, err.Error(), true)
		}
		prompt = ScopedPrompt(in.Prompt, payload)
	}
	var reply strings.Builder
	var failure error
	err = s.d.Gateway.Stream(ctx, domain.Request{Prompt: prompt, History: history, Snapshot: in.Snapshot, Configuration: cfg, Tools: s.tools(cfg, in.Snapshot)},
		func(o domain.Output) {
			switch o.Kind {
			case domain.OutputText:
				reply.WriteString(o.Text)
			case domain.OutputError:
				failure = o.Err
			}
			emit(o)
		})
	if err != nil && failure == nil {
		failure = err
		emit(domain.Output{Kind: domain.OutputError, Err: err})
	}
	if err := s.audit(ctx, t.ID, payload, cfg, prompt); err != nil {
		return err
	}
	if reply.Len() > 0 {
		if err := s.append(ctx, &t, domain.RoleAssistant, reply.String(), false); err != nil {
			return err
		}
	}
	if failure != nil {
		return s.append(ctx, &t, domain.RoleAssistant, errorCode(failure), true)
	}
	return nil
}

// errorCode stores a failed run's outcome as its domain error text; the
// panel words the known outcomes.
func errorCode(err error) string {
	for _, known := range []error{domain.ErrNoCredential, domain.ErrRejected, domain.ErrUnreachable, domain.ErrRequestFailed} {
		if errors.Is(err, known) {
			return known.Error()
		}
	}
	return err.Error()
}

func (s *Service) audit(ctx context.Context, thread string, payload domain.ScopedContext, cfg domain.Configuration, prompt string) error {
	ids := make([]int64, len(payload.Messages))
	for i, m := range payload.Messages {
		ids[i] = m.MessageID
	}
	return s.d.Audits.Append(ctx, domain.AuditRecord{ID: s.d.NewID(), Timestamp: s.d.Now(), Action: "run", ThreadID: thread,
		Scope: payload.Scope, MessageIDs: ids, Redactions: payload.Redactions, Model: cfg.Model, PromptHash: domain.HashPrompt(prompt)})
}

// SuggestionLimit is how many follow-ups fit one row over the composer.
const SuggestionLimit = 3

// Suggest proposes follow-ups to a thread's last answered question.
func (s *Service) Suggest(ctx context.Context, thread string) []string {
	t, ok, err := s.d.Threads.Thread(ctx, thread)
	if err != nil || !ok || len(t.Messages) < 2 {
		return nil
	}
	reply, question := t.Messages[len(t.Messages)-1], t.Messages[len(t.Messages)-2]
	if reply.Role != domain.RoleAssistant || reply.Error || question.Role != domain.RoleUser {
		return nil
	}
	cfg, err := s.Configuration(ctx)
	if err != nil {
		return nil
	}
	return s.d.Gateway.Suggest(ctx, cfg, question.Body, reply.Body, SuggestionLimit)
}

// ActionKind is a message action.
type ActionKind string

const (
	ActionTranslate  ActionKind = "translate"
	ActionRewrite    ActionKind = "rewrite"
	ActionDraftReply ActionKind = "draft-reply"
)

// ActionPrompt builds a message action's prompt: an output-only
// instruction, the machine marker, and the text between input markers.
func ActionPrompt(kind ActionKind, tone, body string) string {
	switch kind {
	case ActionDraftReply:
		if tone == "" {
			tone = "neutral"
		}
		return strings.Join([]string{"Draft a " + tone + " reply to the message in its own language. Answer with the suggested reply only.",
			domain.ActionDraftReply, "[[telo-tone:" + tone + "]]", domain.InputOpen, body, domain.InputClose}, "\n")
	case ActionRewrite:
		return strings.Join([]string{"Polish the message: clearer and better written, same language and meaning. Answer with the rewritten text only.",
			domain.ActionRewrite, domain.InputOpen, body, domain.InputClose}, "\n")
	}
	return strings.Join([]string{"Translate the message into English. Answer with the translated text only.",
		domain.ActionTranslate, domain.InputOpen, body, domain.InputClose}, "\n")
}

// MessageAction streams a translation, rewrite or reply draft; it lands
// in the composer, so no thread reads or keeps it.
func (s *Service) MessageAction(ctx context.Context, kind ActionKind, tone, body string, emit func(domain.Output)) error {
	cfg, err := s.Configuration(ctx)
	if err != nil {
		return err
	}
	return s.d.Gateway.Stream(ctx, domain.Request{Prompt: ActionPrompt(kind, tone, body), Configuration: cfg}, emit)
}

// Summarize summarizes a chat's unread messages into a thread.
func (s *Service) Summarize(ctx context.Context, thread string, chat tg.Chat, label string, emit func(domain.Output)) error {
	return s.Run(ctx, RunInput{Thread: thread, Label: label,
		Prompt: domain.ActionSummarize + "\nSummarize the unread messages of the chat \"" + chat.Title + "\".",
		Scope:  &ScopeInput{Scope: domain.ScopeUnread, Chat: chat.ID}}, emit)
}

// Extract lists a chat's decisions, open questions and action items.
func (s *Service) Extract(ctx context.Context, thread string, chat tg.Chat, label string, emit func(domain.Output)) error {
	return s.Run(ctx, RunInput{Thread: thread, Label: label,
		Prompt: domain.ActionExtract + "\nExtract the decisions, open questions, and action items from the unread messages of the chat \"" + chat.Title +
			"\". Group them under \"Decisions\", \"Open questions\", and \"Action items\".",
		Scope: &ScopeInput{Scope: domain.ScopeUnread, Chat: chat.ID}}, emit)
}
