package agent

import "context"

// ConfigurationStore persists the configuration with its secrets.
type ConfigurationStore interface {
	Get(ctx context.Context) (Configuration, error)
	Save(ctx context.Context, c Configuration) error
}

// OAuthClient runs a vendor's desktop OAuth; tokens never reach the UI.
type OAuthClient interface {
	// Configured lists the vendors this build can connect.
	Configured() []Provider
	Authorize(ctx context.Context, p Provider) (OAuthTokens, error)
	Refresh(ctx context.Context, p Provider, t OAuthTokens) (OAuthTokens, error)
}

// ModelCatalog lists a vendor's chat models.
type ModelCatalog interface {
	List(ctx context.Context, c Configuration) ([]Model, error)
}

// ThreadStore persists conversations and the active one.
type ThreadStore interface {
	Threads(ctx context.Context) ([]Thread, error)
	Thread(ctx context.Context, id string) (Thread, bool, error)
	SaveThread(ctx context.Context, t Thread) error
	DeleteThread(ctx context.Context, id string) error
	ActiveThread(ctx context.Context) (string, error)
	SetActiveThread(ctx context.Context, id string) error
}

// AuditLog is the append-only record of what runs sent off-device.
type AuditLog interface {
	Append(ctx context.Context, r AuditRecord) error
	// Recent returns up to limit records, newest first.
	Recent(ctx context.Context, limit int) ([]AuditRecord, error)
}

// RuleStore persists trigger rules in creation order.
type RuleStore interface {
	Rules(ctx context.Context) ([]Rule, error)
	SaveRule(ctx context.Context, r Rule) error
	RemoveRule(ctx context.Context, id string) error
}

// TaskStore persists scheduled tasks in creation order.
type TaskStore interface {
	Tasks(ctx context.Context) ([]Task, error)
	SaveTask(ctx context.Context, t Task) error
	RemoveTask(ctx context.Context, id string) error
}

// OutputKind is a piece of a streamed answer.
type OutputKind int

const (
	OutputText OutputKind = iota
	// OutputActivity names a tool the model is using.
	OutputActivity
	OutputError
)

// Output is one piece of a streamed answer.
type Output struct {
	Kind OutputKind
	Text string
}

// HistoryMessage is a prior turn replayed to the model.
type HistoryMessage struct {
	Role Role
	Body string
}

// Request is one run's input to the gateway.
type Request struct {
	Prompt        string
	History       []HistoryMessage
	Snapshot      Snapshot
	Configuration Configuration
	// Tools are the workspace tools the model may call this run.
	Tools []Tool
}

// Tool is a function the model may call during a run.
type Tool struct {
	Name        string
	Description string
	// Parameters is the JSON Schema of the arguments.
	Parameters map[string]any
	// Run executes a call with JSON arguments and returns JSON.
	Run func(ctx context.Context, arguments string) (string, error)
}

// Gateway streams a model's answer.
type Gateway interface {
	// Stream calls emit for each piece of the answer until done.
	Stream(ctx context.Context, r Request, emit func(Output)) error
	// Suggest proposes up to limit follow-up prompts; it is decorative and
	// returns none rather than an error when it cannot.
	Suggest(ctx context.Context, c Configuration, prompt, reply string, limit int) []string
}
