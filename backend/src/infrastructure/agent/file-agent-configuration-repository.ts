import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type { AgentConfigurationRepository } from "../../domain/agent/agent-ports";

interface StoredAgentConfiguration {
  readonly provider: "openai" | "openai-compatible";
  readonly model: string;
  readonly baseUrl: string | null;
  readonly instructions: string;
  readonly encryptedApiKey: string | null;
  readonly canInspectWorkspace: boolean;
}

export class FileAgentConfigurationRepository implements AgentConfigurationRepository {
  constructor(
    private readonly filePath: string,
    private readonly encrypt: (value: string) => string,
    private readonly decrypt: (value: string) => string,
  ) {}

  async get(): Promise<AgentConfiguration> {
    try {
      const stored = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as StoredAgentConfiguration;
      return AgentConfiguration.create({
        provider: stored.provider,
        model: stored.model,
        baseUrl: stored.baseUrl,
        instructions: stored.instructions,
        apiKey: stored.encryptedApiKey
          ? this.decrypt(stored.encryptedApiKey)
          : null,
        canInspectWorkspace: stored.canInspectWorkspace,
      });
    } catch (error) {
      if (isMissingFile(error)) return AgentConfiguration.default();
      throw error;
    }
  }

  async save(configuration: AgentConfiguration): Promise<void> {
    const value = configuration.snapshot();
    const stored: StoredAgentConfiguration = {
      provider: value.provider,
      model: value.model,
      baseUrl: value.baseUrl,
      instructions: value.instructions,
      encryptedApiKey: value.apiKey ? this.encrypt(value.apiKey) : null,
      canInspectWorkspace: value.canInspectWorkspace,
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(stored, null, 2), {
      mode: 0o600,
    });
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
