import { describe, expect, it, vi } from "vitest";

import {
  AGENT_MODELS_UNAVAILABLE,
  HttpAgentModelCatalog,
} from "./http-agent-model-catalog";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const keyAuth = {
  baseUrl: null,
  apiKey: "sk-test",
  oauth: null,
};

describe("HttpAgentModelCatalog", () => {
  it("lists OpenAI chat models and drops embeddings", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.openai.com/v1/models");
      return jsonResponse({
        data: [
          { id: "gpt-4.1-mini" },
          { id: "text-embedding-3-small" },
          { id: "whisper-1" },
        ],
      });
    });
    const catalog = new HttpAgentModelCatalog(fetchImpl);

    const models = await catalog.list({ provider: "openai", ...keyAuth });

    expect(models).toEqual([{ id: "gpt-4.1-mini" }]);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
      headers: { Authorization: "Bearer sk-test" },
    });
  });

  it("lists Anthropic models with display names and pages", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("after_id=page-1")) {
        return jsonResponse({
          data: [{ id: "claude-opus-4-1", display_name: "Opus 4.1" }],
          has_more: false,
          last_id: "claude-opus-4-1",
        });
      }
      return jsonResponse({
        data: [{ id: "claude-sonnet-4-5", display_name: "Sonnet 4.5" }],
        has_more: true,
        last_id: "page-1",
      });
    });
    const catalog = new HttpAgentModelCatalog(fetchImpl);

    const models = await catalog.list({ provider: "anthropic", ...keyAuth });

    expect(models).toEqual([
      { id: "claude-sonnet-4-5", label: "Sonnet 4.5" },
      { id: "claude-opus-4-1", label: "Opus 4.1" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("https://api.anthropic.com/v1/models"),
      {
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": "sk-test",
        },
      },
    );
  });

  it("sends Anthropic OAuth headers instead of x-api-key", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("https://api.anthropic.com/v1/models");
      return jsonResponse({
        data: [{ id: "claude-sonnet-4-5" }],
        has_more: false,
      });
    });
    const catalog = new HttpAgentModelCatalog(fetchImpl);

    await catalog.list({
      provider: "anthropic",
      baseUrl: null,
      apiKey: null,
      oauth: {
        accessToken: "oauth-access",
        refreshToken: null,
        expiresAt: null,
        accountLabel: "mina@example.com",
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("https://api.anthropic.com/v1/models"),
      {
        headers: {
          "anthropic-version": "2023-06-01",
          Authorization: "Bearer oauth-access",
          "anthropic-beta": "oauth-2025-04-20",
        },
      },
    );
  });

  it("lists Google generateContent models and strips the models/ prefix", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("key=sk-test");
      return jsonResponse({
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/text-embedding-004",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      });
    });
    const catalog = new HttpAgentModelCatalog(fetchImpl);

    const models = await catalog.list({ provider: "google", ...keyAuth });

    expect(models).toEqual([
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ]);
  });

  it("lists Kimi models from the coding endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.kimi.com/coding/v1/models");
      return jsonResponse({ data: [{ id: "kimi-k2.5" }] });
    });
    const catalog = new HttpAgentModelCatalog(fetchImpl);

    const models = await catalog.list({ provider: "kimi", ...keyAuth });

    expect(models).toEqual([{ id: "kimi-k2.5" }]);
  });

  it("lists an OpenAI-compatible endpoint from the typed base URL", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://example.invalid/v1/models");
      return jsonResponse({ data: [{ id: "local-model" }] });
    });
    const catalog = new HttpAgentModelCatalog(fetchImpl);

    const models = await catalog.list({
      provider: "openai-compatible",
      baseUrl: "https://example.invalid/v1",
      apiKey: "sk-compat",
      oauth: null,
    });

    expect(models).toEqual([{ id: "local-model" }]);
  });

  it("does not leak a 401 body", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("sk-secret-in-body", { status: 401 }),
    );
    const catalog = new HttpAgentModelCatalog(fetchImpl);

    await expect(
      catalog.list({ provider: "openai", ...keyAuth }),
    ).rejects.toThrow(AGENT_MODELS_UNAVAILABLE);
  });

  it("maps a network failure to the same user-safe message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed: https://api.openai.com/v1/models");
    });
    const catalog = new HttpAgentModelCatalog(fetchImpl);

    await expect(
      catalog.list({ provider: "openai", ...keyAuth }),
    ).rejects.toThrow(AGENT_MODELS_UNAVAILABLE);
  });
});
