package agent

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
)

// Demo is the network-free gateway of the demo workspace and the tests:
// the answer follows from the prompt alone, so tests assert exact text.
type Demo struct{}

var (
	tonePattern = regexp.MustCompile(`\[\[telo-tone:([^\]]+)\]\]`)
	refPattern  = regexp.MustCompile(`(?m)^ref: (\S+) \| ([^:]+): `)
)

// DemoMarkdownPrompt asks the demo for its Markdown sample.
const DemoMarkdownPrompt = "Show the Markdown demo."

// DemoMarkdownReply exercises every block the panel renders.
var DemoMarkdownReply = strings.Join([]string{"## Markdown preview", "", "**Streaming is ready.**", "", "- First item", "- Second item", "",
	"> Safe blockquote", "", "```go", "ready := true", "```", "", "[Open the documentation](https://example.com/docs)"}, "\n")

// DemoSuggestions are the demo's follow-ups.
var DemoSuggestions = []string{"What should I reply?", "Who is waiting on me?", "Turn this into a checklist"}

func payload(prompt string) string {
	start, end := strings.Index(prompt, domain.InputOpen), strings.Index(prompt, domain.InputClose)
	if start < 0 || end <= start {
		return ""
	}
	return strings.TrimSpace(prompt[start+len(domain.InputOpen) : end])
}

// DemoReply is the demo's answer to a prompt.
func DemoReply(prompt string) string {
	body := payload(prompt)
	switch {
	case strings.Contains(prompt, DemoMarkdownPrompt):
		return DemoMarkdownReply
	case strings.Contains(prompt, domain.ActionTranslate):
		return "Demo translation: " + body
	case strings.Contains(prompt, domain.ActionRewrite):
		return "Demo rewrite: " + body
	case strings.Contains(prompt, domain.ActionDraftReply):
		tone := "neutral"
		if m := tonePattern.FindStringSubmatch(prompt); m != nil {
			tone = m[1]
		}
		return fmt.Sprintf("Demo %s reply: %s", tone, body)
	case strings.Contains(prompt, domain.ActionSummarize), strings.Contains(prompt, domain.ActionExtract):
		refs := refPattern.FindAllStringSubmatch(prompt, -1)
		lines := []string{fmt.Sprintf("Demo summary of %d messages.", len(refs))}
		for _, r := range refs {
			lines = append(lines, fmt.Sprintf("- @%s weighed in. %s", r[2], r[1]))
		}
		return strings.Join(lines, "\n")
	}
	r := []rune(prompt)
	return "Demo agent response: " + string(r[:min(len(r), 80)])
}

func (Demo) Stream(_ context.Context, r domain.Request, emit func(domain.Output)) error {
	reply := DemoReply(r.Prompt)
	// Longer answers arrive in pieces, so the panel's streaming shows.
	parts := 1
	switch {
	case len(reply) > 60:
		parts = 3
	case len(reply) > 20:
		parts = 2
	}
	size := (len(reply) + parts - 1) / parts
	for i := 0; i < len(reply); {
		end := min(len(reply), i+size)
		for end < len(reply) && !utf8Start(reply[end]) {
			end++
		}
		emit(domain.Output{Kind: domain.OutputText, Text: reply[i:end]})
		i = end
	}
	return nil
}

func utf8Start(b byte) bool { return b&0xC0 != 0x80 }

func (Demo) Suggest(_ context.Context, _ domain.Configuration, _, _ string, limit int) []string {
	return DemoSuggestions[:min(limit, len(DemoSuggestions))]
}

// DemoCatalog lists a fixed model for every provider.
type DemoCatalog struct{}

func (DemoCatalog) List(_ context.Context, c domain.Configuration) ([]domain.Model, error) {
	return []domain.Model{{ID: c.Provider.DefaultModel()}}, nil
}

var (
	_ domain.Gateway      = Demo{}
	_ domain.ModelCatalog = DemoCatalog{}
)
