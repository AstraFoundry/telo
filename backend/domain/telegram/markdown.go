package telegram

import (
	"strings"
	"unicode/utf16"
)

// markers are the inline markdown pairs the composer converts on send, as
// telegram-macos does for text typed with them: **bold**, __italic__,
// `monospace`, ~~strikethrough~~ and ||spoiler||. ```pre``` blocks and
// [text](url) links are handled beside them.
var markers = []struct {
	mark string
	kind EntityType
}{
	{"**", EntityBold}, {"__", EntityItalic}, {"~~", EntityStrikethrough}, {"||", EntitySpoiler}, {"`", EntityCode},
}

// ParseMarkdown converts inline markdown in an outgoing text into
// entities, returning the text without the markers. Existing entities
// (from the formatting controls) are shifted with the text. A marker
// without its closing pair stays as typed; markers inside code stay text.
func ParseMarkdown(text string, entities []Entity) (string, []Entity) {
	units := utf16.Encode([]rune(text))
	var out []uint16
	var found []Entity
	// shift maps an input offset to its output offset, for the entities
	// passed in.
	shift := make([]int, len(units)+1)
	i := 0
	for i < len(units) {
		shift[i] = len(out)
		// ```pre```
		if hasAt(units, i, "```") {
			if end := indexFrom(units, i+3, "```"); end > i+3 {
				body := units[i+3 : end]
				lang := ""
				if nl := indexUnit(body, '\n'); nl > 0 && !containsUnit(body[:nl], ' ') {
					lang, body = string(utf16.Decode(body[:nl])), body[nl+1:]
				}
				start := len(out)
				out = append(out, body...)
				found = append(found, Entity{Type: EntityPre, Offset: start, Length: len(body), Language: lang})
				for k := i; k < end+3; k++ {
					shift[k] = start
				}
				i = end + 3
				continue
			}
		}
		// [text](url)
		if units[i] == '[' {
			if close := indexUnitFrom(units, i+1, ']'); close > i+1 && close+1 < len(units) && units[close+1] == '(' {
				if paren := indexUnitFrom(units, close+2, ')'); paren > close+2 {
					url := string(utf16.Decode(units[close+2 : paren]))
					if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") || strings.HasPrefix(url, "tg://") || strings.HasPrefix(url, "mailto:") {
						start := len(out)
						out = append(out, units[i+1:close]...)
						found = append(found, Entity{Type: EntityTextLink, Offset: start, Length: close - i - 1, URL: url})
						for k := i; k <= paren; k++ {
							shift[k] = min(start+max(0, k-i-1), start+close-i-1)
						}
						i = paren + 1
						continue
					}
				}
			}
		}
		matched := false
		for _, m := range markers {
			if !hasAt(units, i, m.mark) {
				continue
			}
			n := len(m.mark)
			end := indexFrom(units, i+n, m.mark)
			if end <= i+n || isSpace(units[i+n]) || isSpace(units[end-1]) {
				continue
			}
			inner := units[i+n : end]
			start := len(out)
			if m.kind == EntityCode {
				out = append(out, inner...)
			} else {
				// Markers nest: parse the inside on its own.
				s, inside := ParseMarkdown(string(utf16.Decode(inner)), nil)
				innerOut := utf16.Encode([]rune(s))
				out = append(out, innerOut...)
				for _, e := range inside {
					e.Offset += start
					found = append(found, e)
				}
				inner = innerOut
			}
			found = append(found, Entity{Type: m.kind, Offset: start, Length: len(inner)})
			for k := i; k < end+n; k++ {
				shift[k] = start
			}
			i = end + n
			matched = true
			break
		}
		if matched {
			continue
		}
		out = append(out, units[i])
		i++
	}
	shift[len(units)] = len(out)
	for _, e := range entities {
		from, to := shift[min(e.Offset, len(units))], shift[min(e.Offset+e.Length, len(units))]
		if to > from {
			e.Offset, e.Length = from, to-from
			found = append(found, e)
		}
	}
	return string(utf16.Decode(out)), found
}

func hasAt(u []uint16, i int, s string) bool {
	if i+len(s) > len(u) {
		return false
	}
	for k := 0; k < len(s); k++ {
		if u[i+k] != uint16(s[k]) {
			return false
		}
	}
	return true
}

func indexFrom(u []uint16, from int, s string) int {
	for i := from; i+len(s) <= len(u); i++ {
		if hasAt(u, i, s) {
			return i
		}
	}
	return -1
}

func indexUnit(u []uint16, c uint16) int { return indexUnitFrom(u, 0, c) }

func indexUnitFrom(u []uint16, from int, c uint16) int {
	for i := from; i < len(u); i++ {
		if u[i] == c {
			return i
		}
	}
	return -1
}

func containsUnit(u []uint16, c uint16) bool { return indexUnit(u, c) >= 0 }

func isSpace(u uint16) bool { return u == ' ' || u == '\n' || u == '\t' }
