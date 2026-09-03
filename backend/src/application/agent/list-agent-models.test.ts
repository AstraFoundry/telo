import { describe, expect, it, vi } from "vitest";

import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type {
  AgentConfigurationRepository,
  AgentModelCatalog,
} from "../../domain/agent/agent-ports";
import {
  AGENT_MODELS_NEED_CREDENTIAL,
  ListAgentModelsService,
} from "./list-agent-models";

class MemoryConfigurationRepository implements AgentConfigurationRepository {
  constructor(public value = AgentConfiguration.default()) {}
  async get() {
    return this.value;
  }
  async save(value: AgentConfiguration) {
    this.value = value;
  }
}

function catalog(
  list: AgentModelCatalog["list"] = async () => [],
): AgentModelCatalog {
  return { list };
}

describe("ListAgentModelsService", () => {
  it("uses a typed API key even when a different provider is stored", async () => {
    const list = vi.fn(async () => [{ id: "llama-3.3-70b-versatile" }]);
    const service = new ListAgentModelsService(
      new MemoryConfigurationRepository(),
      catalog(list),
    );

    const result = await service.execute({
      provider: "groq",
      apiKey: "gsk-test",
    });

    expect(result.models).toEqual([{ id: "llama-3.3-70b-versatile" }]);
    expect(list).toHaveBeenCalledWith({
      provider: "groq",
      baseUrl: null,
      apiKey: "gsk-test",
      oauth: null,
    });
  });

  it("uses the stored OAuth session when the selected provider matches", async () => {
    const oauth = {
      accessToken: "ya29.access",
      refreshToken: "1//refresh",
      expiresAt: "2026-09-03T12:00:00.000Z",
      accountLabel: "mina@example.com",
    };
    const repository = new MemoryConfigurationRepository(
      AgentConfiguration.create({
        ...AgentConfiguration.default().snapshot(),
        provider: "google",
        model: "gemini-2.5-flash",
        oauth,
      }),
    );
    const list = vi.fn(async () => [{ id: "gemini-2.5-flash" }]);
    const service = new ListAgentModelsService(repository, catalog(list));

    await service.execute({ provider: "google" });

    expect(list).toHaveBeenCalledWith({
      provider: "google",
      baseUrl: null,
      apiKey: null,
      oauth,
    });
  });

  it("prefers a newly typed key over a stored OAuth session", async () => {
    const repository = new MemoryConfigurationRepository(
      AgentConfiguration.create({
        ...AgentConfiguration.default().snapshot(),
        provider: "openai",
        oauth: {
          accessToken: "oauth-access",
          refreshToken: "oauth-refresh",
          expiresAt: "2026-09-03T12:00:00.000Z",
          accountLabel: "mina@example.com",
        },
      }),
    );
    const list = vi.fn(async () => [{ id: "gpt-4.1-mini" }]);
    const service = new ListAgentModelsService(repository, catalog(list));

    await service.execute({ provider: "openai", apiKey: "sk-typed" });

    expect(list).toHaveBeenCalledWith({
      provider: "openai",
      baseUrl: null,
      apiKey: "sk-typed",
      oauth: null,
    });
  });

  it("uses the typed compatible base URL with the stored key", async () => {
    const repository = new MemoryConfigurationRepository(
      AgentConfiguration.create({
        ...AgentConfiguration.default().snapshot(),
        provider: "openai-compatible",
        baseUrl: "https://stored.example/v1",
        apiKey: "sk-stored",
        model: "local-model",
      }),
    );
    const list = vi.fn(async () => [{ id: "local-model" }]);
    const service = new ListAgentModelsService(repository, catalog(list));

    await service.execute({
      provider: "openai-compatible",
      baseUrl: "https://typed.example/v1",
    });

    expect(list).toHaveBeenCalledWith({
      provider: "openai-compatible",
      baseUrl: "https://typed.example/v1",
      apiKey: "sk-stored",
      oauth: null,
    });
  });

  it("rejects listing without a credential for the selected vendor", async () => {
    const service = new ListAgentModelsService(
      new MemoryConfigurationRepository(),
      catalog(),
    );

    await expect(service.execute({ provider: "groq" })).rejects.toThrow(
      AGENT_MODELS_NEED_CREDENTIAL,
    );
  });

  it("rejects a non-HTTPS compatible base URL before calling the catalog", async () => {
    const list = vi.fn(async () => []);
    const service = new ListAgentModelsService(
      new MemoryConfigurationRepository(),
      catalog(list),
    );

    await expect(
      service.execute({
        provider: "openai-compatible",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "sk-local",
      }),
    ).rejects.toThrow("Agent base URL must use HTTPS");
    expect(list).not.toHaveBeenCalled();
  });

  it("drops duplicate and blank model ids", async () => {
    const service = new ListAgentModelsService(
      new MemoryConfigurationRepository(
        AgentConfiguration.create({
          ...AgentConfiguration.default().snapshot(),
          apiKey: "sk-test",
        }),
      ),
      catalog(async () => [
        { id: " gpt-4.1-mini ", label: "GPT-4.1 mini" },
        { id: "gpt-4.1-mini" },
        { id: "  " },
        { id: "gpt-4.1" },
      ]),
    );

    const result = await service.execute({ provider: "openai" });

    expect(result.models).toEqual([
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
      { id: "gpt-4.1" },
    ]);
  });
});
