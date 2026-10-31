package kit

import (
	"slices"
	"strings"
	"unicode/utf16"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// span is a run of a message body with one set of formatting.
type Span struct {
	text      string
	bold      bool
	italic    bool
	underline bool
	strike    bool
	code      bool
	pre       bool
	spoiler   bool
	quote     bool
	// link is where a click goes: a URL, "@name", "#tag", "/cmd" or
	// "mailto:"/"tel:".
	link string
	// emoji is a custom emoji's id, drawn as its fallback character.
	emoji int64
}

// Spans splits a body at its entities' UTF-16 boundaries into styled
// runs. Malformed ranges were dropped by the domain already.
func Spans(body string, entities []tg.Entity) []Span {
	units := utf16.Encode([]rune(body))
	cuts := []int{0, len(units)}
	for _, e := range entities {
		cuts = append(cuts, e.Offset, min(len(units), e.Offset+e.Length))
	}
	slices.Sort(cuts)
	cuts = slices.Compact(cuts)
	var out []Span
	for i := 0; i+1 < len(cuts); i++ {
		from, to := cuts[i], cuts[i+1]
		if from >= to || from >= len(units) {
			continue
		}
		s := Span{text: string(utf16.Decode(units[from:to]))}
		for _, e := range entities {
			if e.Offset > from || e.Offset+e.Length < to {
				continue
			}
			switch e.Type {
			case tg.EntityBold:
				s.bold = true
			case tg.EntityItalic:
				s.italic = true
			case tg.EntityUnderline:
				s.underline = true
			case tg.EntityStrikethrough:
				s.strike = true
			case tg.EntityCode:
				s.code = true
			case tg.EntityPre:
				s.pre = true
			case tg.EntitySpoiler:
				s.spoiler = true
			case tg.EntityBlockquote:
				s.quote = true
			case tg.EntityTextLink:
				s.link = e.URL
			case tg.EntityURL:
				s.link = s.text
				if !strings.Contains(s.link, "://") {
					s.link = "https://" + s.link
				}
			case tg.EntityEmail:
				s.link = "mailto:" + s.text
			case tg.EntityPhone:
				s.link = "tel:" + s.text
			case tg.EntityMention, tg.EntityHashtag, tg.EntityCashtag, tg.EntityBotCommand:
				s.link = s.text
			case tg.EntityTextMention:
				s.link = "user:" + itoa(int64(e.UserID))
			case tg.EntityCustomEmoji:
				s.emoji = e.CustomEmojiID
			}
		}
		out = append(out, s)
	}
	return out
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var b [20]byte
	i := len(b)
	for v > 0 {
		i--
		b[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// RichStyle is how a message body is drawn.
type RichStyle struct {
	Size     float32
	Ink      ui.Color
	LinkInk  ui.Color
	CodeFill ui.Color
	// Revealed tells whether the spoilers were clicked open.
	Revealed *bool
	OnLink   func(link string)
}

// RichBody draws a message body with its entities.
func RichBody(c *ui.Context, t theme.Tokens, body string, entities []tg.Entity, st RichStyle) ui.Element {
	spans := Spans(body, entities)
	para := ui.RichText(c).FontSize(st.Size).LineHeight(1.3125).TextColor(st.Ink)
	para.Children(func() {
		for i, s := range spans {
			el := ui.Text(c.Key(i), s.text)
			if s.bold {
				el.FontWeight(600)
			}
			if s.italic {
				el.Italic()
			}
			if s.underline {
				el.Underline()
			}
			if s.strike {
				el.Strikethrough()
			}
			if s.code || s.pre {
				el.Font("monospace").TextBackground(st.CodeFill).FontSize(st.Size - 1)
			}
			if s.quote {
				el.Italic().TextColor(st.Ink.Alpha(0.85))
			}
			if s.spoiler && (st.Revealed == nil || !*st.Revealed) {
				el.TextColor(ui.Transparent).TextBackground(st.Ink.Alpha(0.35))
				if el.Clicked() && st.Revealed != nil {
					*st.Revealed = true
				}
				continue
			}
			if s.link != "" {
				el.TextColor(st.LinkInk)
				if strings.HasPrefix(s.link, "http") {
					el.Underline().DecorationColor(st.LinkInk.Alpha(0.4))
				}
				link := s.link
				if el.Clicked() && st.OnLink != nil {
					st.OnLink(link)
				}
				el.Cursor(ui.CursorPointer)
			}
		}
	})
	return para
}
