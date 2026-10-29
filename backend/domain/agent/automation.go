package agent

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

func itoa(v int64) string { return strconv.FormatInt(v, 10) }

func atoi(s string) int64 {
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}

// Delivery is how an automation run's answer reaches the chat. The
// default is a draft, so nothing leaves the account unless a rule opts in.
type Delivery string

const (
	DeliverAutoSend  Delivery = "auto-send"
	DeliverDraftOnly Delivery = "draft-only"
)

// Valid tells a known delivery mode.
func (d Delivery) Valid() bool { return d == DeliverAutoSend || d == DeliverDraftOnly }

// Creator is who authored a rule or task; the agent's take effect at once.
type Creator string

const (
	CreatedByUser  Creator = "user"
	CreatedByAgent Creator = "agent"
)

// RuleMatch is what a trigger rule fires on. Dimensions combine with AND;
// keywords within one combine with OR.
type RuleMatch struct {
	ChatIDs   []int64  `json:"chatIds"`
	SenderIDs []int64  `json:"senderIds"`
	Keywords  []string `json:"keywords"`
	// Pattern is a regular expression (Go RE2 syntax, case-insensitive)
	// tested against the body.
	Pattern      string `json:"pattern,omitempty"`
	ExcludeMuted bool   `json:"excludeMuted"`
}

// Rule is a trigger rule: an incoming message that matches runs the agent
// with the message attached.
type Rule struct {
	ID             string    `json:"ruleId"`
	Name           string    `json:"name"`
	Enabled        bool      `json:"enabled"`
	Match          RuleMatch `json:"match"`
	Delivery       Delivery  `json:"delivery"`
	PromptTemplate string    `json:"promptTemplate"`
	CreatedBy      Creator   `json:"createdBy"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`

	pattern *regexp.Regexp
}

// ErrNoMatchDimension rejects a rule that would match every message.
var ErrNoMatchDimension = errors.New("agent: a trigger rule needs a chat, sender, keyword or pattern")

// NewRule validates and normalizes a rule; the zero Delivery is draft-only.
func NewRule(r Rule) (Rule, error) {
	r.ID, r.Name, r.PromptTemplate = strings.TrimSpace(r.ID), strings.TrimSpace(r.Name), strings.TrimSpace(r.PromptTemplate)
	switch {
	case r.ID == "":
		return Rule{}, errors.New("agent: trigger rule id is required")
	case r.Name == "":
		return Rule{}, errors.New("agent: trigger rule name is required")
	case r.PromptTemplate == "":
		return Rule{}, errors.New("agent: trigger rule prompt is required")
	}
	if r.Delivery == "" {
		r.Delivery = DeliverDraftOnly
	}
	if !r.Delivery.Valid() {
		return Rule{}, fmt.Errorf("agent: unknown delivery mode %q", r.Delivery)
	}
	var kw []string
	for _, k := range r.Match.Keywords {
		if k = strings.TrimSpace(k); k != "" {
			kw = append(kw, k)
		}
	}
	r.Match.Keywords = kw
	r.Match.Pattern = strings.TrimSpace(r.Match.Pattern)
	if len(r.Match.ChatIDs) == 0 && len(r.Match.SenderIDs) == 0 && len(kw) == 0 && r.Match.Pattern == "" {
		return Rule{}, ErrNoMatchDimension
	}
	if r.Match.Pattern != "" {
		p, err := regexp.Compile("(?i)" + r.Match.Pattern)
		if err != nil {
			return Rule{}, fmt.Errorf("agent: trigger rule pattern is not a valid regular expression: %s", r.Match.Pattern)
		}
		r.pattern = p
	}
	return r, nil
}

// Incoming is one message evaluated against rules.
type Incoming struct {
	ChatID    int64
	SenderID  int64
	Body      string
	Outgoing  bool
	ChatMuted bool
}

// Matches tells whether the rule fires for m. Outgoing messages never
// match, so the account's own sends, automation's included, cannot loop.
func (r Rule) Matches(m Incoming) bool {
	if !r.Enabled || m.Outgoing || (r.Match.ExcludeMuted && m.ChatMuted) {
		return false
	}
	if len(r.Match.ChatIDs) > 0 && !slices.Contains(r.Match.ChatIDs, m.ChatID) {
		return false
	}
	if len(r.Match.SenderIDs) > 0 && !slices.Contains(r.Match.SenderIDs, m.SenderID) {
		return false
	}
	if len(r.Match.Keywords) > 0 {
		body := strings.ToLower(m.Body)
		if !slices.ContainsFunc(r.Match.Keywords, func(k string) bool { return strings.Contains(body, strings.ToLower(k)) }) {
			return false
		}
	}
	if r.Match.Pattern != "" {
		p := r.pattern
		if p == nil {
			p = regexp.MustCompile("(?i)" + r.Match.Pattern)
		}
		if !p.MatchString(m.Body) {
			return false
		}
	}
	return true
}

// ScheduleKind is how a task recurs.
type ScheduleKind string

const (
	ScheduleCron ScheduleKind = "cron"
	ScheduleOnce ScheduleKind = "once"
)

// Schedule is when a task fires: a cron expression, or once at RunAt.
type Schedule struct {
	Kind       ScheduleKind `json:"kind"`
	Expression string       `json:"expression,omitempty"`
	RunAt      time.Time    `json:"runAt,omitzero"`
}

// TaskContext scopes a scheduled run to unread messages of a chat or a
// folder ("selected" ids would go stale between scheduling and firing).
type TaskContext struct {
	Scope    Scope `json:"scope"`
	ChatID   int64 `json:"chatId,omitempty"`
	FolderID int   `json:"folderId,omitempty"`
}

// Task is a scheduled agent run delivered to a chat.
type Task struct {
	ID             string       `json:"taskId"`
	Name           string       `json:"name"`
	Enabled        bool         `json:"enabled"`
	Schedule       Schedule     `json:"schedule"`
	Delivery       Delivery     `json:"delivery"`
	PromptTemplate string       `json:"promptTemplate"`
	ChatID         int64        `json:"chatId"`
	Context        *TaskContext `json:"context,omitempty"`
	LastRunAt      time.Time    `json:"lastRunAt,omitzero"`
	CreatedBy      Creator      `json:"createdBy"`
	CreatedAt      time.Time    `json:"createdAt"`
	UpdatedAt      time.Time    `json:"updatedAt"`
}

// NewTask validates and normalizes a task.
func NewTask(t Task) (Task, error) {
	t.ID, t.Name, t.PromptTemplate = strings.TrimSpace(t.ID), strings.TrimSpace(t.Name), strings.TrimSpace(t.PromptTemplate)
	switch {
	case t.ID == "":
		return Task{}, errors.New("agent: scheduled task id is required")
	case t.Name == "":
		return Task{}, errors.New("agent: scheduled task name is required")
	case t.PromptTemplate == "":
		return Task{}, errors.New("agent: scheduled task prompt is required")
	case t.ChatID == 0:
		return Task{}, errors.New("agent: scheduled task chat is required")
	}
	if t.Delivery == "" {
		t.Delivery = DeliverDraftOnly
	}
	if !t.Delivery.Valid() {
		return Task{}, fmt.Errorf("agent: unknown delivery mode %q", t.Delivery)
	}
	switch t.Schedule.Kind {
	case ScheduleCron:
		if _, err := ParseCron(t.Schedule.Expression); err != nil {
			return Task{}, err
		}
		t.Schedule.Expression = strings.TrimSpace(t.Schedule.Expression)
	case ScheduleOnce:
		if t.Schedule.RunAt.IsZero() {
			return Task{}, errors.New("agent: a one-shot task needs a run time")
		}
	default:
		return Task{}, fmt.Errorf("agent: unknown schedule kind %q", t.Schedule.Kind)
	}
	if t.Context != nil && t.Context.Scope == ScopeUnread && t.Context.ChatID == 0 {
		c := *t.Context
		c.ChatID = t.ChatID
		t.Context = &c
	}
	return t, nil
}

// NextRun is the next fire strictly after after, or false when the task
// never fires again (a spent one-shot, or a cron with no occurrence).
func (t Task) NextRun(after time.Time) (time.Time, bool) {
	if t.Schedule.Kind == ScheduleOnce {
		return t.Schedule.RunAt, t.Schedule.RunAt.After(after)
	}
	c, err := ParseCron(t.Schedule.Expression)
	if err != nil {
		return time.Time{}, false
	}
	return c.Next(after)
}

// Cron is a five-field cron expression (minute hour day-of-month month
// day-of-week) in the local time zone. Fields take *, numbers, a-b ranges,
// /n steps and comma lists; months and weekdays also take English
// three-letter names; 0 and 7 are Sunday. When both day fields are
// restricted, either matching suffices (Vixie cron).
type Cron struct {
	source                       string
	minutes, hours, doms, months []int
	dows                         []int
	domRestricted, dowRestricted bool
}

var (
	monthNames = map[string]int{"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
	dayNames   = map[string]int{"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}
)

// ParseCron parses a cron expression.
func ParseCron(source string) (Cron, error) {
	f := strings.Fields(source)
	if len(f) != 5 {
		return Cron{}, fmt.Errorf("agent: cron expression needs 5 fields (minute hour day-of-month month day-of-week), got %d", len(f))
	}
	var c Cron
	var err error
	if c.minutes, err = cronField(f[0], 0, 59, nil); err != nil {
		return Cron{}, err
	}
	if c.hours, err = cronField(f[1], 0, 23, nil); err != nil {
		return Cron{}, err
	}
	if c.doms, err = cronField(f[2], 1, 31, nil); err != nil {
		return Cron{}, err
	}
	if c.months, err = cronField(f[3], 1, 12, monthNames); err != nil {
		return Cron{}, err
	}
	dows, err := cronField(f[4], 0, 7, dayNames)
	if err != nil {
		return Cron{}, err
	}
	set := map[int]bool{}
	for _, d := range dows {
		set[d%7] = true
	}
	for d := range set {
		c.dows = append(c.dows, d)
	}
	sort.Ints(c.dows)
	c.domRestricted, c.dowRestricted = f[2] != "*", f[4] != "*"
	c.source = strings.Join(f, " ")
	return c, nil
}

func (c Cron) String() string { return c.source }

func cronValue(raw string, lo, hi int, names map[string]int) (int, error) {
	if v, ok := names[strings.ToLower(raw)]; ok {
		return v, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < lo || v > hi {
		return 0, fmt.Errorf("agent: invalid value %q in cron expression", raw)
	}
	return v, nil
}

func cronField(field string, lo, hi int, names map[string]int) ([]int, error) {
	set := map[int]bool{}
	for _, term := range strings.Split(field, ",") {
		base, stepText, hasStep := strings.Cut(term, "/")
		step := 1
		if hasStep {
			s, err := strconv.Atoi(stepText)
			if err != nil || s < 1 {
				return nil, fmt.Errorf("agent: invalid step %q in cron expression", term)
			}
			step = s
		}
		var from, to int
		switch {
		case base == "*":
			from, to = lo, hi
		case strings.Contains(base, "-"):
			a, b, _ := strings.Cut(base, "-")
			var err error
			if from, err = cronValue(a, lo, hi, names); err != nil {
				return nil, err
			}
			if to, err = cronValue(b, lo, hi, names); err != nil {
				return nil, err
			}
			if from > to {
				return nil, fmt.Errorf("agent: invalid range %q in cron expression", term)
			}
		default:
			v, err := cronValue(base, lo, hi, names)
			if err != nil {
				return nil, err
			}
			from, to = v, v
			if hasStep {
				to = hi
			}
		}
		for v := from; v <= to; v += step {
			set[v] = true
		}
	}
	out := make([]int, 0, len(set))
	for v := range set {
		out = append(out, v)
	}
	sort.Ints(out)
	return out, nil
}

func (c Cron) matchesDay(t time.Time) bool {
	if !c.domRestricted && !c.dowRestricted {
		return true
	}
	dom := slices.Contains(c.doms, t.Day())
	dow := slices.Contains(c.dows, int(t.Weekday()))
	if c.domRestricted && c.dowRestricted {
		return dom || dow
	}
	if c.domRestricted {
		return dom
	}
	return dow
}

// Next is the first fire strictly after after, at minute precision, within
// four years; false when there is none (as "Feb 30").
func (c Cron) Next(after time.Time) (time.Time, bool) {
	t := after.Truncate(time.Minute).Add(time.Minute)
	horizon := after.AddDate(4, 0, 0)
	loc := after.Location()
	for !t.After(horizon) {
		switch {
		case !slices.Contains(c.months, int(t.Month())):
			t = time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, loc)
		case !c.matchesDay(t):
			t = time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, loc)
		case !slices.Contains(c.hours, t.Hour()):
			t = time.Date(t.Year(), t.Month(), t.Day(), t.Hour()+1, 0, 0, 0, loc)
		case !slices.Contains(c.minutes, t.Minute()):
			t = t.Add(time.Minute)
		default:
			return t, true
		}
	}
	return time.Time{}, false
}
