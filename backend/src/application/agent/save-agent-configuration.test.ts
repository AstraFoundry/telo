import { describe, expect, it, vi } from "vitest";

import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type {
  AgentConfigurationRepository,
  AgentOAuthClient,
} from "../../domain/agent/agent-ports";
import { SaveAgentConfigurationService } from "./save-agent-configuration";

class MemoryConfigurationRepository implements AgentConfigurationRepository {
  value = AgentConfiguration.create({
    provider: "openai",
    model: "gpt-5-mini",
    baseUrl: null,
    instructions: "Inspect the workspace.",
    apiKey: "existing-key",
    oauth: null,
    canInspectWorkspace: true,
    temperature: 0.7,
    maxSteps: 4,
    historyLimit: 20,
  });
  async get() {
    return this.value;
  }
  async save(value: AgentConfiguration) {
    this.value = value;
  }
}

function oauthClient(
  overrides: Partial<AgentOAuthClient> = {},
): AgentOAuthClient {
  return {
    isConfigured: () => true,
    supports: (provider) => provider === "google",
    authorize: async () => ({
      accessToken: "ya29.access",
      refreshToken: "1//refresh",
      expiresAt: "2026-09-03T12:00:00.000Z",
      accountLabel: "mina@example.com",
    }),
    refresh: async () => ({
      accessToken: "ya29.refreshed",
      refreshToken: "1//refresh",
      expiresAt: "2026-09-03T13:00:00.000Z",
      accountLabel: "mina@example.com",
    }),
    ...overrides,
  };
}

const googleFields = {
  provider: "google" as const,
  model: "gemini-2.5-flash",
  instructions: "Answer briefly.",
  canInspectWorkspace: true,
  temperature: 0.7,
  maxSteps: 4,
  historyLimit: 20,
};

describe("SaveAgentConfigurationService", () => {
  it("preserves the stored key when the input is empty", async () => {
    const repository = new MemoryConfigurationRepository();
    const service = new SaveAgentConfigurationService(
      repository,
      oauthClient(),
    );
    const result = await service.execute({
      provider: "openai",
      model: "gpt-5",
      instructions: "Answer briefly.",
      apiKey: "",
      canInspectWorkspace: false,
      temperature: 1.1,
      maxSteps: 6,
      historyLimit: 3,
    });
    expect(result).toMatchObject({
      model: "gpt-5",
      hasCredential: true,
      authKind: "api-key",
      canInspectWorkspace: false,
      temperature: 1.1,
      maxSteps: 6,
      historyLimit: 3,
    });
    expect(repository.value.snapshot().apiKey).toBe("existing-key");
  });

  it("saves a first-class Anthropic account", async () => {
    const repository = new MemoryConfigurationRepository();
    const service = new SaveAgentConfigurationService(
      repository,
      oauthClient(),
    );
    const result = await service.execute({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      instructions: "Answer briefly.",
      apiKey: "sk-ant-new",
      canInspectWorkspace: true,
      temperature: 0.7,
      maxSteps: 4,
      historyLimit: 20,
    });
    expect(result).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      baseUrl: null,
      hasCredential: true,
      authKind: "api-key",
    });
    expect(repository.value.snapshot().apiKey).toBe("sk-ant-new");
  });

  it("drops the previous vendor key when the provider changes without a new key", async () => {
    const repository = new MemoryConfigurationRepository();
    const service = new SaveAgentConfigurationService(
      repository,
      oauthClient(),
    );

    const result = await service.execute({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      instructions: "Answer briefly.",
      canInspectWorkspace: true,
      temperature: 0.7,
      maxSteps: 4,
      historyLimit: 20,
    });

    expect(result.hasCredential).toBe(false);
    expect(repository.value.snapshot().apiKey).toBeNull();
  });

  it("connects a Google account through OAuth and clears the API key", async () => {
    const repository = new MemoryConfigurationRepository();
    const authorize = vi.fn(async () => ({
      accessToken: "ya29.access",
      refreshToken: "1//refresh",
      expiresAt: "2026-09-03T12:00:00.000Z",
      accountLabel: "mina@example.com",
    }));
    const service = new SaveAgentConfigurationService(
      repository,
      oauthClient({ authorize }),
    );

    const result = await service.connect(googleFields);

    expect(authorize).toHaveBeenCalledWith("google");
    expect(result).toMatchObject({
      provider: "google",
      hasCredential: true,
      authKind: "oauth",
      accountLabel: "mina@example.com",
      oauthClientConfigured: true,
    });
    expect(repository.value.snapshot()).toMatchObject({
      apiKey: null,
      oauth: {
        accessToken: "ya29.access",
        accountLabel: "mina@example.com",
      },
    });
  });

  it("rejects OAuth for a vendor that has no third-party program", async () => {
    const repository = new MemoryConfigurationRepository();
    const service = new SaveAgentConfigurationService(
      repository,
      oauthClient(),
    );

    await expect(
      service.connect({ ...googleFields, provider: "anthropic" }),
    ).rejects.toThrow("OAuth is not available for this provider");
    expect(repository.value.snapshot().apiKey).toBe("existing-key");
  });

  it("disconnects the stored credential", async () => {
    const repository = new MemoryConfigurationRepository();
    const service = new SaveAgentConfigurationService(
      repository,
      oauthClient(),
    );
    await service.connect(googleFields);

    const result = await service.disconnect(googleFields);

    expect(result).toMatchObject({
      hasCredential: false,
      authKind: null,
      accountLabel: null,
    });
    expect(repository.value.snapshot()).toMatchObject({
      apiKey: null,
      oauth: null,
    });
  });

  it("rejects connect when this build has no OAuth client", async () => {
    const repository = new MemoryConfigurationRepository();
    const service = new SaveAgentConfigurationService(
      repository,
      oauthClient({ isConfigured: () => false }),
    );

    await expect(service.connect(googleFields)).rejects.toThrow(
      "This build is missing a Google OAuth client.",
    );
  });

  it("rejects an out-of-range step count without saving", async () => {
    const repository = new MemoryConfigurationRepository();
    const service = new SaveAgentConfigurationService(
      repository,
      oauthClient(),
    );

    await expect(
      service.execute({
        provider: "openai",
        model: "gpt-5",
        instructions: "Answer briefly.",
        canInspectWorkspace: true,
        temperature: 0.7,
        maxSteps: 12,
        historyLimit: 20,
      }),
    ).rejects.toThrow("Agent max steps must be between 1 and 8");
    expect(repository.value.snapshot().maxSteps).toBe(4);
  });
});
