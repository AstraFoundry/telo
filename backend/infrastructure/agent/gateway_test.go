package agent

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
)

// redirect sends every request to the test server, keeping the path.
type redirect struct{ to *url.URL }

func (r redirect) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.URL.Scheme, req.URL.Host = r.to.Scheme, r.to.Host
	return http.DefaultTransport.RoundTrip(req)
}

func server(t *testing.T, handler func(step int, r *http.Request, body map[string]any) string) *http.Client {
	step := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		out := handler(step, r, body)
		step++
		if strings.HasPrefix(out, "status:") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, out)
	}))
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	return &http.Client{Transport: redirect{u}}
}

func config(p domain.Provider) domain.Configuration {
	c := domain.DefaultConfiguration()
	c.Provider, c.Model, c.APIKey, c.MaxSteps = p, p.DefaultModel(), "sk-test", 3
	return c
}

var echo = domain.Tool{Name: "listChats", Description: "List chats.", Parameters: map[string]any{"type": "object"},
	Run: func(_ context.Context, args string) (string, error) { return `[{"id":"1","title":"Design"}]`, nil }}

func collect(t *testing.T, h HTTP, c domain.Configuration) (string, []string, error) {
	var text strings.Builder
	var activity []string
	var failure error
	err := h.Stream(context.Background(), domain.Request{Prompt: "Which chats?", Configuration: c, Tools: []domain.Tool{echo}}, func(o domain.Output) {
		switch o.Kind {
		case domain.OutputText:
			text.WriteString(o.Text)
		case domain.OutputActivity:
			activity = append(activity, o.Text)
		case domain.OutputError:
			failure = o.Err
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	return text.String(), activity, failure
}

func TestOpenAIStreamsToolCallsThenText(t *testing.T) {
	client := server(t, func(step int, r *http.Request, body map[string]any) string {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Errorf("request %s %v", r.URL.Path, r.Header)
		}
		if step == 0 {
			return "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"listChats\",\"arguments\":\"{\"}}]}}]}\n\n" +
				"data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"}\"}}]}}]}\n\ndata: [DONE]\n\n"
		}
		msgs := body["messages"].([]any)
		last := msgs[len(msgs)-1].(map[string]any)
		if last["role"] != "tool" || last["tool_call_id"] != "c1" {
			t.Errorf("tool result not replayed: %v", last)
		}
		return "data: {\"choices\":[{\"delta\":{\"content\":\"You have \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"Design.\"}}]}\n\ndata: [DONE]\n\n"
	})
	text, activity, err := collect(t, HTTP{Client: client}, config(domain.ProviderOpenAI))
	if err != nil || text != "You have Design." || len(activity) != 1 || activity[0] != "listChats" {
		t.Fatalf("%q %v %v", text, activity, err)
	}
}

func TestAnthropicStreamsToolUse(t *testing.T) {
	client := server(t, func(step int, r *http.Request, body map[string]any) string {
		if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "sk-test" || body["system"] == nil {
			t.Errorf("request %s %v", r.URL.Path, r.Header)
		}
		if step == 0 {
			return "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"listChats\"}}\n\n" +
				"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{}\"}}\n\n"
		}
		return "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Design.\"}}\n\n"
	})
	text, activity, err := collect(t, HTTP{Client: client}, config(domain.ProviderAnthropic))
	if err != nil || text != "Design." || len(activity) != 1 {
		t.Fatalf("%q %v %v", text, activity, err)
	}
}

func TestGeminiStreamsFunctionCalls(t *testing.T) {
	client := server(t, func(step int, r *http.Request, body map[string]any) string {
		if !strings.HasSuffix(r.URL.Path, ":streamGenerateContent") || r.Header.Get("x-goog-api-key") != "sk-test" {
			t.Errorf("request %s", r.URL.Path)
		}
		if step == 0 {
			return "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"listChats\",\"args\":{}}}]}}]}\n\n"
		}
		return "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Design.\"}]}}]}\n\n"
	})
	text, activity, err := collect(t, HTTP{Client: client}, config(domain.ProviderGoogle))
	if err != nil || text != "Design." || len(activity) != 1 {
		t.Fatalf("%q %v %v", text, activity, err)
	}
}

func TestRejectedKeyIsClassified(t *testing.T) {
	client := server(t, func(int, *http.Request, map[string]any) string { return "status:401" })
	_, _, err := collect(t, HTTP{Client: client}, config(domain.ProviderMistral))
	if !errors.Is(err, domain.ErrRejected) {
		t.Fatalf("%v", err)
	}
	c := config(domain.ProviderMistral)
	c.APIKey = ""
	if _, _, err := collect(t, HTTP{Client: client}, c); !errors.Is(err, domain.ErrNoCredential) {
		t.Fatalf("no credential: %v", err)
	}
}

func TestParseSuggestions(t *testing.T) {
	got := ParseSuggestions("Sure:\n```json\n[\"Reply to Mina\", 3, \"Reply to Mina\", \"  Who  waits? \"]\n```", 3)
	if len(got) != 2 || got[0] != "Reply to Mina" || got[1] != "Who waits?" {
		t.Fatalf("%q", got)
	}
	if ParseSuggestions("no list", 3) != nil {
		t.Fatal("prose is not a list")
	}
}

func TestAuthorizeURLCarriesPKCE(t *testing.T) {
	u, err := url.Parse(AuthorizeURL(domain.ProviderAnthropic, "client", "http://localhost:54545/callback", "chal", "st"))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if u.Host != "claude.ai" || q.Get("code_challenge") != "chal" || q.Get("code_challenge_method") != "S256" || q.Get("code") != "true" || q.Get("state") != "st" {
		t.Fatalf("%s", u)
	}
}

func TestDemoReplies(t *testing.T) {
	if got := DemoReply(domain.ActionTranslate + "\n" + domain.InputOpen + "\nHola\n" + domain.InputClose); got != "Demo translation: Hola" {
		t.Fatal(got)
	}
	var parts []string
	_ = Demo{}.Stream(context.Background(), domain.Request{Prompt: DemoMarkdownPrompt}, func(o domain.Output) { parts = append(parts, o.Text) })
	if len(parts) != 3 || strings.Join(parts, "") != DemoMarkdownReply {
		t.Fatalf("%d parts", len(parts))
	}
}
