package chat

import (
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// Composer is a chat's unsent state: the text, what it answers or edits,
// staged files and the messages picked for a batch action.
type Composer struct {
	Text     string
	Entities []tg.Entity
	ReplyTo  tg.MessageID
	// Quote is the part of the replied message the reply quotes.
	Quote   string
	Editing tg.MessageID
	Files   []tg.UploadFile
	// Selected are messages picked for forwarding or deleting.
	Selected map[tg.MessageID]bool
	// Restored is set once the server draft was loaded into Text.
	Restored bool
}

// Composer returns a chat's composer state, creating it.
func (s *Store) Composer(id tg.ChatID) *Composer {
	if s.composers == nil {
		s.composers = map[tg.ChatID]*Composer{}
	}
	cp, ok := s.composers[id]
	if !ok {
		cp = &Composer{Selected: map[tg.MessageID]bool{}}
		s.composers[id] = cp
	}
	return cp
}

// Reply targets a message for the next send.
func (s *Store) Reply(id tg.ChatID, message tg.MessageID, quote string) {
	cp := s.Composer(id)
	cp.Editing, cp.ReplyTo, cp.Quote = 0, message, quote
}

// StartEdit loads an outgoing message into the composer.
func (s *Store) StartEdit(id tg.ChatID, message tg.MessageID) bool {
	m, ok := s.Transcript(id).Message(message)
	if !ok || !m.Outgoing || m.Pending() {
		return false
	}
	cp := s.Composer(id)
	cp.Editing, cp.ReplyTo, cp.Text, cp.Entities = message, 0, m.Body, m.Entities
	return true
}

// CancelTarget drops the reply or edit target; cancelling an edit clears
// the text it loaded.
func (s *Store) CancelTarget(id tg.ChatID) {
	cp := s.Composer(id)
	if cp.Editing != 0 {
		cp.Text, cp.Entities = "", nil
	}
	cp.Editing, cp.ReplyTo, cp.Quote = 0, 0, ""
}

// LastOutgoing is the newest message the account can edit, for ↑.
func (s *Store) LastOutgoing(id tg.ChatID) (tg.Message, bool) {
	t := s.Transcript(id)
	for i := len(t.Messages) - 1; i >= 0; i-- {
		m := t.Messages[i]
		if m.Outgoing && !m.Pending() && m.Service == tg.ServiceNone && m.Poll == nil && m.Call == nil {
			return m, true
		}
	}
	return tg.Message{}, false
}

// ReplyStep moves the reply target to the previous (-1) or next (1)
// message, as ⌘↑ and ⌘↓ do; past the newest it clears the target.
func (s *Store) ReplyStep(id tg.ChatID, step int) {
	t := s.Transcript(id)
	cp := s.Composer(id)
	var ids []tg.MessageID
	for _, m := range t.Messages {
		if !m.Pending() && m.Service == tg.ServiceNone {
			ids = append(ids, m.ID)
		}
	}
	if len(ids) == 0 {
		return
	}
	i := len(ids)
	for k, mid := range ids {
		if mid == cp.ReplyTo {
			i = k
		}
	}
	i += step
	switch {
	case i < 0:
		i = 0
	case i >= len(ids):
		cp.ReplyTo, cp.Quote = 0, ""
		return
	}
	cp.Editing, cp.ReplyTo, cp.Quote = 0, ids[i], ""
}

// ToggleSelected picks or unpicks a message for a batch action.
func (s *Store) ToggleSelected(id tg.ChatID, message tg.MessageID) {
	cp := s.Composer(id)
	if cp.Selected[message] {
		delete(cp.Selected, message)
	} else {
		cp.Selected[message] = true
	}
}

// SelectedIDs returns the picked messages in transcript order.
func (s *Store) SelectedIDs(id tg.ChatID) []tg.MessageID {
	cp := s.Composer(id)
	var out []tg.MessageID
	for _, m := range s.Transcript(id).Messages {
		if cp.Selected[m.ID] {
			out = append(out, m.ID)
		}
	}
	return out
}
