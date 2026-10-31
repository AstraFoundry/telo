package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	domain "github.com/AstraFoundry/telo/backend/domain/agent"
)

// Catalog lists a vendor's models over its API.
type Catalog struct{ Client *http.Client }

const catalogPages = 8

var nonChat = regexp.MustCompile(`(?i)embedding|whisper|tts|dall-e|dalle|realtime|transcribe|moderation|gpt-image|sora`)

func (k Catalog) get(ctx context.Context, u string, headers map[string]string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	for h, v := range headers {
		req.Header.Set(h, v)
	}
	client := k.Client
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return classify(err)
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		_, _ = io.Copy(io.Discard, res.Body)
		return classify(statusError{res.StatusCode})
	}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", domain.ErrRequestFailed, err)
	}
	return nil
}

func (k Catalog) List(ctx context.Context, c domain.Configuration) ([]domain.Model, error) {
	switch c.Provider {
	case domain.ProviderAnthropic:
		return k.anthropic(ctx, c)
	case domain.ProviderGoogle:
		return k.google(ctx, c)
	}
	var page struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := k.get(ctx, openAIBaseURL(c)+"/models", openAIHeaders(c), &page); err != nil {
		return nil, err
	}
	var out []domain.Model
	for _, m := range page.Data {
		if id := strings.TrimSpace(m.ID); id != "" && !nonChat.MatchString(id) {
			out = append(out, domain.Model{ID: id})
		}
	}
	return out, nil
}

func (k Catalog) anthropic(ctx context.Context, c domain.Configuration) ([]domain.Model, error) {
	var out []domain.Model
	after := ""
	for range catalogPages {
		q := url.Values{"limit": {"100"}}
		if after != "" {
			q.Set("after_id", after)
		}
		var page struct {
			Data []struct {
				ID          string `json:"id"`
				DisplayName string `json:"display_name"`
			} `json:"data"`
			LastID  string `json:"last_id"`
			HasMore bool   `json:"has_more"`
		}
		if err := k.get(ctx, anthropicBase+"/models?"+q.Encode(), anthropicHeaders(c), &page); err != nil {
			return nil, err
		}
		for _, m := range page.Data {
			out = append(out, domain.Model{ID: m.ID, Label: m.DisplayName})
		}
		if !page.HasMore || page.LastID == "" {
			break
		}
		after = page.LastID
	}
	return out, nil
}

func (k Catalog) google(ctx context.Context, c domain.Configuration) ([]domain.Model, error) {
	var out []domain.Model
	token := ""
	headers := map[string]string{}
	if c.Auth() == domain.AuthOAuth {
		headers["Authorization"] = "Bearer " + c.OAuth.AccessToken
	} else {
		headers["x-goog-api-key"] = c.APIKey
	}
	for range catalogPages {
		q := url.Values{"pageSize": {"100"}}
		if token != "" {
			q.Set("pageToken", token)
		}
		var page struct {
			Models []struct {
				Name        string   `json:"name"`
				DisplayName string   `json:"displayName"`
				Methods     []string `json:"supportedGenerationMethods"`
			} `json:"models"`
			Next string `json:"nextPageToken"`
		}
		if err := k.get(ctx, geminiBase+"/models?"+q.Encode(), headers, &page); err != nil {
			return nil, err
		}
		for _, m := range page.Models {
			if len(m.Methods) > 0 && !contains(m.Methods, "generateContent") {
				continue
			}
			out = append(out, domain.Model{ID: strings.TrimPrefix(m.Name, "models/"), Label: m.DisplayName})
		}
		if page.Next == "" {
			break
		}
		token = page.Next
	}
	return out, nil
}

var _ domain.ModelCatalog = Catalog{}
