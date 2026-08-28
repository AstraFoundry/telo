import { describe, expect, it } from "vitest";

import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type { AgentConfigurationRepository } from "../../domain/agent/agent-ports";
import { SaveAgentConfigurationService } from "./save-agent-configuration";

class MemoryConfigurationRepository implements AgentConfigurationRepository {
  value = AgentConfiguration.create({
    provider: "openai",
    model: "gpt-5-mini",
    baseUrl: null,
    instructions: "Inspect the workspace.",
    apiKey: "existing-key",
    canInspectWorkspace: true,
  });
  async get() {
    return this.value;
  }
  async save(value: AgentConfiguration) {
    this.value = value;
  }
}

describe("SaveAgentConfigurationService", () => {
  it("preserves the stored key when the input is empty", async () => {
    const repository = new MemoryConfigurationRepository();
    const service = new SaveAgentConfigurationService(repository);
    const result = await service.execute({
      provider: "openai",
      model: "gpt-5",
      instructions: "Answer briefly.",
      apiKey: "",
      canInspectWorkspace: false,
    });
    expect(result).toMatchObject({
      model: "gpt-5",
      hasApiKey: true,
      canInspectWorkspace: false,
    });
    expect(repository.value.snapshot().apiKey).toBe("existing-key");
  });
});
