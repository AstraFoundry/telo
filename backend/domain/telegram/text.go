package telegram

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf16"

	"github.com/rivo/uniseg"
)

// IsolatedEmojiLimit caps the emoji-only messages drawn large, as both
// reference clients cap them.
const IsolatedEmojiLimit = 3

// IsolatedEmojiCount counts the emoji of a text made only of emoji (1–3),
// or returns 0. A cluster counts when it carries a pictograph, a flag half
// or a keycap mark; a lone digit or # is not emoji.
func IsolatedEmojiCount(text string) int {
	if text == "" {
		return 0
	}
	count := 0
	g := uniseg.NewGraphemes(text)
	for g.Next() {
		runes := g.Runes()
		pictured := false
		for _, r := range runes {
			switch {
			case pictographic(r) || regionalIndicator(r) || r == 0x20e3:
				pictured = true
			case emojiComponent(r):
			default:
				return 0
			}
		}
		if !pictured {
			return 0
		}
		count++
		if count > IsolatedEmojiLimit {
			return 0
		}
	}
	return count
}

func regionalIndicator(r rune) bool { return r >= 0x1f1e6 && r <= 0x1f1ff }

// emojiComponent are the code points that join or qualify emoji: variation
// selectors, the zero-width joiner, skin tones, tag characters and keycap
// bases.
func emojiComponent(r rune) bool {
	switch {
	case r == 0xfe0e || r == 0xfe0f || r == 0x200d:
		return true
	case r >= 0x1f3fb && r <= 0x1f3ff:
		return true
	case r >= 0xe0020 && r <= 0xe007f:
		return true
	case r >= '0' && r <= '9', r == '#', r == '*':
		return true
	}
	return false
}

// pictographic approximates Unicode's Extended_Pictographic property with
// the blocks that hold it.
func pictographic(r rune) bool {
	switch {
	case r == 0xa9 || r == 0xae || r == 0x203c || r == 0x2049 || r == 0x2122 || r == 0x2139:
		return true
	case r >= 0x2194 && r <= 0x21aa:
		return true
	case r >= 0x231a && r <= 0x23ff:
		return true
	case r == 0x24c2 || (r >= 0x25aa && r <= 0x25fe):
		return true
	case r >= 0x2600 && r <= 0x27bf:
		return true
	case r >= 0x2934 && r <= 0x2935:
		return true
	case r >= 0x2b05 && r <= 0x2b55:
		return true
	case r == 0x3030 || r == 0x303d || r == 0x3297 || r == 0x3299:
		return true
	case r >= 0x1f000 && r <= 0x1f1e5:
		return true
	case r >= 0x1f200 && r <= 0x1f3fa:
		return true
	case r >= 0x1f400 && r <= 0x1faff:
		return true
	}
	return false
}

// UTF16Len is a text's length in UTF-16 code units, Telegram's unit for
// entity offsets.
func UTF16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// UTF16Slice returns the part of s between UTF-16 offsets from and to.
func UTF16Slice(s string, from, to int) string {
	units := utf16.Encode([]rune(s))
	from = max(0, min(from, len(units)))
	to = max(from, min(to, len(units)))
	return string(utf16.Decode(units[from:to]))
}

// TrimOutgoing trims surrounding whitespace from an outgoing message and
// moves its entities with it, dropping spans that fall in the trimmed
// part.
func TrimOutgoing(body string, entities []Entity) (string, []Entity) {
	trimmed := strings.TrimSpace(body)
	if trimmed == body || len(entities) == 0 {
		return trimmed, entities
	}
	lead := UTF16Len(body) - UTF16Len(strings.TrimLeftFunc(body, unicode.IsSpace))
	end := lead + UTF16Len(trimmed)
	var out []Entity
	for _, e := range entities {
		from, to := max(e.Offset, lead), min(e.Offset+e.Length, end)
		if to <= from {
			continue
		}
		e.Offset, e.Length = from-lead, to-from
		out = append(out, e)
	}
	return trimmed, out
}

// ValidEntities keeps the spans that fit the body, so a malformed range
// renders as plain text instead of failing the message.
func ValidEntities(body string, entities []Entity) []Entity {
	n := UTF16Len(body)
	out := entities[:0:0]
	for _, e := range entities {
		if e.Offset >= 0 && e.Length > 0 && e.Offset+e.Length <= n {
			out = append(out, e)
		}
	}
	return out
}

// Initials are the first letters of a title's first two words, or its
// first grapheme when it has no letters.
func Initials(title string) string {
	var out []string
	for _, word := range strings.Fields(title) {
		for _, r := range word {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				out = append(out, strings.ToUpper(string(r)))
			}
			break
		}
		if len(out) == 2 {
			break
		}
	}
	if len(out) == 0 {
		return FirstGrapheme(title)
	}
	return strings.Join(out, "")
}

// FirstGrapheme is a text's first user-perceived character.
func FirstGrapheme(s string) string {
	g := uniseg.NewGraphemes(strings.TrimSpace(s))
	if g.Next() {
		return strings.ToUpper(g.Str())
	}
	return ""
}

// Errors the repository returns for rules a chat enforces.
var (
	ErrCannotWrite    = errors.New("telegram: the account can't write to this chat")
	ErrCannotStickers = errors.New("telegram: the account can't send stickers to this chat")
	ErrCannotMedia    = errors.New("telegram: the account can't send media to this chat")
	ErrNotFound       = errors.New("telegram: not found")
	ErrPending        = errors.New("telegram: the message is still being sent")
	ErrTooManyFiles   = errors.New("telegram: an album holds at most 10 files")
	ErrFileTooLarge   = errors.New("telegram: the file is larger than 2 GB")
	ErrAccountLimit   = errors.New("telegram: three accounts are signed in")
	ErrNotConfigured  = errors.New("telegram: this build has no Telegram API credentials")
)

// RequireSend returns the error for content the chat forbids, or nil.
func RequireSend(c Chat, kind ContentKind) error {
	if c.CanSend(kind) {
		return nil
	}
	switch kind {
	case ContentStickers:
		return ErrCannotStickers
	case ContentMedia:
		return ErrCannotMedia
	}
	return ErrCannotWrite
}
