package conversation

import (
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/entities/chat"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// row is one line of the transcript: a day separator, the unread divider,
// a message, or an album of messages.
type row struct {
	key     any
	day     time.Time
	unread  bool
	message *tg.Message
	album   []tg.Message
	// first and last tell where the message sits in a run by one author,
	// which shapes its corners and places the name and the avatar.
	first, last bool
}

// runGap is how close in time consecutive messages by one author must be
// to group, as Telegram groups them.
const runGap = 5 * time.Minute

func sameRun(a, b tg.Message) bool {
	return a.SenderID == b.SenderID && a.Outgoing == b.Outgoing && a.Service == tg.ServiceNone && b.Service == tg.ServiceNone &&
		b.SentAt.Sub(a.SentAt) < runGap && sameDay(a.SentAt, b.SentAt) && a.Forward == nil && b.Forward == nil
}

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.Local().Date()
	by, bm, bd := b.Local().Date()
	return ay == by && am == bm && ad == bd
}

// buildRows flattens a transcript into rows.
func buildRows(p Props, t *chat.Transcript) []row {
	ch, _ := p.Store.Chat(p.Store.Selected)
	var rows []row
	ms := t.Messages
	unreadPlaced := false
	for i := 0; i < len(ms); i++ {
		m := ms[i]
		if i == 0 || !sameDay(ms[i-1].SentAt, m.SentAt) {
			d := m.SentAt.Local()
			rows = append(rows, row{key: "d" + d.Format("20060102"), day: d})
		}
		if !unreadPlaced && ch.UnreadCount > 0 && ch.LastReadMessageID > 0 && !m.Outgoing && m.ID > ch.LastReadMessageID && !m.Pending() {
			rows = append(rows, row{key: "unread", unread: true})
			unreadPlaced = true
		}
		r := row{key: m.ID}
		if m.AlbumID != 0 {
			j := i
			for j+1 < len(ms) && ms[j+1].AlbumID == m.AlbumID {
				j++
			}
			r.album = ms[i : j+1]
			i = j
		}
		msg := ms[i]
		r.message = &msg
		if r.album != nil {
			first := r.album[0]
			r.message = &first
		}
		head := *r.message
		r.first = len(rows) == 0 || rows[len(rows)-1].message == nil || !sameRun(*rows[len(rows)-1].message, head)
		if !r.first {
			rows[len(rows)-1].last = false
		}
		r.last = true
		rows = append(rows, r)
	}
	return rows
}

// transcript draws the messages, pages older ones near the top, marks the
// shown ones read and fetches the media that downloads on its own.
func (v *View) transcript(c *ui.Context, p Props, ch tg.Chat) {
	t, s := p.Tokens, p.Store
	tr := s.Transcript(ch.ID)
	rows := buildRows(p, tr)
	v.list.Key = func(i int) any {
		if i < len(rows) {
			return rows[i].key
		}
		return i
	}
	var shown []tg.MessageID
	list := ui.List(c.Key("transcript"), &v.list, len(rows), func(i int) {
		r := rows[i]
		switch {
		case !r.day.IsZero():
			daySeparator(c, t, p.Formats.Day(r.day, p.Runtime.Clock()))
		case r.unread:
			unreadDivider(c, t)
		default:
			v.messageRow(c, p, ch, r)
			shown = append(shown, r.message.ID)
			for _, a := range r.album {
				shown = append(shown, a.ID)
			}
		}
	}).Grow(1).Justify(ui.End).Padding(10, 16, 12, 16).Label(copy.T(copy.MessageActions))
	list.Children(func() {
		if tr.Loading && len(rows) == 0 {
			ui.Row(c).Grow(1).Justify(ui.Center).AlignItems(ui.Center).Children(func() { ui.Spinner(c) })
		}
	})
	if first, _ := v.list.Visible(); first < 6 && !tr.Exhausted && tr.Loaded {
		s.LoadOlder(ch.ID)
	}
	var unseen []tg.MessageID
	for _, id := range shown {
		if id > ch.LastReadMessageID && !v.viewed[id] && id > 0 {
			v.viewed[id] = true
			unseen = append(unseen, id)
		}
	}
	if len(unseen) > 0 && p.Runtime.Desktop.Focused() {
		s.View(ch.ID, unseen)
	} else if len(unseen) > 0 {
		for _, id := range unseen {
			delete(v.viewed, id)
		}
	}
}

func daySeparator(c *ui.Context, t theme.Tokens, text string) {
	ui.Row(c).Padding(8, 0).Justify(ui.Center).Children(func() {
		ui.Row(c).Padding(3, 10).Radius(theme.RadiusPill).Background(t.Card.Alpha(0.86)).Border(1, t.Hairline).Children(func() {
			ui.Text(c, text).FontSize(theme.Caption + 1).FontWeight(600).TextColor(t.Muted)
		})
	})
}

func unreadDivider(c *ui.Context, t theme.Tokens) {
	ui.Row(c).Margin(6, -16).Padding(4, 0).Justify(ui.Center).Background(t.Card.Alpha(0.7)).Children(func() {
		ui.Text(c, copy.T(copy.UnreadMessages)).FontSize(theme.Caption + 1).FontWeight(600).TextColor(t.AccentInk)
	})
}
