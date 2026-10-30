package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"sync"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
	"github.com/AstraFoundry/telo/backend/infrastructure/storage"
)

// ConfigurationFile keeps the configuration sealed with a keychain key:
// it holds the API key and the vendor session.
type ConfigurationFile struct {
	File *storage.Sealed[domain.Configuration]
}

func (f ConfigurationFile) Get(context.Context) (domain.Configuration, error) {
	c := domain.DefaultConfiguration()
	if _, err := f.File.Load(&c); err != nil {
		return domain.Configuration{}, err
	}
	return c, nil
}

func (f ConfigurationFile) Save(_ context.Context, c domain.Configuration) error {
	return f.File.Save(c)
}

type threadFile struct {
	Threads []domain.Thread `json:"threads"`
	Active  string          `json:"activeThreadId"`
}

// ThreadFile keeps the conversations, sealed: they quote the chats.
type ThreadFile struct {
	File *storage.Sealed[threadFile]
	mu   sync.Mutex
}

func (f *ThreadFile) load() (threadFile, error) {
	var t threadFile
	_, err := f.File.Load(&t)
	return t, err
}

func (f *ThreadFile) Threads(context.Context) ([]domain.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	t, err := f.load()
	return t.Threads, err
}

func (f *ThreadFile) Thread(_ context.Context, id string) (domain.Thread, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	t, err := f.load()
	if err != nil {
		return domain.Thread{}, false, err
	}
	i := slices.IndexFunc(t.Threads, func(x domain.Thread) bool { return x.ID == id })
	if i < 0 {
		return domain.Thread{}, false, nil
	}
	return t.Threads[i], true, nil
}

func (f *ThreadFile) SaveThread(_ context.Context, th domain.Thread) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	t, err := f.load()
	if err != nil {
		return err
	}
	if i := slices.IndexFunc(t.Threads, func(x domain.Thread) bool { return x.ID == th.ID }); i >= 0 {
		t.Threads[i] = th
	} else {
		t.Threads = append(t.Threads, th)
	}
	return f.File.Save(t)
}

func (f *ThreadFile) DeleteThread(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	t, err := f.load()
	if err != nil {
		return err
	}
	t.Threads = slices.DeleteFunc(t.Threads, func(x domain.Thread) bool { return x.ID == id })
	if t.Active == id {
		t.Active = ""
	}
	return f.File.Save(t)
}

func (f *ThreadFile) ActiveThread(context.Context) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	t, err := f.load()
	return t.Active, err
}

func (f *ThreadFile) SetActiveThread(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	t, err := f.load()
	if err != nil {
		return err
	}
	t.Active = id
	return f.File.Save(t)
}

// AuditFile is the append-only JSON-lines audit log. It holds no prompt
// and no message text, so it is not sealed.
type AuditFile struct{ Path string }

func (f AuditFile) Append(_ context.Context, r domain.AuditRecord) error {
	return storage.AppendLine(f.Path, r)
}

func (f AuditFile) Recent(_ context.Context, limit int) ([]domain.AuditRecord, error) {
	file, err := os.Open(f.Path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var all []domain.AuditRecord
	sc := bufio.NewScanner(file)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		var r domain.AuditRecord
		if err := json.Unmarshal(sc.Bytes(), &r); err != nil {
			return nil, err
		}
		all = append(all, r)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	slices.Reverse(all)
	return all[:min(len(all), limit)], nil
}

// RuleFile keeps the trigger rules, sealed: their prompts and keywords
// can name people.
type RuleFile struct {
	File *storage.Sealed[[]domain.Rule]
	mu   sync.Mutex
}

func (f *RuleFile) Rules(context.Context) ([]domain.Rule, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var rs []domain.Rule
	if _, err := f.File.Load(&rs); err != nil {
		return nil, err
	}
	// Rebuilding compiles each pattern; a stored rule is valid by
	// construction, so a failure here is a damaged file.
	for i, r := range rs {
		valid, err := domain.NewRule(r)
		if err != nil {
			return nil, err
		}
		rs[i] = valid
	}
	return rs, nil
}

func (f *RuleFile) SaveRule(ctx context.Context, r domain.Rule) error {
	rs, err := f.Rules(ctx)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if i := slices.IndexFunc(rs, func(x domain.Rule) bool { return x.ID == r.ID }); i >= 0 {
		rs[i] = r
	} else {
		rs = append(rs, r)
	}
	return f.File.Save(rs)
}

func (f *RuleFile) RemoveRule(ctx context.Context, id string) error {
	rs, err := f.Rules(ctx)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.File.Save(slices.DeleteFunc(rs, func(x domain.Rule) bool { return x.ID == id }))
}

// TaskFile keeps the scheduled tasks, sealed like the rules.
type TaskFile struct {
	File *storage.Sealed[[]domain.Task]
	mu   sync.Mutex
}

func (f *TaskFile) Tasks(context.Context) ([]domain.Task, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var ts []domain.Task
	_, err := f.File.Load(&ts)
	return ts, err
}

func (f *TaskFile) SaveTask(ctx context.Context, t domain.Task) error {
	ts, err := f.Tasks(ctx)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if i := slices.IndexFunc(ts, func(x domain.Task) bool { return x.ID == t.ID }); i >= 0 {
		ts[i] = t
	} else {
		ts = append(ts, t)
	}
	return f.File.Save(ts)
}

func (f *TaskFile) RemoveTask(ctx context.Context, id string) error {
	ts, err := f.Tasks(ctx)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.File.Save(slices.DeleteFunc(ts, func(x domain.Task) bool { return x.ID == id }))
}

var (
	_ domain.ConfigurationStore = ConfigurationFile{}
	_ domain.ThreadStore        = (*ThreadFile)(nil)
	_ domain.AuditLog           = AuditFile{}
	_ domain.RuleStore          = (*RuleFile)(nil)
	_ domain.TaskStore          = (*TaskFile)(nil)
)

// Files are the agent's stores in one directory, sealed with keys from
// the credential store.
type Files struct {
	Configuration ConfigurationFile
	Threads       *ThreadFile
	Audits        AuditFile
	Rules         *RuleFile
	Tasks         *TaskFile
}

// OpenFiles lays the stores out under dir.
func OpenFiles(dir string, keys storage.KeySource) Files {
	p := func(name string) string { return filepath.Join(dir, name) }
	return Files{
		Configuration: ConfigurationFile{File: &storage.Sealed[domain.Configuration]{Path: p("agent-configuration.sealed"), Keys: keys, KeyName: "agent-configuration"}},
		Threads:       &ThreadFile{File: &storage.Sealed[threadFile]{Path: p("agent-threads.sealed"), Keys: keys, KeyName: "agent-threads"}},
		Audits:        AuditFile{Path: p("agent-audit.jsonl")},
		Rules:         &RuleFile{File: &storage.Sealed[[]domain.Rule]{Path: p("agent-rules.sealed"), Keys: keys, KeyName: "agent-rules"}},
		Tasks:         &TaskFile{File: &storage.Sealed[[]domain.Task]{Path: p("agent-tasks.sealed"), Keys: keys, KeyName: "agent-tasks"}},
	}
}
