package agent

import (
	"strconv"
	"strings"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
	"github.com/AstraFoundry/telo/frontend/shared/kit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// block is one paragraph-level piece of an answer.
type block struct {
	kind  string // "p", "h", "li", "quote", "code"
	text  string
	level int
}

// blocks splits Markdown into headings, list items, quotes, fenced code
// and paragraphs; inline formatting is Telegram's own (tg.ParseMarkdown).
func blocks(md string) []block {
	var out []block
	var para, code []string
	inCode := false
	flush := func() {
		if len(para) > 0 {
			out = append(out, block{kind: "p", text: strings.Join(para, " ")})
			para = nil
		}
	}
	for _, line := range strings.Split(md, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			if inCode {
				out = append(out, block{kind: "code", text: strings.Join(code, "\n")})
				code, inCode = nil, false
			} else {
				flush()
				inCode = true
			}
			continue
		}
		if inCode {
			code = append(code, line)
			continue
		}
		switch {
		case trimmed == "":
			flush()
		case strings.HasPrefix(trimmed, "#"):
			flush()
			level := len(trimmed) - len(strings.TrimLeft(trimmed, "#"))
			out = append(out, block{kind: "h", text: strings.TrimSpace(trimmed[level:]), level: level})
		case strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* "):
			flush()
			out = append(out, block{kind: "li", text: trimmed[2:]})
		case strings.HasPrefix(trimmed, "> "):
			flush()
			out = append(out, block{kind: "quote", text: trimmed[2:]})
		default:
			para = append(para, trimmed)
		}
	}
	if inCode {
		out = append(out, block{kind: "code", text: strings.Join(code, "\n")})
	}
	flush()
	return out
}

// cite turns each telo://message link of a text into a numbered chip
// that links to the message: "[1]" in the text, the link behind it.
func cite(text string, n *int) (string, []citation) {
	var out strings.Builder
	var cs []citation
	rest := text
	for {
		i := strings.Index(rest, "telo://message/")
		if i < 0 {
			out.WriteString(rest)
			return out.String(), cs
		}
		end := i
		for end < len(rest) && rest[end] != ' ' && rest[end] != ')' && rest[end] != '\n' {
			end++
		}
		link := strings.TrimRight(rest[i:end], ".,;")
		out.WriteString(rest[:i])
		if _, _, ok := domain.ParseMessageLink(link); ok {
			*n++
			label := "[" + strconv.Itoa(*n) + "]"
			cs = append(cs, citation{label: label, link: link})
			out.WriteString(label)
		} else {
			out.WriteString(link)
		}
		rest = rest[i+len(link):]
	}
}

type citation struct {
	label, link string
}

// citationEntities links the chips cite placed in body.
func citationEntities(body string, cs []citation) []tg.Entity {
	var out []tg.Entity
	from := 0
	for _, c := range cs {
		i := strings.Index(body[from:], c.label)
		if i < 0 {
			continue
		}
		at := from + i
		out = append(out, tg.Entity{Type: tg.EntityTextLink, Offset: tg.UTF16Len(body[:at]), Length: tg.UTF16Len(c.label), URL: c.link})
		from = at + len(c.label)
	}
	return out
}

// markdown draws an answer.
func markdown(c *ui.Context, t theme.Tokens, md string, size float32, onLink func(string)) {
	ui.Column(c).Gap(6).Children(func() {
		n := 0
		for i, b := range blocks(md) {
			text := b.text
			var cs []citation
			if b.kind != "code" {
				text, cs = cite(text, &n)
			}
			body, ents := tg.ParseMarkdown(text, nil)
			ents = append(ents, citationEntities(body, cs)...)
			style := kit.RichStyle{Size: size, Ink: t.Text, LinkInk: t.AccentInk, CodeFill: t.Subtle, OnLink: onLink}
			switch b.kind {
			case "h":
				style.Size = size + 3 - float32(min(b.level, 3))
				ui.Box(c.Key(i)).Children(func() { kit.RichBody(c, t, body, ents, style).FontWeight(700) })
			case "li":
				ui.Row(c.Key(i)).Gap(6).Children(func() {
					ui.Text(c, "•").FontSize(size).TextColor(t.Muted)
					kit.RichBody(c, t, body, ents, style).Grow(1).Shrink(1)
				})
			case "quote":
				ui.Row(c.Key(i)).Gap(8).Children(func() {
					ui.Box(c).Width(3).Radius(1.5).Background(t.Faint)
					style.Ink = t.Muted
					kit.RichBody(c, t, body, ents, style).Grow(1).Shrink(1)
				})
			case "code":
				ui.Box(c.Key(i)).Padding(8, 10).Radius(theme.RadiusMD).Background(t.Subtle).Children(func() {
					ui.Text(c, b.text).Font("monospace").FontSize(size - 1).Selectable()
				})
			default:
				ui.Box(c.Key(i)).Children(func() { kit.RichBody(c, t, body, ents, style) })
			}
		}
	})
}
