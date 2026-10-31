// Package copy is the interface's only source of user-facing text. Every
// string is written once in en.copy; keys_gen.go names each by a constant
// (`go run ./cmd/copygen`). A missing key is a defect, never replaced by
// another text.
package copy

import (
	"bufio"
	_ "embed"
	"fmt"
	"strings"
	"time"
)

//go:generate go run ../../../cmd/copygen -src en.copy -out keys_gen.go

// Key names a message of the catalog.
type Key string

//go:embed en.copy
var source string

var messages = parse(source)

func parse(src string) map[Key]string {
	out := map[Key]string{}
	sc := bufio.NewScanner(strings.NewReader(src))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, _ := strings.Cut(line, "=")
		out[Key(strings.TrimSpace(k))] = strings.ReplaceAll(strings.TrimSpace(v), `\n`, "\n")
	}
	return out
}

// T returns a message; an empty key is an absent optional message.
func T(k Key) string {
	if k == "" {
		return ""
	}
	m, ok := messages[k]
	if !ok {
		panic(fmt.Sprintf("copy: missing message %q", k))
	}
	return m
}

// F formats a message with fmt verbs.
func F(k Key, args ...any) string { return fmt.Sprintf(T(k), args...) }

// Plural picks the one or other form by n and formats n into it.
func Plural(n int, one, other Key) string {
	if n == 1 {
		return F(one, n)
	}
	return F(other, n)
}

// Count shortens a large counter as Telegram does: 1.2K, 3.4M.
func Count(n int) string {
	switch {
	case n >= 1_000_000:
		return trimZero(fmt.Sprintf("%.1f", float64(n)/1_000_000)) + "M"
	case n >= 10_000:
		return fmt.Sprintf("%dK", n/1000)
	case n >= 1000:
		return trimZero(fmt.Sprintf("%.1f", float64(n)/1000)) + "K"
	}
	return fmt.Sprint(n)
}

func trimZero(s string) string { return strings.TrimSuffix(s, ".0") }

// Bytes writes a size in binary units.
func Bytes(n int64) string {
	const unit = 1024
	if n < unit {
		return F(SizeBytes, n)
	}
	value, suffix := float64(n), []Key{SizeKB, SizeMB, SizeGB, SizeTB}
	i := -1
	for value >= unit && i < len(suffix)-1 {
		value /= unit
		i++
	}
	return F(suffix[i], value)
}

// Duration writes a media duration as m:ss or h:mm:ss.
func Duration(d time.Duration) string {
	s := int(d.Round(time.Second) / time.Second)
	if s >= 3600 {
		return fmt.Sprintf("%d:%02d:%02d", s/3600, s/60%60, s%60)
	}
	return fmt.Sprintf("%d:%02d", s/60, s%60)
}
