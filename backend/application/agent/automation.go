package agent

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"time"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// Rules lists the trigger rules.
func (s *Service) Rules(ctx context.Context) ([]domain.Rule, error) { return s.d.Rules.Rules(ctx) }

// Tasks lists the scheduled tasks.
func (s *Service) Tasks(ctx context.Context) ([]domain.Task, error) { return s.d.Tasks.Tasks(ctx) }

func (s *Service) rule(ctx context.Context, id string) (domain.Rule, error) {
	rs, err := s.d.Rules.Rules(ctx)
	if err != nil {
		return domain.Rule{}, err
	}
	i := slices.IndexFunc(rs, func(r domain.Rule) bool { return r.ID == id })
	if i < 0 {
		return domain.Rule{}, tg.ErrNotFound
	}
	return rs[i], nil
}

func (s *Service) task(ctx context.Context, id string) (domain.Task, error) {
	ts, err := s.d.Tasks.Tasks(ctx)
	if err != nil {
		return domain.Task{}, err
	}
	i := slices.IndexFunc(ts, func(t domain.Task) bool { return t.ID == id })
	if i < 0 {
		return domain.Task{}, tg.ErrNotFound
	}
	return ts[i], nil
}

// SaveRule creates a rule (empty ID) or edits one; identity, creation and
// author survive an edit.
func (s *Service) SaveRule(ctx context.Context, r domain.Rule, by domain.Creator) (domain.Rule, error) {
	now := s.d.Now()
	if r.ID == "" {
		r.ID, r.CreatedBy, r.CreatedAt, r.Enabled = s.d.NewID(), by, now, true
	} else {
		old, err := s.rule(ctx, r.ID)
		if err != nil {
			return domain.Rule{}, err
		}
		r.CreatedBy, r.CreatedAt, r.Enabled = old.CreatedBy, old.CreatedAt, old.Enabled
	}
	r.UpdatedAt = now
	next, err := domain.NewRule(r)
	if err != nil {
		return domain.Rule{}, err
	}
	return next, s.d.Rules.SaveRule(ctx, next)
}

func (s *Service) SetRuleEnabled(ctx context.Context, id string, enabled bool) (domain.Rule, error) {
	r, err := s.rule(ctx, id)
	if err != nil {
		return domain.Rule{}, err
	}
	r.Enabled, r.UpdatedAt = enabled, s.d.Now()
	return r, s.d.Rules.SaveRule(ctx, r)
}

func (s *Service) RemoveRule(ctx context.Context, id string) error {
	if _, err := s.rule(ctx, id); err != nil {
		return err
	}
	return s.d.Rules.RemoveRule(ctx, id)
}

// SaveTask creates a task (empty ID) or edits one.
func (s *Service) SaveTask(ctx context.Context, t domain.Task, by domain.Creator) (domain.Task, error) {
	now := s.d.Now()
	if t.ID == "" {
		t.ID, t.CreatedBy, t.CreatedAt, t.Enabled = s.d.NewID(), by, now, true
	} else {
		old, err := s.task(ctx, t.ID)
		if err != nil {
			return domain.Task{}, err
		}
		t.CreatedBy, t.CreatedAt, t.Enabled, t.LastRunAt = old.CreatedBy, old.CreatedAt, old.Enabled, old.LastRunAt
	}
	t.UpdatedAt = now
	next, err := domain.NewTask(t)
	if err != nil {
		return domain.Task{}, err
	}
	if err := s.d.Tasks.SaveTask(ctx, next); err != nil {
		return domain.Task{}, err
	}
	s.reschedule()
	return next, nil
}

func (s *Service) SetTaskEnabled(ctx context.Context, id string, enabled bool) (domain.Task, error) {
	t, err := s.task(ctx, id)
	if err != nil {
		return domain.Task{}, err
	}
	t.Enabled, t.UpdatedAt = enabled, s.d.Now()
	if err := s.d.Tasks.SaveTask(ctx, t); err != nil {
		return domain.Task{}, err
	}
	s.reschedule()
	return t, nil
}

func (s *Service) RemoveTask(ctx context.Context, id string) error {
	if _, err := s.task(ctx, id); err != nil {
		return err
	}
	if err := s.d.Tasks.RemoveTask(ctx, id); err != nil {
		return err
	}
	s.reschedule()
	return nil
}

// RunStatus is how an automation run ended.
type RunStatus string

const (
	RunSent  RunStatus = "sent"
	RunDraft RunStatus = "draft"
	// RunConflict parks an answer: the composer held a person's text.
	RunConflict RunStatus = "draft-conflict"
	RunEmpty    RunStatus = "empty"
	RunFailed   RunStatus = "error"
)

// RunReport tells the UI what an automation run did.
type RunReport struct {
	Source   string // "trigger" or "schedule"
	SourceID string
	Name     string
	ChatID   tg.ChatID
	Delivery domain.Delivery
	Status   RunStatus
	Preview  string
	Err      error
}

type automationRun struct {
	prompt   string
	delivery domain.Delivery
	chat     tg.ChatID
	replyTo  tg.MessageID
	scope    *ScopeInput
}

// execute runs one automation end to end: the optional scoped payload,
// the model, the audit, then delivery into Telegram.
func (s *Service) execute(ctx context.Context, repo tg.Repository, in automationRun) (RunStatus, string, error) {
	cfg, err := s.Configuration(ctx)
	if err != nil {
		return RunFailed, "", err
	}
	prompt := in.prompt
	var payload domain.ScopedContext
	if in.scope != nil {
		if payload, err = Assemble(ctx, repo, *in.scope); err != nil {
			return RunFailed, "", err
		}
		prompt = ScopedPrompt(in.prompt, payload)
	}
	var reply strings.Builder
	var failure error
	err = s.d.Gateway.Stream(ctx, domain.Request{Prompt: prompt, Configuration: cfg, Tools: s.tools(cfg, domain.Snapshot{})}, func(o domain.Output) {
		switch o.Kind {
		case domain.OutputText:
			reply.WriteString(o.Text)
		case domain.OutputError:
			failure = o.Err
		}
	})
	if failure == nil {
		failure = err
	}
	if err := s.audit(ctx, "automation", payload, cfg, prompt); err != nil {
		return RunFailed, reply.String(), err
	}
	text := strings.TrimSpace(reply.String())
	switch {
	case failure != nil:
		return RunFailed, text, failure
	case text == "":
		return RunEmpty, "", nil
	}
	if in.delivery == domain.DeliverAutoSend {
		if _, err := repo.SendMessage(ctx, in.chat, text, tg.SendOptions{ReplyTo: in.replyTo}); err != nil {
			return RunFailed, text, err
		}
		return RunSent, text, nil
	}
	c, err := repo.Chat(ctx, in.chat)
	if err != nil {
		return RunFailed, text, err
	}
	// A half-written message is a person's; automation never overwrites it.
	if c.DraftPreview != "" {
		return RunConflict, text, nil
	}
	if err := tg.RequireSend(c, tg.ContentText); err != nil {
		return RunFailed, text, err
	}
	if err := repo.SaveDraft(ctx, in.chat, text); err != nil {
		return RunFailed, text, err
	}
	return RunDraft, text, nil
}

const previewLength = 200

func clip(s string) string {
	r := []rune(s)
	return string(r[:min(len(r), previewLength)])
}

// Automation runs the trigger rules on incoming messages and the
// scheduled tasks on their timers, for the active account.
type Automation struct {
	s      *Service
	report func(RunReport)

	mu       sync.Mutex
	inFlight map[string]bool
	timer    *time.Timer
	stop     func()
	wake     chan struct{}
}

// StartAutomation subscribes to the account's events and arms the
// scheduler; report receives every finished run.
func (s *Service) StartAutomation(repo tg.Repository, report func(RunReport)) *Automation {
	a := &Automation{s: s, report: report, inFlight: map[string]bool{}, wake: make(chan struct{}, 1)}
	muted := map[tg.ChatID]bool{}
	var mu sync.Mutex
	unsub := repo.Subscribe(func(e tg.Event) {
		switch e := e.(type) {
		case tg.ChatUpserted:
			mu.Lock()
			muted[e.Chat.ID] = e.Chat.Muted
			mu.Unlock()
		case tg.MessageUpserted:
			// Edits never re-fire, and outgoing messages are the anti-loop
			// boundary, automation's own sends included.
			if e.Edited || e.Message.Outgoing || e.Replaces != 0 || e.Message.Service != tg.ServiceNone {
				return
			}
			mu.Lock()
			m := muted[e.Message.ChatID]
			mu.Unlock()
			go a.trigger(repo, e.Message, m)
		}
	})
	done := make(chan struct{})
	a.stop = func() { unsub(); close(done) }
	s.mu.Lock()
	s.automation = a
	s.mu.Unlock()
	go a.schedule(repo, done)
	return a
}

// Stop ends automation for the account.
func (a *Automation) Stop() {
	a.s.mu.Lock()
	if a.s.automation == a {
		a.s.automation = nil
	}
	a.s.mu.Unlock()
	a.stop()
}

func (s *Service) reschedule() {
	s.mu.Lock()
	a := s.automation
	s.mu.Unlock()
	if a == nil {
		return
	}
	select {
	case a.wake <- struct{}{}:
	default:
	}
}

func (a *Automation) claim(id string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.inFlight[id] {
		return false
	}
	a.inFlight[id] = true
	return true
}

func (a *Automation) release(id string) {
	a.mu.Lock()
	delete(a.inFlight, id)
	a.mu.Unlock()
}

// trigger runs the matching rules one after another, so several rules on
// one chat never race replies into it; a rule running is not re-entered.
func (a *Automation) trigger(repo tg.Repository, m tg.Message, muted bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	rules, err := a.s.d.Rules.Rules(ctx)
	if err != nil {
		a.report(RunReport{Source: "trigger", ChatID: m.ChatID, Status: RunFailed, Err: err})
		return
	}
	for _, r := range rules {
		if !r.Matches(domain.Incoming{ChatID: int64(m.ChatID), SenderID: m.SenderID, Body: m.Body, ChatMuted: muted}) || !a.claim(r.ID) {
			continue
		}
		status, text, err := a.s.execute(ctx, repo, automationRun{prompt: r.PromptTemplate, delivery: r.Delivery, chat: m.ChatID, replyTo: m.ID,
			scope: &ScopeInput{Scope: domain.ScopeSelected, Chat: m.ChatID, Messages: []tg.MessageID{m.ID}}})
		a.release(r.ID)
		a.report(RunReport{Source: "trigger", SourceID: r.ID, Name: r.Name, ChatID: m.ChatID, Delivery: r.Delivery, Status: status, Preview: clip(text), Err: err})
	}
}

// schedule fires due tasks: one-shots missed while Telo was closed, then
// each task at its next time, re-arming after every run and every edit.
func (a *Automation) schedule(repo tg.Repository, done <-chan struct{}) {
	for {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		tasks, err := a.s.d.Tasks.Tasks(ctx)
		cancel()
		if err != nil {
			a.report(RunReport{Source: "schedule", Status: RunFailed, Err: err})
		}
		now := a.s.d.Now()
		var next time.Time
		var due []domain.Task
		for _, t := range tasks {
			if !t.Enabled {
				continue
			}
			if t.Schedule.Kind == domain.ScheduleOnce && t.LastRunAt.IsZero() && !t.Schedule.RunAt.After(now) {
				due = append(due, t)
				continue
			}
			after := now
			if t.LastRunAt.After(after) {
				after = t.LastRunAt
			}
			if at, ok := t.NextRun(after); ok && (next.IsZero() || at.Before(next)) {
				next = at
			}
		}
		for _, t := range due {
			a.fire(repo, t)
		}
		if len(due) > 0 {
			continue
		}
		var timer <-chan time.Time
		if !next.IsZero() {
			timer = time.After(max(next.Sub(now), 0))
		}
		select {
		case <-done:
			return
		case <-a.wake:
		case <-timer:
			a.fireDue(repo, next)
		}
	}
}

// fireDue runs the tasks whose time is at.
func (a *Automation) fireDue(repo tg.Repository, at time.Time) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	tasks, err := a.s.d.Tasks.Tasks(ctx)
	cancel()
	if err != nil {
		return
	}
	for _, t := range tasks {
		after := at.Add(-time.Minute)
		if t.LastRunAt.After(after) {
			continue
		}
		if when, ok := t.NextRun(after); t.Enabled && ok && !when.After(at) {
			a.fire(repo, t)
		}
	}
}

func (a *Automation) fire(repo tg.Repository, t domain.Task) {
	if !a.claim(t.ID) {
		return
	}
	defer a.release(t.ID)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	var scope *ScopeInput
	if t.Context != nil {
		scope = &ScopeInput{Scope: t.Context.Scope, Chat: tg.ChatID(t.Context.ChatID), Folder: t.Context.FolderID}
	}
	status, text, err := a.s.execute(ctx, repo, automationRun{prompt: t.PromptTemplate, delivery: t.Delivery, chat: tg.ChatID(t.ChatID), scope: scope})
	// A one-shot is spent once tried; a cron's next time comes from the
	// clock either way.
	t.LastRunAt = a.s.d.Now()
	if saveErr := a.s.d.Tasks.SaveTask(ctx, t); saveErr != nil && err == nil {
		err = saveErr
	}
	a.report(RunReport{Source: "schedule", SourceID: t.ID, Name: t.Name, ChatID: tg.ChatID(t.ChatID), Delivery: t.Delivery, Status: status, Preview: clip(text), Err: err})
}

// ErrNeedsField rejects an automation tool call missing a field.
var ErrNeedsField = errors.New("agent: the call needs more fields")
