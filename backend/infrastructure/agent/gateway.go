package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
)

// HTTP is the gateway to the providers' APIs: OpenAI's chat completions
// (OpenAI, Groq, xAI, Kimi, DeepSeek, Mistral and compatible servers),
// Anthropic's messages, and Gemini's generateContent, each streamed with
// tool calls looped up to the configuration's step limit.
type HTTP struct {
	Client *http.Client
}

func (h HTTP) client() *http.Client {
	if h.Client != nil {
		return h.Client
	}
	return http.DefaultClient
}

// openAIBase is each OpenAI-style provider's API root.
var openAIBase = map[domain.Provider]string{
	domain.ProviderOpenAI:   "https://api.openai.com/v1",
	domain.ProviderGroq:     "https://api.groq.com/openai/v1",
	domain.ProviderXAI:      "https://api.x.ai/v1",
	domain.ProviderKimi:     KimiCodingBaseURL,
	domain.ProviderDeepSeek: "https://api.deepseek.com/v1",
	domain.ProviderMistral:  "https://api.mistral.ai/v1",
}

const (
	anthropicBase    = "https://api.anthropic.com/v1"
	anthropicVersion = "2023-06-01"
	geminiBase       = "https://generativelanguage.googleapis.com/v1beta"
)

func token(c domain.Configuration) string {
	if c.Auth() == domain.AuthOAuth {
		return c.OAuth.AccessToken
	}
	return c.APIKey
}

// call is one tool call the model made.
type call struct {
	ID, Name, Args string
}

// turn is one entry of the conversation a step sends.
type turn struct {
	role    domain.Role
	text    string
	calls   []call
	results []result
}

type result struct {
	call
	output string
}

// step streams one model turn, emitting its text, and returns the tool
// calls it ended with.
type step func(ctx context.Context, h HTTP, c domain.Configuration, conv []turn, tools []domain.Tool, emit func(string)) ([]call, error)

func stepFor(p domain.Provider) step {
	switch p {
	case domain.ProviderAnthropic:
		return anthropicStep
	case domain.ProviderGoogle:
		return geminiStep
	}
	return openAIStep
}

func (h HTTP) Stream(ctx context.Context, r domain.Request, emit func(domain.Output)) error {
	c := r.Configuration
	if !c.HasCredential() {
		emit(domain.Output{Kind: domain.OutputError, Err: domain.ErrNoCredential})
		return nil
	}
	conv := make([]turn, 0, len(r.History)+1)
	for _, m := range r.History {
		conv = append(conv, turn{role: m.Role, text: m.Body})
	}
	conv = append(conv, turn{role: domain.RoleUser, text: r.Prompt})
	byName := map[string]domain.Tool{}
	for _, t := range r.Tools {
		byName[t.Name] = t
	}
	run := stepFor(c.Provider)
	for i := 0; i < c.MaxSteps; i++ {
		tools := r.Tools
		if i == c.MaxSteps-1 {
			// The last step answers in text.
			tools = nil
		}
		var text strings.Builder
		calls, err := run(ctx, h, c, conv, tools, func(s string) {
			text.WriteString(s)
			emit(domain.Output{Kind: domain.OutputText, Text: s})
		})
		if err != nil {
			emit(domain.Output{Kind: domain.OutputError, Err: classify(err)})
			return nil
		}
		if len(calls) == 0 {
			return nil
		}
		answer := turn{role: domain.RoleAssistant, text: text.String(), calls: calls}
		var results []result
		for _, cl := range calls {
			emit(domain.Output{Kind: domain.OutputActivity, Text: cl.Name})
			out := `{"error":"unknown tool"}`
			if t, ok := byName[cl.Name]; ok {
				res, err := t.Run(ctx, cl.Args)
				if err != nil {
					raw, _ := json.Marshal(map[string]string{"error": err.Error()})
					res = string(raw)
				}
				out = res
			}
			results = append(results, result{call: cl, output: out})
		}
		conv = append(conv, answer, turn{role: "tool", results: results})
	}
	return nil
}

// statusError is a provider's refusal; its body stays here, as it can
// carry key material.
type statusError struct{ code int }

func (e statusError) Error() string { return fmt.Sprintf("provider answered %d", e.code) }

func classify(err error) error {
	var s statusError
	var n net.Error
	switch {
	case errors.As(err, &s) && (s.code == http.StatusUnauthorized || s.code == http.StatusForbidden):
		return fmt.Errorf("%w (%d)", domain.ErrRejected, s.code)
	case errors.As(err, &n), errors.Is(err, io.ErrUnexpectedEOF):
		return fmt.Errorf("%w: %v", domain.ErrUnreachable, err)
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return err
	}
	return fmt.Errorf("%w: %v", domain.ErrRequestFailed, err)
}

func (h HTTP) post(ctx context.Context, url string, headers map[string]string, body any) (*http.Response, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := h.client().Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode/100 != 2 {
		_, _ = io.Copy(io.Discard, res.Body)
		res.Body.Close()
		return nil, statusError{res.StatusCode}
	}
	return res, nil
}

// events reads a server-sent event stream, calling f with each data line.
func events(r io.Reader, f func(event, data string) error) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	event := ""
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(line[len("event:"):])
		case strings.HasPrefix(line, "data:"):
			data := strings.TrimSpace(line[len("data:"):])
			if data == "[DONE]" {
				return nil
			}
			if err := f(event, data); err != nil {
				return err
			}
		case line == "":
			event = ""
		}
	}
	return sc.Err()
}

func openAIBaseURL(c domain.Configuration) string {
	if c.Provider == domain.ProviderCompatible {
		return strings.TrimRight(c.BaseURL, "/")
	}
	return openAIBase[c.Provider]
}

func openAIHeaders(c domain.Configuration) map[string]string {
	h := map[string]string{"Authorization": "Bearer " + token(c)}
	if c.Provider == domain.ProviderOpenAI && c.Auth() == domain.AuthOAuth {
		if id := chatGPTAccount(c.OAuth.AccessToken); id != "" {
			h["ChatGPT-Account-ID"] = id
		}
	}
	return h
}

func openAIStep(ctx context.Context, h HTTP, c domain.Configuration, conv []turn, tools []domain.Tool, emit func(string)) ([]call, error) {
	msgs := []map[string]any{{"role": "system", "content": c.Instructions}}
	for _, t := range conv {
		switch {
		case t.role == "tool":
			for _, r := range t.results {
				msgs = append(msgs, map[string]any{"role": "tool", "tool_call_id": r.ID, "content": r.output})
			}
		case len(t.calls) > 0:
			var calls []map[string]any
			for _, cl := range t.calls {
				calls = append(calls, map[string]any{"id": cl.ID, "type": "function", "function": map[string]any{"name": cl.Name, "arguments": cl.Args}})
			}
			msgs = append(msgs, map[string]any{"role": "assistant", "content": t.text, "tool_calls": calls})
		default:
			msgs = append(msgs, map[string]any{"role": string(t.role), "content": t.text})
		}
	}
	body := map[string]any{"model": c.Model, "messages": msgs, "stream": true}
	if !c.OmitsTemperature() {
		body["temperature"] = c.Temperature
	}
	if len(tools) > 0 {
		var fns []map[string]any
		for _, t := range tools {
			fns = append(fns, map[string]any{"type": "function", "function": map[string]any{"name": t.Name, "description": t.Description, "parameters": t.Parameters}})
		}
		body["tools"] = fns
	}
	res, err := h.post(ctx, openAIBaseURL(c)+"/chat/completions", openAIHeaders(c), body)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var calls []call
	err = events(res.Body, func(_, data string) error {
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return err
		}
		if chunk.Error != nil {
			return errors.New("stream error")
		}
		for _, ch := range chunk.Choices {
			if ch.Delta.Content != "" {
				emit(ch.Delta.Content)
			}
			for _, tc := range ch.Delta.ToolCalls {
				for len(calls) <= tc.Index {
					calls = append(calls, call{})
				}
				cl := &calls[tc.Index]
				if tc.ID != "" {
					cl.ID = tc.ID
				}
				cl.Name += tc.Function.Name
				cl.Args += tc.Function.Arguments
			}
		}
		return nil
	})
	return calls, err
}

func anthropicHeaders(c domain.Configuration) map[string]string {
	h := map[string]string{"anthropic-version": anthropicVersion}
	if c.Auth() == domain.AuthOAuth {
		h["Authorization"] = "Bearer " + c.OAuth.AccessToken
		h["anthropic-beta"] = AnthropicOAuthBeta
	} else {
		h["x-api-key"] = c.APIKey
	}
	return h
}

func anthropicStep(ctx context.Context, h HTTP, c domain.Configuration, conv []turn, tools []domain.Tool, emit func(string)) ([]call, error) {
	var msgs []map[string]any
	for _, t := range conv {
		switch {
		case t.role == "tool":
			var blocks []map[string]any
			for _, r := range t.results {
				blocks = append(blocks, map[string]any{"type": "tool_result", "tool_use_id": r.ID, "content": r.output})
			}
			msgs = append(msgs, map[string]any{"role": "user", "content": blocks})
		case len(t.calls) > 0:
			var blocks []map[string]any
			if t.text != "" {
				blocks = append(blocks, map[string]any{"type": "text", "text": t.text})
			}
			for _, cl := range t.calls {
				args := json.RawMessage(cl.Args)
				if !json.Valid(args) {
					args = json.RawMessage(`{}`)
				}
				blocks = append(blocks, map[string]any{"type": "tool_use", "id": cl.ID, "name": cl.Name, "input": args})
			}
			msgs = append(msgs, map[string]any{"role": "assistant", "content": blocks})
		default:
			msgs = append(msgs, map[string]any{"role": string(t.role), "content": t.text})
		}
	}
	body := map[string]any{"model": c.Model, "system": c.Instructions, "messages": msgs, "max_tokens": 4096, "stream": true}
	if !c.OmitsTemperature() {
		body["temperature"] = min(c.Temperature, 1)
	}
	if len(tools) > 0 {
		var defs []map[string]any
		for _, t := range tools {
			defs = append(defs, map[string]any{"name": t.Name, "description": t.Description, "input_schema": t.Parameters})
		}
		body["tools"] = defs
	}
	res, err := h.post(ctx, anthropicBase+"/messages", anthropicHeaders(c), body)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var calls []call
	open := map[int]int{}
	err = events(res.Body, func(event, data string) error {
		var e struct {
			Type         string `json:"type"`
			Index        int    `json:"index"`
			ContentBlock struct {
				Type string `json:"type"`
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"content_block"`
			Delta struct {
				Type        string `json:"type"`
				Text        string `json:"text"`
				PartialJSON string `json:"partial_json"`
			} `json:"delta"`
		}
		if err := json.Unmarshal([]byte(data), &e); err != nil {
			return err
		}
		switch e.Type {
		case "error":
			return errors.New("stream error")
		case "content_block_start":
			if e.ContentBlock.Type == "tool_use" {
				open[e.Index] = len(calls)
				calls = append(calls, call{ID: e.ContentBlock.ID, Name: e.ContentBlock.Name})
			}
		case "content_block_delta":
			switch e.Delta.Type {
			case "text_delta":
				emit(e.Delta.Text)
			case "input_json_delta":
				if i, ok := open[e.Index]; ok {
					calls[i].Args += e.Delta.PartialJSON
				}
			}
		}
		return nil
	})
	return calls, err
}

func geminiStep(ctx context.Context, h HTTP, c domain.Configuration, conv []turn, tools []domain.Tool, emit func(string)) ([]call, error) {
	var contents []map[string]any
	for _, t := range conv {
		switch {
		case t.role == "tool":
			var parts []map[string]any
			for _, r := range t.results {
				var out any
				if json.Unmarshal([]byte(r.output), &out) != nil {
					out = r.output
				}
				parts = append(parts, map[string]any{"functionResponse": map[string]any{"name": r.Name, "response": map[string]any{"result": out}}})
			}
			contents = append(contents, map[string]any{"role": "user", "parts": parts})
		case len(t.calls) > 0:
			var parts []map[string]any
			if t.text != "" {
				parts = append(parts, map[string]any{"text": t.text})
			}
			for _, cl := range t.calls {
				var args map[string]any
				_ = json.Unmarshal([]byte(cl.Args), &args)
				parts = append(parts, map[string]any{"functionCall": map[string]any{"name": cl.Name, "args": args}})
			}
			contents = append(contents, map[string]any{"role": "model", "parts": parts})
		default:
			role := "user"
			if t.role == domain.RoleAssistant {
				role = "model"
			}
			contents = append(contents, map[string]any{"role": role, "parts": []map[string]any{{"text": t.text}}})
		}
	}
	body := map[string]any{"contents": contents, "systemInstruction": map[string]any{"parts": []map[string]any{{"text": c.Instructions}}}}
	if !c.OmitsTemperature() {
		body["generationConfig"] = map[string]any{"temperature": c.Temperature}
	}
	if len(tools) > 0 {
		var fns []map[string]any
		for _, t := range tools {
			fns = append(fns, map[string]any{"name": t.Name, "description": t.Description, "parameters": t.Parameters})
		}
		body["tools"] = []map[string]any{{"functionDeclarations": fns}}
	}
	headers := map[string]string{}
	if c.Auth() == domain.AuthOAuth {
		headers["Authorization"] = "Bearer " + c.OAuth.AccessToken
	} else {
		headers["x-goog-api-key"] = c.APIKey
	}
	res, err := h.post(ctx, geminiBase+"/models/"+c.Model+":streamGenerateContent?alt=sse", headers, body)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var calls []call
	err = events(res.Body, func(_, data string) error {
		var chunk struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text         string `json:"text"`
						FunctionCall *struct {
							Name string          `json:"name"`
							Args json.RawMessage `json:"args"`
						} `json:"functionCall"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return err
		}
		for _, cand := range chunk.Candidates {
			for _, p := range cand.Content.Parts {
				if p.Text != "" {
					emit(p.Text)
				}
				if fc := p.FunctionCall; fc != nil {
					args := string(fc.Args)
					if args == "" {
						args = "{}"
					}
					calls = append(calls, call{ID: fmt.Sprintf("call-%d", len(calls)), Name: fc.Name, Args: args})
				}
			}
		}
		return nil
	})
	return calls, err
}

// suggestionInstructions ask for follow-up prompts as a JSON array.
const suggestionInstructions = "You write follow-up prompts for a chat assistant inside a Telegram client. " +
	"Answer with a JSON array of short strings only: each a question or request the user could send next, under 40 characters, " +
	"in the language of the conversation, no numbering, no explanations."

const suggestionMax = 60

func (h HTTP) Suggest(ctx context.Context, c domain.Configuration, prompt, reply string, limit int) []string {
	if !c.HasCredential() {
		return nil
	}
	c.Instructions, c.MaxSteps = suggestionInstructions, 1
	var text strings.Builder
	conv := []turn{{role: domain.RoleUser, text: prompt}, {role: domain.RoleAssistant, text: reply},
		{role: domain.RoleUser, text: fmt.Sprintf("Propose up to %d follow-up questions I might ask next.", limit)}}
	if _, err := stepFor(c.Provider)(ctx, h, c, conv, nil, func(s string) { text.WriteString(s) }); err != nil {
		return nil
	}
	return ParseSuggestions(text.String(), limit)
}

// ParseSuggestions reads the model's JSON array leniently: prose or a
// fence around it is fine; anything but strings yields none.
func ParseSuggestions(text string, limit int) []string {
	start, end := strings.Index(text, "["), strings.LastIndex(text, "]")
	if start < 0 || end <= start {
		return nil
	}
	var items []any
	if json.Unmarshal([]byte(text[start:end+1]), &items) != nil {
		return nil
	}
	var out []string
	for _, it := range items {
		s, ok := it.(string)
		if !ok {
			continue
		}
		s = strings.Join(strings.Fields(s), " ")
		if s == "" || len([]rune(s)) > suggestionMax || contains(out, s) {
			continue
		}
		out = append(out, s)
		if len(out) == limit {
			break
		}
	}
	return out
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

var _ domain.Gateway = HTTP{}
