import { describe, expect, it } from "vitest";

import { canListAgentModels } from "./use-agent-models";

describe("canListAgentModels", () => {
  it("lists through a stored OAuth session for the same vendor", () => {
    expect(
      canListAgentModels({
        provider: "anthropic",
        baseUrl: "",
        apiKey: "",
        storedProvider: "anthropic",
        storedHasCredential: true,
        storedAuthKind: "oauth",
        oauthPath: true,
      }),
    ).toBe(true);
  });

  it("does not list on the OAuth path before Connect", () => {
    expect(
      canListAgentModels({
        provider: "openai",
        baseUrl: "",
        apiKey: "",
        storedProvider: "openai",
        storedHasCredential: false,
        storedAuthKind: null,
        oauthPath: true,
      }),
    ).toBe(false);
  });

  it("lists from a typed API key", () => {
    expect(
      canListAgentModels({
        provider: "groq",
        baseUrl: "",
        apiKey: "gsk-test",
        storedProvider: "openai",
        storedHasCredential: true,
        storedAuthKind: "oauth",
        oauthPath: false,
      }),
    ).toBe(true);
  });

  it("requires a base URL for the compatible fallback", () => {
    expect(
      canListAgentModels({
        provider: "openai-compatible",
        baseUrl: "",
        apiKey: "sk-local",
        storedProvider: "openai-compatible",
        storedHasCredential: true,
        storedAuthKind: "api-key",
        oauthPath: false,
      }),
    ).toBe(false);
    expect(
      canListAgentModels({
        provider: "openai-compatible",
        baseUrl: "https://example.invalid/v1",
        apiKey: "",
        storedProvider: "openai-compatible",
        storedHasCredential: true,
        storedAuthKind: "api-key",
        oauthPath: false,
      }),
    ).toBe(true);
  });
});
