package agent

import (
	"slices"
	"strings"
	"testing"
	"time"
)

func at(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.ParseInLocation("2006-01-02T15:04:05", s, time.Local)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestCronField(t *testing.T) {
	cases := []struct {
		field  string
		lo, hi int
		want   []int
	}{
		{"*", 0, 4, []int{0, 1, 2, 3, 4}},
		{"1,3", 0, 59, []int{1, 3}},
		{"2-4", 0, 59, []int{2, 3, 4}},
		{"*/2", 0, 5, []int{0, 2, 4}},
		{"1-5/2", 0, 59, []int{1, 3, 5}},
		{"5/10", 0, 25, []int{5, 15, 25}},
	}
	for _, c := range cases {
		got, err := cronField(c.field, c.lo, c.hi, nil)
		if err != nil || !slices.Equal(got, c.want) {
			t.Errorf("cronField(%q) = %v, %v; want %v", c.field, got, err, c.want)
		}
	}
	for _, bad := range []string{"", "99", "x", "5-2", "*/0"} {
		if _, err := cronField(bad, 0, 59, nil); err == nil {
			t.Errorf("cronField(%q) accepted", bad)
		}
	}
	for _, bad := range []string{"* * * *", "* * * * * *"} {
		if _, err := ParseCron(bad); err == nil || !strings.Contains(err.Error(), "5 fields") {
			t.Errorf("ParseCron(%q) = %v", bad, err)
		}
	}
}

func TestCronNext(t *testing.T) {
	cases := []struct{ expr, after, want string }{
		{"* * * * *", "2026-09-03T10:20:30", "2026-09-03T10:21:00"},
		{"30 9 * * *", "2026-09-03T08:00:00", "2026-09-03T09:30:00"},
		{"30 9 * * *", "2026-09-03T09:30:00", "2026-09-04T09:30:00"},
		{"*/15 * * * *", "2026-09-03T10:07:00", "2026-09-03T10:15:00"},
		{"0 9 * * mon", "2026-09-03T10:00:00", "2026-09-07T09:00:00"},
		{"0 9 * * 0", "2026-09-05T10:00:00", "2026-09-06T09:00:00"},
		{"0 9 * * 7", "2026-09-05T10:00:00", "2026-09-06T09:00:00"},
		{"0 12 13 * fri", "2026-09-03T00:00:00", "2026-09-04T12:00:00"},
		{"0 0 29 2 *", "2026-09-03T00:00:00", "2028-02-29T00:00:00"},
		{"0 0 1 1 *", "2026-12-31T23:59:00", "2027-01-01T00:00:00"},
		{"0 9 1 jan *", "2026-09-03T00:00:00", "2027-01-01T09:00:00"},
	}
	for _, c := range cases {
		cron, err := ParseCron(c.expr)
		if err != nil {
			t.Fatal(err)
		}
		got, ok := cron.Next(at(t, c.after))
		if !ok || !got.Equal(at(t, c.want)) {
			t.Errorf("%q after %s = %v, %v; want %s", c.expr, c.after, got, ok, c.want)
		}
	}
	impossible, _ := ParseCron("0 0 30 2 *")
	if _, ok := impossible.Next(at(t, "2026-09-03T00:00:00")); ok {
		t.Error("Feb 30 fired")
	}
}

func TestRedact(t *testing.T) {
	text, c := Redact("mail ada@example.com or call +44 20 7946 0958 or 4155550123, key sk-abcdefghijklmnopqrstuv")
	if c != (RedactionCounts{Emails: 1, Phones: 2, Tokens: 1}) {
		t.Fatalf("counts %+v in %q", c, text)
	}
	if strings.Contains(text, "ada@") || strings.Contains(text, "sk-abc") || strings.Contains(text, "7946") {
		t.Fatal(text)
	}
	keep := "Meeting 2026-08-27 at 10:30, order 123456, see you"
	if got, c := Redact(keep); got != keep || c != (RedactionCounts{}) {
		t.Fatalf("redacted plain text: %q %+v", got, c)
	}
	ms, total := RedactContext([]ScopedMessage{{Sender: "ada@example.com", Body: "hi"}, {Sender: "Bob", Body: "+1 415 555 0123"}})
	if total != (RedactionCounts{Emails: 1, Phones: 1}) || ms[0].Sender != RedactedEmail || ms[1].Body != RedactedPhone {
		t.Fatalf("%+v %+v", ms, total)
	}
}

func TestConfiguration(t *testing.T) {
	c := DefaultConfiguration()
	c.Provider, c.BaseURL, c.OAuth = ProviderGroq, "https://leftover.example", &OAuthTokens{AccessToken: "t"}
	got, err := NewConfiguration(c)
	if err != nil {
		t.Fatal(err)
	}
	if got.BaseURL != "" || got.OAuth != nil {
		t.Fatalf("named provider kept leftovers: %+v", got)
	}
	c = DefaultConfiguration()
	c.Provider = ProviderCompatible
	if _, err := NewConfiguration(c); err != ErrBaseURLRequired {
		t.Fatalf("compatible without URL: %v", err)
	}
	c.BaseURL = "http://insecure.example"
	if _, err := NewConfiguration(c); err != ErrBaseURLNotHTTPS {
		t.Fatalf("http URL: %v", err)
	}
	for _, bad := range []func(*Configuration){
		func(c *Configuration) { c.Temperature = 2.5 },
		func(c *Configuration) { c.MaxSteps = 0 },
		func(c *Configuration) { c.HistoryLimit = 51 },
		func(c *Configuration) { c.Model = " " },
		func(c *Configuration) { c.Instructions = "" },
		func(c *Configuration) { c.Provider = "unknown" },
	} {
		c := DefaultConfiguration()
		bad(&c)
		if _, err := NewConfiguration(c); err == nil {
			t.Errorf("accepted %+v", c)
		}
	}
	if !IsKimiFamily("moonshotai/kimi-k2.6") || !IsKimiFamily("vendor/kimi-k3") || IsKimiFamily("gpt-4.1") {
		t.Fatal("kimi family")
	}
	k := DefaultConfiguration()
	k.Provider = ProviderKimi
	if !k.OmitsTemperature() {
		t.Fatal("kimi keeps temperature")
	}
}

func TestThread(t *testing.T) {
	now := time.Now()
	th, err := NewThread("a", now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := th.Append(ThreadMessage{Role: RoleUser, Body: "  "}); err != ErrEmptyMessage {
		t.Fatal(err)
	}
	long := strings.Repeat("x", 70)
	th, _ = th.Append(ThreadMessage{Role: RoleAssistant, Body: "hello", SentAt: now})
	th, _ = th.Append(ThreadMessage{Role: RoleUser, Body: long, SentAt: now.Add(time.Second)})
	if th.Title() != strings.Repeat("x", 60)+"…" || !th.UpdatedAt.Equal(now.Add(time.Second)) {
		t.Fatalf("title %q", th.Title())
	}
	if h := th.History(1); len(h) != 1 || h[0].Role != RoleUser {
		t.Fatal(h)
	}
	chat, msg, ok := ParseMessageLink("see " + MessageLink(-1001, 42))
	if !ok || chat != -1001 || msg != 42 {
		t.Fatal(chat, msg, ok)
	}
}

func TestRule(t *testing.T) {
	if _, err := NewRule(Rule{ID: "r", Name: "n", PromptTemplate: "p"}); err != ErrNoMatchDimension {
		t.Fatal(err)
	}
	if _, err := NewRule(Rule{ID: "r", Name: "n", PromptTemplate: "p", Match: RuleMatch{Pattern: "("}}); err == nil {
		t.Fatal("invalid pattern accepted")
	}
	r, err := NewRule(Rule{ID: "r", Name: "n", PromptTemplate: "p", Enabled: true, Match: RuleMatch{Keywords: []string{"Invoice"}, Pattern: `\d{3}`, ExcludeMuted: true}})
	if err != nil {
		t.Fatal(err)
	}
	if r.Delivery != DeliverDraftOnly {
		t.Fatal(r.Delivery)
	}
	if !r.Matches(Incoming{Body: "invoice 123"}) {
		t.Fatal("no match")
	}
	for _, m := range []Incoming{{Body: "invoice 12"}, {Body: "bill 123"}, {Body: "invoice 123", Outgoing: true}, {Body: "invoice 123", ChatMuted: true}} {
		if r.Matches(m) {
			t.Errorf("matched %+v", m)
		}
	}
}

func TestTask(t *testing.T) {
	now := at(t, "2026-09-03T10:00:00")
	task, err := NewTask(Task{ID: "t", Name: "n", PromptTemplate: "p", ChatID: 5, Schedule: Schedule{Kind: ScheduleOnce, RunAt: now.Add(time.Hour)}, Context: &TaskContext{Scope: ScopeUnread}})
	if err != nil {
		t.Fatal(err)
	}
	if task.Context.ChatID != 5 {
		t.Fatal("unread scope did not default to the delivery chat")
	}
	if next, ok := task.NextRun(now); !ok || !next.Equal(now.Add(time.Hour)) {
		t.Fatal(next, ok)
	}
	if _, ok := task.NextRun(now.Add(2 * time.Hour)); ok {
		t.Fatal("spent one-shot fires")
	}
	if _, err := NewTask(Task{ID: "t", Name: "n", PromptTemplate: "p", ChatID: 5, Schedule: Schedule{Kind: ScheduleCron, Expression: "bad"}}); err == nil {
		t.Fatal("bad cron accepted")
	}
}
