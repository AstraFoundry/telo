package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Role is who wrote a thread message.
type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

// ThreadMessage is one turn of a conversation.
type ThreadMessage struct {
	ID     string    `json:"id"`
	Role   Role      `json:"role"`
	Body   string    `json:"body"`
	SentAt time.Time `json:"sentAt"`
	// Error marks a body that reports a failed run.
	Error bool `json:"error,omitempty"`
}

// Thread is one conversation of the agent panel.
type Thread struct {
	ID        string          `json:"threadId"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
	Messages  []ThreadMessage `json:"messages"`
}

// ErrEmptyMessage rejects a blank thread message.
var ErrEmptyMessage = errors.New("agent: message body is required")

// NewThread starts an empty conversation.
func NewThread(id string, now time.Time) (Thread, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return Thread{}, errors.New("agent: thread id is required")
	}
	return Thread{ID: id, CreatedAt: now, UpdatedAt: now}, nil
}

// Append returns the thread with m added.
func (t Thread) Append(m ThreadMessage) (Thread, error) {
	m.Body = strings.TrimSpace(m.Body)
	if m.Body == "" {
		return t, ErrEmptyMessage
	}
	t.Messages = append(append([]ThreadMessage(nil), t.Messages...), m)
	t.UpdatedAt = m.SentAt
	return t, nil
}

const titleLength = 60

// Title is the first user message, shortened; empty until the user speaks.
func (t Thread) Title() string {
	for _, m := range t.Messages {
		if m.Role == RoleUser {
			if utf8.RuneCountInString(m.Body) > titleLength {
				return string([]rune(m.Body)[:titleLength]) + "…"
			}
			return m.Body
		}
	}
	return ""
}

// History is the last limit turns of the thread, for the model.
func (t Thread) History(limit int) []ThreadMessage {
	if limit <= 0 {
		return nil
	}
	ms := t.Messages
	if len(ms) > limit {
		ms = ms[len(ms)-limit:]
	}
	return ms
}

// ThreadSummary is a row of the thread list.
type ThreadSummary struct {
	ID        string
	Title     string
	UpdatedAt time.Time
}

// Summary returns the thread's list row.
func (t Thread) Summary() ThreadSummary {
	return ThreadSummary{ID: t.ID, Title: t.Title(), UpdatedAt: t.UpdatedAt}
}

// Scope chooses which Telegram messages a run reads.
type Scope string

const (
	// ScopeSelected is the messages the user pointed at.
	ScopeSelected Scope = "selected"
	// ScopeUnread is the active chat's unread messages.
	ScopeUnread Scope = "unread"
	// ScopeFolder is unread messages across the active folder.
	ScopeFolder Scope = "folder"
)

// ScopedMessage is one redacted message of a run's context: what the
// preview shows is what the model receives.
type ScopedMessage struct {
	MessageID int64
	ChatID    int64
	ChatTitle string
	Sender    string
	Body      string
	SentAt    time.Time
}

// RedactionCounts counts the fields redaction masked.
type RedactionCounts struct {
	Emails int `json:"emails"`
	Phones int `json:"phones"`
	Tokens int `json:"tokens"`
}

// Add sums counts.
func (c RedactionCounts) Add(o RedactionCounts) RedactionCounts {
	return RedactionCounts{c.Emails + o.Emails, c.Phones + o.Phones, c.Tokens + o.Tokens}
}

// ScopedContext is the exact payload of a scoped run.
type ScopedContext struct {
	Scope      Scope
	Messages   []ScopedMessage
	Redactions RedactionCounts
}

// Snapshot is what the UI shows the agent: the active chat, the visible
// chats and messages.
type Snapshot struct {
	ActiveChat      *SnapshotChat
	VisibleChats    []SnapshotChat
	VisibleMessages []SnapshotMessage
}

// SnapshotChat is a chat as the agent sees it.
type SnapshotChat struct {
	ID     int64
	Title  string
	Kind   string
	Unread int
}

// SnapshotMessage is a visible message as the agent sees it.
type SnapshotMessage struct {
	Sender   string
	Body     string
	SentAt   time.Time
	Outgoing bool
}

// Redaction markers.
const (
	RedactedEmail = "[redacted email]"
	RedactedPhone = "[redacted phone]"
	RedactedToken = "[redacted token]"
)

var (
	emailPattern = regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`)
	// A bare digit run must hold 10 digits so dates and ids stay; a "+"
	// prefix marks an international number, where 7 suffice.
	phonePattern = regexp.MustCompile(`\+?[0-9][0-9 ().-]{5,}[0-9]`)
	// API keys with a recognizable vendor prefix; generic high-entropy
	// strings stay, as ids and hashes would false-positive.
	tokenPattern = regexp.MustCompile(`(sk[_-](?:live|test)[_-][A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{16,}|gh[opus]_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{16,}|ya29\.[A-Za-z0-9_-]{10,})`)
)

// Redact masks API keys, emails and phone numbers in text. Keys go first
// so one holding an "@" or a digit run is not half-eaten by the others.
func Redact(text string) (string, RedactionCounts) {
	var c RedactionCounts
	text = tokenPattern.ReplaceAllStringFunc(text, func(string) string { c.Tokens++; return RedactedToken })
	text = emailPattern.ReplaceAllStringFunc(text, func(string) string { c.Emails++; return RedactedEmail })
	text = phonePattern.ReplaceAllStringFunc(text, func(s string) string {
		digits := 0
		for _, r := range s {
			if r >= '0' && r <= '9' {
				digits++
			}
		}
		if (strings.HasPrefix(s, "+") && digits >= 7) || digits >= 10 {
			c.Phones++
			return RedactedPhone
		}
		return s
	})
	return text, c
}

// RedactContext redacts the senders and bodies of a context.
func RedactContext(ms []ScopedMessage) ([]ScopedMessage, RedactionCounts) {
	var total RedactionCounts
	out := make([]ScopedMessage, len(ms))
	for i, m := range ms {
		var a, b RedactionCounts
		m.Sender, a = Redact(m.Sender)
		m.Body, b = Redact(m.Body)
		total = total.Add(a).Add(b)
		out[i] = m
	}
	return out, total
}

// AuditRecord is one run's entry in the local audit log: no prompt, no
// bodies, only the prompt's hash for correlation.
type AuditRecord struct {
	ID         string          `json:"id"`
	Timestamp  time.Time       `json:"timestamp"`
	Action     string          `json:"action"`
	ThreadID   string          `json:"threadId"`
	Scope      Scope           `json:"scope,omitempty"`
	MessageIDs []int64         `json:"messageIds"`
	Redactions RedactionCounts `json:"redactionCounts"`
	Model      string          `json:"model"`
	PromptHash string          `json:"promptHash"`
}

// HashPrompt is the hex SHA-256 of the exact prompt sent.
func HashPrompt(prompt string) string {
	sum := sha256.Sum256([]byte(prompt))
	return hex.EncodeToString(sum[:])
}

// Action markers lead machine-assembled prompts; they are the protocol
// between the use cases that build a prompt and the gateway answering it.
const (
	ActionTranslate  = "[[telo-action:translate]]"
	ActionRewrite    = "[[telo-action:rewrite]]"
	ActionDraftReply = "[[telo-action:draft-reply]]"
	ActionSummarize  = "[[telo-action:summarize]]"
	ActionExtract    = "[[telo-action:extract]]"
	InputOpen        = "[[telo-input]]"
	InputClose       = "[[/telo-input]]"
)

// ReferenceInstruction asks the model to cite and mention by convention.
const ReferenceInstruction = "Cite the source message of every point by pasting its ref link (telo://message/…) at the end of the sentence, as a bare link. Refer to people as @Name, spelled exactly as in the payload."

// PayloadLine formats one scoped message for the model.
func PayloadLine(reference, sender, body string) string {
	return "ref: " + reference + " | " + sender + ": " + body
}

// MessageLink is the in-app link a citation carries.
func MessageLink(chat, message int64) string {
	return "telo://message/" + itoa(chat) + "/" + itoa(message)
}

var messageLink = regexp.MustCompile(`telo://message/(-?\d+)/(\d+)`)

// ParseMessageLink reads a citation link.
func ParseMessageLink(link string) (chat, message int64, ok bool) {
	m := messageLink.FindStringSubmatch(link)
	if m == nil {
		return 0, 0, false
	}
	return atoi(m[1]), atoi(m[2]), true
}
