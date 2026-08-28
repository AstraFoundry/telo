import { describe, expect, it } from "vitest";

import { AgentConfiguration } from "./agent-configuration";

const valid = {
  provider: "openai" as const,
  model: "gpt-5-mini",
  baseUrl: null,
  instructions: "Use visible context.",
  apiKey: "secret",
  canInspectWorkspace: true,
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
    });
  });

  it.each([
    [{ ...valid, model: "" }, "model"],
    [{ ...valid, instructions: "" }, "instructions"],
    [{ ...valid, provider: "openai-compatible" as const }, "base URL"],
    [{ ...valid, baseUrl: "http://localhost:3000" }, "HTTPS"],
  ])("rejects invalid values", (input, message) => {
    expect(() => AgentConfiguration.create(input)).toThrow(message);
  });

  it("provides a safe default without an API key", () => {
    expect(AgentConfiguration.default().snapshot()).toMatchObject({
      provider: "openai",
      apiKey: null,
      canInspectWorkspace: true,
    });
  });
});
