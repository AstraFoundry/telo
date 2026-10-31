package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

func object(props map[string]any, required ...string) map[string]any {
	o := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		o["required"] = required
	}
	return o
}

func prop(kind, description string) map[string]any {
	return map[string]any{"type": kind, "description": description}
}

func enum(description string, values ...string) map[string]any {
	return map[string]any{"type": "string", "description": description, "enum": values}
}

func list(kind, description string) map[string]any {
	return map[string]any{"type": "array", "items": map[string]any{"type": kind}, "description": description}
}

// tool wraps a typed handler as a domain tool.
func tool[In any](name, description string, params map[string]any, run func(ctx context.Context, in In) (any, error)) domain.Tool {
	return domain.Tool{Name: name, Description: description, Parameters: params, Run: func(ctx context.Context, args string) (string, error) {
		var in In
		if args != "" {
			if err := json.Unmarshal([]byte(args), &in); err != nil {
				return "", fmt.Errorf("agent: %s arguments: %w", name, err)
			}
		}
		out, err := run(ctx, in)
		if err != nil {
			return "", err
		}
		raw, err := json.Marshal(out)
		return string(raw), err
	}}
}

type chatRow struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Kind     string `json:"kind"`
	Unread   int    `json:"unreadCount"`
	Muted    bool   `json:"muted"`
	FolderID int    `json:"folderId,omitempty"`
}

func row(c tg.Chat) chatRow {
	return chatRow{ID: strconv.FormatInt(int64(c.ID), 10), Title: c.Title, Kind: string(c.Kind), Unread: c.UnreadCount, Muted: c.Muted, FolderID: c.FolderID}
}

type messageRow struct {
	ID       string    `json:"messageId"`
	Sender   string    `json:"senderName"`
	Body     string    `json:"body"`
	SentAt   time.Time `json:"sentAt"`
	Outgoing bool      `json:"outgoing"`
}

// Tool output reaches the provider, so it is redacted like a payload.
func redacted(m tg.Message) messageRow {
	sender, _ := domain.Redact(m.SenderName)
	body, _ := domain.Redact(payloadBody(m))
	return messageRow{ID: strconv.FormatInt(int64(m.ID), 10), Sender: sender, Body: body, SentAt: m.SentAt, Outgoing: m.Outgoing}
}

func chatID(s string) (tg.ChatID, error) {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("agent: chat id %q", s)
	}
	return tg.ChatID(n), nil
}

// tools are what the model may call in a run: the visible workspace when
// the configuration allows it, read-only Telegram, and automation.
// Sending stays with automation's draft-or-send delivery.
func (s *Service) tools(cfg domain.Configuration, snap domain.Snapshot) []domain.Tool {
	var out []domain.Tool
	if cfg.CanInspectWorkspace {
		out = append(out, tool("inspectWorkspace", "Read the currently visible Telo workspace: the active chat, the visible chats and messages.",
			object(map[string]any{"section": enum("Which part to read.", "active-chat", "messages", "chats", "all")}, "section"),
			func(_ context.Context, in struct{ Section string }) (any, error) {
				switch in.Section {
				case "active-chat":
					return snap.ActiveChat, nil
				case "messages":
					return snap.VisibleMessages, nil
				case "chats":
					return snap.VisibleChats, nil
				}
				return snap, nil
			}))
	}
	if repo := s.d.Telegram(); repo != nil {
		out = append(out, telegramTools(repo)...)
	}
	return append(out, s.automationTools()...)
}

func telegramTools(repo tg.Repository) []domain.Tool {
	return []domain.Tool{
		tool("listChats", "List the account's Telegram chats, most recently active first.",
			object(map[string]any{"limit": prop("integer", "Maximum chats to return, 1 to 200; defaults to 50.")}),
			func(ctx context.Context, in struct{ Limit int }) (any, error) {
				limit := in.Limit
				if limit <= 0 || limit > 200 {
					limit = 50
				}
				page, err := repo.ChatPage(ctx, "", limit)
				if err != nil {
					return nil, err
				}
				rows := make([]chatRow, len(page.Items))
				for i, c := range page.Items {
					rows[i] = row(c)
				}
				return rows, nil
			}),
		tool("readChatHistory", "Read the most recent messages of one chat. Emails, phone numbers and API keys are masked.",
			object(map[string]any{"chatId": prop("string", "Chat id from listChats."), "limit": prop("integer", "Maximum messages, 1 to 100; defaults to 30.")}, "chatId"),
			func(ctx context.Context, in struct {
				ChatID string `json:"chatId"`
				Limit  int
			}) (any, error) {
				id, err := chatID(in.ChatID)
				if err != nil {
					return nil, err
				}
				limit := in.Limit
				if limit <= 0 || limit > 100 {
					limit = 30
				}
				page, err := repo.Messages(ctx, id, 0, limit)
				if err != nil {
					return nil, err
				}
				rows := make([]messageRow, len(page.Items))
				for i, m := range page.Items {
					rows[i] = redacted(m)
				}
				return rows, nil
			}),
		tool("searchChatMessages", "Search one chat's history on the server. Returns matching message ids, newest first, and the total count.",
			object(map[string]any{"chatId": prop("string", "Chat id from listChats."), "query": prop("string", "Search term.")}, "chatId", "query"),
			func(ctx context.Context, in struct {
				ChatID string `json:"chatId"`
				Query  string
			}) (any, error) {
				id, err := chatID(in.ChatID)
				if err != nil {
					return nil, err
				}
				page, err := repo.SearchChat(ctx, id, in.Query, 0, 20)
				if err != nil {
					return nil, err
				}
				ids := make([]string, len(page.MessageIDs))
				for i, m := range page.MessageIDs {
					ids[i] = strconv.FormatInt(int64(m), 10)
				}
				return map[string]any{"messageIds": ids, "totalCount": page.TotalCount}, nil
			}),
		tool("searchGlobal", "Search all chats on the server by title or message text; senders and bodies are masked.",
			object(map[string]any{"query": prop("string", "Search term.")}, "query"),
			func(ctx context.Context, in struct{ Query string }) (any, error) {
				res, err := repo.SearchGlobal(ctx, in.Query)
				if err != nil {
					return nil, err
				}
				chats := make([]chatRow, len(res.Chats))
				for i, c := range res.Chats {
					chats[i] = row(c)
				}
				msgs := make([]messageRow, len(res.Messages))
				for i, m := range res.Messages {
					msgs[i] = redacted(m)
				}
				return map[string]any{"chats": chats, "messages": msgs}, nil
			}),
	}
}

type ruleCall struct {
	Action string `json:"action"`
	RuleID string `json:"ruleId"`
	Name   string `json:"name"`
	Match  *struct {
		ChatIDs      []string `json:"chatIds"`
		SenderIDs    []string `json:"senderIds"`
		Keywords     []string `json:"keywords"`
		Pattern      string   `json:"pattern"`
		ExcludeMuted *bool    `json:"excludeMuted"`
	} `json:"match"`
	Delivery       domain.Delivery `json:"delivery"`
	PromptTemplate string          `json:"promptTemplate"`
	Enabled        *bool           `json:"enabled"`
}

type taskCall struct {
	Action   string `json:"action"`
	TaskID   string `json:"taskId"`
	Name     string `json:"name"`
	Schedule *struct {
		Kind       domain.ScheduleKind `json:"kind"`
		Expression string              `json:"expression"`
		RunAt      time.Time           `json:"runAt"`
	} `json:"schedule"`
	Delivery       domain.Delivery `json:"delivery"`
	PromptTemplate string          `json:"promptTemplate"`
	ChatID         string          `json:"chatId"`
	Context        *struct {
		Scope    domain.Scope `json:"scope"`
		ChatID   string       `json:"chatId"`
		FolderID int          `json:"folderId"`
	} `json:"context"`
	Enabled *bool `json:"enabled"`
}

func ids(in []string) ([]int64, error) {
	out := make([]int64, 0, len(in))
	for _, s := range in {
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("agent: id %q", s)
		}
		out = append(out, n)
	}
	return out, nil
}

var actions = []string{"list", "create", "update", "set-enabled", "remove"}

// automationTools manage rules and tasks; what the model sets up is
// authored by the agent and takes effect at once, in plain view of the
// automation panel and the audit log.
func (s *Service) automationTools() []domain.Tool {
	return []domain.Tool{
		tool("configureTriggerRule",
			"Manage trigger rules that start an agent run on incoming Telegram messages. Rules take effect at once and never fire on the account's own messages. "+
				"Match dimensions combine with AND; keywords combine with OR; pattern is a case-insensitive RE2 regular expression. Delivery defaults to draft-only.",
			object(map[string]any{
				"action": enum("What to do.", actions...), "ruleId": prop("string", "Required for update, set-enabled and remove."),
				"name": prop("string", "Required for create."),
				"match": object(map[string]any{"chatIds": list("string", "Only these chats."), "senderIds": list("string", "Only these senders."),
					"keywords": list("string", "Any of these words in the text."), "pattern": prop("string", "Regular expression over the text."),
					"excludeMuted": prop("boolean", "Muted chats never fire.")}),
				"delivery":       enum("How the answer reaches the chat.", string(domain.DeliverAutoSend), string(domain.DeliverDraftOnly)),
				"promptTemplate": prop("string", "Instruction of the run; the message is attached. Required for create."),
				"enabled":        prop("boolean", "Required for set-enabled."),
			}, "action"),
			func(ctx context.Context, in ruleCall) (any, error) {
				switch in.Action {
				case "list":
					return s.Rules(ctx)
				case "remove":
					return map[string]string{"removed": in.RuleID}, s.RemoveRule(ctx, in.RuleID)
				case "set-enabled":
					if in.Enabled == nil {
						return nil, ErrNeedsField
					}
					return s.SetRuleEnabled(ctx, in.RuleID, *in.Enabled)
				}
				r := domain.Rule{Match: domain.RuleMatch{ExcludeMuted: true}}
				if in.Action == "update" {
					old, err := s.rule(ctx, in.RuleID)
					if err != nil {
						return nil, err
					}
					r = old
				}
				if in.Name != "" {
					r.Name = in.Name
				}
				if in.PromptTemplate != "" {
					r.PromptTemplate = in.PromptTemplate
				}
				if in.Delivery != "" {
					r.Delivery = in.Delivery
				}
				if m := in.Match; m != nil {
					chats, err := ids(m.ChatIDs)
					if err != nil {
						return nil, err
					}
					senders, err := ids(m.SenderIDs)
					if err != nil {
						return nil, err
					}
					r.Match = domain.RuleMatch{ChatIDs: chats, SenderIDs: senders, Keywords: m.Keywords, Pattern: m.Pattern, ExcludeMuted: m.ExcludeMuted == nil || *m.ExcludeMuted}
				}
				return s.SaveRule(ctx, r, domain.CreatedByAgent)
			}),
		tool("configureScheduledTask",
			"Manage scheduled tasks that run the agent on a timer and deliver the answer to a chat. The schedule is a five-field cron expression in local time, "+
				"or one future ISO time. Every task needs the chatId it delivers to; delivery defaults to draft-only. The optional context attaches the unread "+
				"messages of a chat or a folder.",
			object(map[string]any{
				"action": enum("What to do.", actions...), "taskId": prop("string", "Required for update, set-enabled and remove."),
				"name": prop("string", "Required for create."),
				"schedule": object(map[string]any{"kind": enum("Recurring or once.", string(domain.ScheduleCron), string(domain.ScheduleOnce)),
					"expression": prop("string", "Cron expression, as \"0 9 * * *\"."), "runAt": prop("string", "ISO time of the single run.")}, "kind"),
				"delivery":       enum("How the answer reaches the chat.", string(domain.DeliverAutoSend), string(domain.DeliverDraftOnly)),
				"promptTemplate": prop("string", "Instruction of the run. Required for create."),
				"chatId":         prop("string", "Chat the answer goes to. Required for create."),
				"context": object(map[string]any{"scope": enum("Which messages to attach.", string(domain.ScopeUnread), string(domain.ScopeFolder)),
					"chatId": prop("string", "Chat of the unread scope; defaults to the delivery chat."), "folderId": prop("integer", "Folder of the folder scope.")}, "scope"),
				"enabled": prop("boolean", "Required for set-enabled."),
			}, "action"),
			func(ctx context.Context, in taskCall) (any, error) {
				switch in.Action {
				case "list":
					return s.Tasks(ctx)
				case "remove":
					return map[string]string{"removed": in.TaskID}, s.RemoveTask(ctx, in.TaskID)
				case "set-enabled":
					if in.Enabled == nil {
						return nil, ErrNeedsField
					}
					return s.SetTaskEnabled(ctx, in.TaskID, *in.Enabled)
				}
				var t domain.Task
				if in.Action == "update" {
					old, err := s.task(ctx, in.TaskID)
					if err != nil {
						return nil, err
					}
					t = old
				}
				if in.Name != "" {
					t.Name = in.Name
				}
				if in.PromptTemplate != "" {
					t.PromptTemplate = in.PromptTemplate
				}
				if in.Delivery != "" {
					t.Delivery = in.Delivery
				}
				if in.Schedule != nil {
					t.Schedule = domain.Schedule{Kind: in.Schedule.Kind, Expression: in.Schedule.Expression, RunAt: in.Schedule.RunAt}
				}
				if in.ChatID != "" {
					id, err := chatID(in.ChatID)
					if err != nil {
						return nil, err
					}
					t.ChatID = int64(id)
				}
				if c := in.Context; c != nil {
					tc := &domain.TaskContext{Scope: c.Scope, FolderID: c.FolderID}
					if c.ChatID != "" {
						id, err := chatID(c.ChatID)
						if err != nil {
							return nil, err
						}
						tc.ChatID = int64(id)
					}
					t.Context = tc
				}
				return s.SaveTask(ctx, t, domain.CreatedByAgent)
			}),
	}
}
