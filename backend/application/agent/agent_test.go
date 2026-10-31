package agent

import (
	"context"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	infra "github.com/AstraFoundry/telo/backend/infrastructure/agent"
	"github.com/AstraFoundry/telo/backend/infrastructure/telegram/demo"
)

type memory struct {
	mu      sync.Mutex
	cfg     domain.Configuration
	threads []domain.Thread
	active  string
	audits  []domain.AuditRecord
	rules   []domain.Rule
	tasks   []domain.Task
}

func (m *memory) Get(context.Context) (domain.Configuration, error) { return m.cfg, nil }
func (m *memory) Save(_ context.Context, c domain.Configuration) error {
	m.cfg = c
	return nil
}
func (m *memory) Threads(context.Context) ([]domain.Thread, error) {
	return slices.Clone(m.threads), nil
}
func (m *memory) Thread(_ context.Context, id string) (domain.Thread, bool, error) {
	for _, t := range m.threads {
		if t.ID == id {
			return t, true, nil
		}
	}
	return domain.Thread{}, false, nil
}
func (m *memory) SaveThread(_ context.Context, t domain.Thread) error {
	m.threads = slices.DeleteFunc(m.threads, func(x domain.Thread) bool { return x.ID == t.ID })
	m.threads = append(m.threads, t)
	return nil
}
func (m *memory) DeleteThread(context.Context, string) error         { return nil }
func (m *memory) ActiveThread(context.Context) (string, error)       { return m.active, nil }
func (m *memory) SetActiveThread(_ context.Context, id string) error { m.active = id; return nil }
func (m *memory) Append(_ context.Context, r domain.AuditRecord) error {
	m.mu.Lock()
	m.audits = append(m.audits, r)
	m.mu.Unlock()
	return nil
}
func (m *memory) Recent(context.Context, int) ([]domain.AuditRecord, error) { return m.audits, nil }
func (m *memory) Rules(context.Context) ([]domain.Rule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.rules), nil
}
func (m *memory) SaveRule(_ context.Context, r domain.Rule) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rules = append(slices.DeleteFunc(m.rules, func(x domain.Rule) bool { return x.ID == r.ID }), r)
	return nil
}
func (m *memory) RemoveRule(context.Context, string) error { return nil }
func (m *memory) Tasks(context.Context) ([]domain.Task, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.tasks), nil
}
func (m *memory) SaveTask(_ context.Context, t domain.Task) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tasks = append(slices.DeleteFunc(m.tasks, func(x domain.Task) bool { return x.ID == t.ID }), t)
	return nil
}
func (m *memory) RemoveTask(context.Context, string) error { return nil }

func setup(t *testing.T) (*Service, *memory, *demo.Repository) {
	repo := demo.New(demo.Options{CacheDir: t.TempDir(), Now: func() time.Time { return demo.Base }})
	t.Cleanup(repo.Close)
	m := &memory{cfg: domain.DefaultConfiguration()}
	m.cfg.APIKey = "sk-demo"
	n := 0
	s := New(Deps{Configurations: m, OAuth: &infra.OAuth{}, Catalog: infra.DemoCatalog{}, Gateway: infra.Demo{}, Threads: m, Audits: m,
		Rules: m, Tasks: m, Telegram: func() tg.Repository { return repo }, Now: func() time.Time { return demo.Base },
		NewID: func() string { n++; return "id" + string(rune('0'+n)) }})
	return s, m, repo
}

func TestRunSendsRedactedScopeAndAudits(t *testing.T) {
	s, m, _ := setup(t)
	var out strings.Builder
	err := s.Summarize(context.Background(), "t1", tg.Chat{ID: demo.DesignChat, Title: "Telo Design"}, "Summarize", func(o domain.Output) {
		if o.Kind == domain.OutputText {
			out.WriteString(o.Text)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out.String(), "Demo summary of 3 messages.") || !strings.Contains(out.String(), "telo://message/-1002001/") {
		t.Fatalf("reply %q", out.String())
	}
	th, _, _ := m.Thread(context.Background(), "t1")
	if len(th.Messages) != 2 || th.Messages[0].Body != "Summarize" || th.Messages[1].Role != domain.RoleAssistant {
		t.Fatalf("thread %+v", th.Messages)
	}
	if len(m.audits) != 1 || m.audits[0].Scope != domain.ScopeUnread || len(m.audits[0].MessageIDs) != 3 || m.audits[0].PromptHash == "" {
		t.Fatalf("audit %+v", m.audits)
	}
	if m.active != "t1" {
		t.Fatal("the run's thread is active")
	}
}

func TestInvalidScopeNeverLeavesTheDevice(t *testing.T) {
	s, m, _ := setup(t)
	var failed error
	err := s.Run(context.Background(), RunInput{Thread: "t2", Prompt: "hi", Scope: &ScopeInput{Scope: domain.ScopeSelected, Chat: demo.DesignChat, Messages: []tg.MessageID{9999}}},
		func(o domain.Output) { failed = o.Err })
	if err != nil || failed == nil || len(m.audits) != 0 {
		t.Fatalf("err %v failed %v audits %d", err, failed, len(m.audits))
	}
}

func TestTriggerDraftsAndNeverOverwrites(t *testing.T) {
	s, m, repo := setup(t)
	ctx := context.Background()
	if _, err := s.SaveRule(ctx, domain.Rule{Name: "Mentions", Match: domain.RuleMatch{Keywords: []string{"ship"}}, PromptTemplate: "Draft a reply."}, domain.CreatedByUser); err != nil {
		t.Fatal(err)
	}
	var reports []RunReport
	a := &Automation{s: s, report: func(r RunReport) { reports = append(reports, r) }, inFlight: map[string]bool{}}
	msg := tg.Message{ID: 16, ChatID: demo.DesignChat, SenderID: 4003, Body: "Ship both with the next build."}
	a.trigger(repo, msg, false)
	if len(reports) != 1 || reports[0].Status != RunDraft || reports[0].Err != nil {
		t.Fatalf("%+v", reports)
	}
	c, _ := repo.Chat(ctx, demo.DesignChat)
	if !strings.HasPrefix(c.DraftPreview, "Demo agent response:") {
		t.Fatalf("draft %q", c.DraftPreview)
	}
	a.trigger(repo, msg, false)
	if reports[1].Status != RunConflict {
		t.Fatalf("second run %+v", reports[1])
	}
	if len(m.audits) != 2 || m.audits[0].Scope != domain.ScopeSelected {
		t.Fatalf("audits %+v", m.audits)
	}
}

func TestSchedulerFiresMissedOneShot(t *testing.T) {
	s, m, repo := setup(t)
	ctx := context.Background()
	task, err := s.SaveTask(ctx, domain.Task{Name: "Digest", Schedule: domain.Schedule{Kind: domain.ScheduleOnce, RunAt: demo.Base.Add(-time.Hour)},
		PromptTemplate: "Digest", ChatID: int64(demo.SavedChat), Delivery: domain.DeliverAutoSend}, domain.CreatedByUser)
	if err != nil {
		t.Fatal(err)
	}
	reports := make(chan RunReport, 4)
	a := s.StartAutomation(repo, func(r RunReport) { reports <- r })
	defer a.Stop()
	select {
	case r := <-reports:
		if r.Status != RunSent || r.SourceID != task.ID {
			t.Fatalf("%+v", r)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the missed task did not run")
	}
	ts, _ := m.Tasks(ctx)
	if ts[0].LastRunAt.IsZero() {
		t.Fatal("a tried one-shot is spent")
	}
	page, _ := repo.Messages(ctx, demo.SavedChat, 0, 1)
	if !strings.HasPrefix(page.Items[0].Body, "Demo agent response: Digest") {
		t.Fatalf("sent %q", page.Items[0].Body)
	}
}

func TestToolsExposeTelegramAndAutomation(t *testing.T) {
	s, _, _ := setup(t)
	cfg := domain.DefaultConfiguration()
	tools := s.tools(cfg, domain.Snapshot{})
	names := make([]string, len(tools))
	for i, tl := range tools {
		names[i] = tl.Name
	}
	want := []string{"inspectWorkspace", "listChats", "readChatHistory", "searchChatMessages", "searchGlobal", "configureTriggerRule", "configureScheduledTask"}
	if !slices.Equal(names, want) {
		t.Fatalf("%v", names)
	}
	out, err := tools[2].Run(context.Background(), `{"chatId":"-1002001","limit":2}`)
	if err != nil || !strings.Contains(out, `"messageId":"16"`) {
		t.Fatalf("%s %v", out, err)
	}
	out, err = tools[5].Run(context.Background(), `{"action":"create","name":"Ping","match":{"keywords":["ping"]},"promptTemplate":"Answer"}`)
	if err != nil || !strings.Contains(out, `"createdBy":"agent"`) {
		t.Fatalf("%s %v", out, err)
	}
}
