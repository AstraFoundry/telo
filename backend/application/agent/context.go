// Package agent holds the agent's use cases: panel runs over a scoped,
// redacted Telegram payload, message actions, follow-up suggestions, the
// configuration with its vendor sign-in, and automation (trigger rules,
// scheduled tasks and the runner that delivers their answers).
package agent

import (
	"context"
	"fmt"
	"slices"
	"strings"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// ScopeInput chooses the messages a run reads.
type ScopeInput struct {
	Scope domain.Scope
	Chat  tg.ChatID
	// Messages are the selected messages of ScopeSelected.
	Messages []tg.MessageID
	// Folder is the tab of ScopeFolder; 0 is the main list.
	Folder int
}

const pageLimit = 100

func singleLine(s string) string { return strings.Join(strings.Fields(s), " ") }

// payloadBody is a message's text, or its media kind in brackets so the
// preview and the model see the same placeholder.
func payloadBody(m tg.Message) string {
	if m.Body != "" {
		return m.Body
	}
	if m.Media != nil {
		return "[" + string(m.Media.Kind) + "]"
	}
	return ""
}

func scoped(m tg.Message, c tg.Chat) domain.ScopedMessage {
	return domain.ScopedMessage{MessageID: int64(m.ID), ChatID: int64(c.ID), ChatTitle: c.Title, Sender: m.SenderName, Body: payloadBody(m), SentAt: m.SentAt}
}

// Assemble reads and redacts a scope's messages. The preview and the run
// share it, so what the preview shows is what a run at that moment sends.
func Assemble(ctx context.Context, repo tg.Repository, in ScopeInput) (domain.ScopedContext, error) {
	var ms []domain.ScopedMessage
	var err error
	switch in.Scope {
	case domain.ScopeUnread:
		if in.Chat == 0 {
			return domain.ScopedContext{}, fmt.Errorf("agent: scope %q needs a chat", in.Scope)
		}
		ms, err = unreadOf(ctx, repo, in.Chat)
	case domain.ScopeSelected:
		if in.Chat == 0 || len(in.Messages) == 0 {
			return domain.ScopedContext{}, fmt.Errorf("agent: scope %q needs a chat and messages", in.Scope)
		}
		ms, err = selected(ctx, repo, in.Chat, in.Messages)
	case domain.ScopeFolder:
		ms, err = folder(ctx, repo, in.Folder)
	default:
		return domain.ScopedContext{}, fmt.Errorf("agent: unknown scope %q", in.Scope)
	}
	if err != nil {
		return domain.ScopedContext{}, err
	}
	redacted, counts := domain.RedactContext(ms)
	return domain.ScopedContext{Scope: in.Scope, Messages: redacted, Redactions: counts}, nil
}

// unread is the chat's last UnreadCount incoming messages, oldest first:
// Telegram's own count, whatever history the UI loaded.
func unread(ctx context.Context, repo tg.Repository, c tg.Chat) ([]tg.Message, error) {
	if c.UnreadCount == 0 {
		return nil, nil
	}
	var incoming []tg.Message
	var cursor tg.MessageID
	for {
		page, err := repo.Messages(ctx, c.ID, cursor, pageLimit)
		if err != nil {
			return nil, err
		}
		for _, m := range page.Items {
			if !m.Outgoing {
				incoming = append(incoming, m)
			}
		}
		cursor = page.NextCursor
		if cursor == 0 || len(incoming) >= c.UnreadCount {
			break
		}
	}
	incoming = incoming[:min(len(incoming), c.UnreadCount)]
	slices.Reverse(incoming)
	return incoming, nil
}

func unreadOf(ctx context.Context, repo tg.Repository, id tg.ChatID) ([]domain.ScopedMessage, error) {
	c, err := repo.Chat(ctx, id)
	if err != nil {
		return nil, err
	}
	ms, err := unread(ctx, repo, c)
	if err != nil {
		return nil, err
	}
	out := make([]domain.ScopedMessage, len(ms))
	for i, m := range ms {
		out[i] = scoped(m, c)
	}
	return out, nil
}

func selected(ctx context.Context, repo tg.Repository, id tg.ChatID, ids []tg.MessageID) ([]domain.ScopedMessage, error) {
	c, err := repo.Chat(ctx, id)
	if err != nil {
		return nil, err
	}
	found := map[tg.MessageID]tg.Message{}
	var cursor tg.MessageID
	for {
		page, err := repo.Messages(ctx, id, cursor, pageLimit)
		if err != nil {
			return nil, err
		}
		for _, m := range page.Items {
			if slices.Contains(ids, m.ID) {
				found[m.ID] = m
			}
		}
		cursor = page.NextCursor
		if cursor == 0 || len(found) == len(ids) {
			break
		}
	}
	var missing []string
	for _, want := range ids {
		if _, ok := found[want]; !ok {
			missing = append(missing, fmt.Sprint(want))
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("agent: unknown message in chat %d: %s", id, strings.Join(missing, ", "))
	}
	sorted := slices.Clone(ids)
	slices.Sort(sorted)
	out := make([]domain.ScopedMessage, 0, len(sorted))
	for _, want := range sorted {
		out = append(out, scoped(found[want], c))
	}
	return out, nil
}

func allChats(ctx context.Context, repo tg.Repository) ([]tg.Chat, error) {
	var out []tg.Chat
	cursor := ""
	for {
		page, err := repo.ChatPage(ctx, cursor, pageLimit)
		if err != nil {
			return nil, err
		}
		out = append(out, page.Items...)
		if page.NextCursor == "" {
			return out, nil
		}
		cursor = page.NextCursor
	}
}

// folder is the unread messages of a tab's chats: the main list is every
// chat outside the archive.
func folder(ctx context.Context, repo tg.Repository, id int) ([]domain.ScopedMessage, error) {
	chats, err := allChats(ctx, repo)
	if err != nil {
		return nil, err
	}
	var out []domain.ScopedMessage
	for _, c := range chats {
		in := c.FolderID != tg.ArchiveFolderID
		if id != 0 {
			in = c.FolderID == id || slices.Contains(c.FolderIDs, id)
		}
		if !in {
			continue
		}
		ms, err := unread(ctx, repo, c)
		if err != nil {
			return nil, err
		}
		for _, m := range ms {
			out = append(out, scoped(m, c))
		}
	}
	return out, nil
}

// ScopedPrompt is the exact prompt of a scoped run: the redacted payload,
// the citation convention, then the question. A scope with no messages
// sends the question alone.
func ScopedPrompt(prompt string, c domain.ScopedContext) string {
	if len(c.Messages) == 0 {
		return prompt
	}
	titles := map[string]bool{}
	for _, m := range c.Messages {
		titles[m.ChatTitle] = true
	}
	lines := []string{domain.InputOpen}
	current := ""
	for _, m := range c.Messages {
		if len(titles) > 1 && m.ChatTitle != current {
			current = m.ChatTitle
			lines = append(lines, "chat: "+singleLine(m.ChatTitle))
		}
		lines = append(lines, domain.PayloadLine(domain.MessageLink(m.ChatID, m.MessageID), singleLine(m.Sender), singleLine(m.Body)))
	}
	lines = append(lines, domain.InputClose, domain.ReferenceInstruction, "", prompt)
	return strings.Join(lines, "\n")
}
