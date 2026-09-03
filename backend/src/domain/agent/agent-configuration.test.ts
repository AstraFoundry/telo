import { describe, expect, it } from "vitest";

import { AgentConfiguration, type AgentProvider } from "./agent-configuration";

const valid = {
  provider: "openai" as const,
  model: "gpt-5-mini",
  baseUrl: null,
  instructions: "Use visible context.",
  apiKey: "secret",
  oauth: null,
  canInspectWorkspace: true,
  temperature: 0.7,
  maxSteps: 4,
  historyLimit: 20,
};

describe("AgentConfiguration", () => {
  it("normalizes configuration fields", () => {
    const value = AgentConfiguration.create({
      ...valid,
      model: " gpt-5-mini ",
      apiKey: " secret ",
    });
    expect(value.snapshot()).toMatchObject({
      model: "gpt-5-mini",
      apiKey: "secret",
      oauth: null,
    });
  });

  it.each([
    [{ ...valid, model: "" }, "model"],
    [{ ...valid, instructions: "" }, "instructions"],
    [{ ...valid, provider: "openai-compatible" as const }, "base URL"],
    [
      {
        ...valid,
        provider: "openai-compatible" as const,
        baseUrl: "http://localhost:3000",
      },
      "HTTPS",
    ],
    [
      { ...valid, temperature: -0.1 },
      "Agent temperature must be between 0 and 2",
    ],
    [
      { ...valid, temperature: 2.1 },
      "Agent temperature must be between 0 and 2",
    ],
    [{ ...valid, temperature: Number.NaN }, "Agent temperature"],
    [{ ...valid, maxSteps: 0 }, "Agent max steps must be between 1 and 8"],
    [{ ...valid, maxSteps: 9 }, "Agent max steps must be between 1 and 8"],
    [{ ...valid, maxSteps: 2.5 }, "Agent max steps must be a whole number"],
    [
      { ...valid, historyLimit: -1 },
      "Agent history limit must be between 0 and 50",
    ],
    [
      { ...valid, historyLimit: 51 },
      "Agent history limit must be between 0 and 50",
    ],
    [
      { ...valid, historyLimit: 1.5 },
      "Agent history limit must be a whole number",
    ],
  ])("rejects invalid values", (input, message) => {
    expect(() => AgentConfiguration.create(input)).toThrow(message);
  });

  it("accepts the inclusive bounds", () => {
    expect(() =>
      AgentConfiguration.create({
        ...valid,
        temperature: 0,
        maxSteps: 1,
        historyLimit: 0,
      }),
    ).not.toThrow();
    expect(() =>
      AgentConfiguration.create({
        ...valid,
        temperature: 2,
        maxSteps: 8,
        historyLimit: 50,
      }),
    ).not.toThrow();
  });

  it("provides a safe default without an API key", () => {
    expect(AgentConfiguration.default().snapshot()).toMatchObject({
      provider: "openai",
      apiKey: null,
      oauth: null,
      canInspectWorkspace: true,
      temperature: 0.7,
      maxSteps: 4,
      historyLimit: 20,
    });
  });

  it("accepts a first-class provider without a base URL", () => {
    expect(
      AgentConfiguration.create({
        ...valid,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        baseUrl: "https://example.invalid/v1",
      }).snapshot(),
    ).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      baseUrl: null,
    });
  });

  it("rejects an unrecognized provider", () => {
    expect(() =>
      AgentConfiguration.create({
        ...valid,
        provider: "mystery" as AgentProvider,
      }),
    ).toThrow("Unknown agent provider");
  });

  it("keeps OAuth tokens on OAuth providers and strips them on API-key vendors", () => {
    const oauth = {
      accessToken: " ya29.token ",
      refreshToken: " 1//refresh ",
      expiresAt: "2026-09-03T12:00:00.000Z",
      accountLabel: " mina@example.com ",
    };
    expect(
      AgentConfiguration.create({
        ...valid,
        provider: "google",
        model: "gemini-2.5-flash",
        oauth,
      }).snapshot().oauth,
    ).toEqual({
      accessToken: "ya29.token",
      refreshToken: "1//refresh",
      expiresAt: "2026-09-03T12:00:00.000Z",
      accountLabel: "mina@example.com",
    });
    expect(
      AgentConfiguration.create({
        ...valid,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        oauth,
      }).snapshot().oauth,
    ).toEqual({
      accessToken: "ya29.token",
      refreshToken: "1//refresh",
      expiresAt: "2026-09-03T12:00:00.000Z",
      accountLabel: "mina@example.com",
    });
    expect(
      AgentConfiguration.create({
        ...valid,
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        oauth,
      }).snapshot().oauth,
    ).toBeNull();
  });

  it("rejects a malformed OAuth expiry", () => {
    expect(() =>
      AgentConfiguration.create({
        ...valid,
        provider: "google",
        model: "gemini-2.5-flash",
        oauth: {
          accessToken: "ya29.token",
          refreshToken: null,
          expiresAt: "not-a-date",
          accountLabel: null,
        },
      }),
    ).toThrow("Agent OAuth expiry is invalid");
  });
});
