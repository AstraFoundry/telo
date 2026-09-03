import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentProvider } from "../../../../contracts/src/ipc";
import {
  AgentConfiguration,
  type AgentOAuthTokens,
} from "../../domain/agent/agent-configuration";
import type { AgentConfigurationRepository } from "../../domain/agent/agent-ports";

interface StoredAgentConfiguration {
  readonly provider: AgentProvider;
  readonly model: string;
  readonly baseUrl: string | null;
  readonly instructions: string;
  readonly encryptedApiKey: string | null;
  /** Absent in files written before OAuth shipped. */
  readonly encryptedOAuth?: string | null;
  readonly canInspectWorkspace: boolean;
  // Absent in files written before the agent tuning fields shipped; reads
  // backfill them from the default configuration.
  readonly temperature?: number;
  readonly maxSteps?: number;
  readonly historyLimit?: number;
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
      const defaults = AgentConfiguration.default().snapshot();
      return AgentConfiguration.create({
        provider: stored.provider,
        model: stored.model,
        baseUrl: stored.baseUrl,
        instructions: stored.instructions,
        apiKey: stored.encryptedApiKey
          ? this.decrypt(stored.encryptedApiKey)
          : null,
        oauth: stored.encryptedOAuth
          ? (JSON.parse(
              this.decrypt(stored.encryptedOAuth),
            ) as AgentOAuthTokens)
          : null,
        canInspectWorkspace: stored.canInspectWorkspace,
        temperature: numberOr(stored.temperature, defaults.temperature),
        maxSteps: numberOr(stored.maxSteps, defaults.maxSteps),
        historyLimit: numberOr(stored.historyLimit, defaults.historyLimit),
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
      encryptedOAuth: value.oauth
        ? this.encrypt(JSON.stringify(value.oauth))
        : null,
      canInspectWorkspace: value.canInspectWorkspace,
      temperature: value.temperature,
      maxSteps: value.maxSteps,
      historyLimit: value.historyLimit,
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

function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
