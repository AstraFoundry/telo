import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentTriggerRuleRepository } from "../../domain/agent/agent-ports";
import {
  AgentTriggerRule,
  type AgentTriggerRuleSnapshot,
} from "../../domain/agent/agent-trigger-rule";

interface StoredAgentTriggerRules {
  readonly rules: ReadonlyArray<AgentTriggerRuleSnapshot>;
}

const EMPTY_STORE: StoredAgentTriggerRules = { rules: [] };

/**
 * Persists agent trigger rules in a single JSON file. Rules hold no secrets,
 * so the file stays plain JSON like `preferences.json`, with the same
 * restrictive file mode.
 */
export class FileAgentTriggerRuleRepository implements AgentTriggerRuleRepository {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ReadonlyArray<AgentTriggerRule>> {
    return (await this.read()).rules.map((rule) =>
      AgentTriggerRule.restore(rule),
    );
  }

  async save(rule: AgentTriggerRule): Promise<void> {
    const store = await this.read();
    const snapshot = rule.snapshot();
    const rules = store.rules.some(
      (stored) => stored.ruleId === snapshot.ruleId,
    )
      ? store.rules.map((stored) =>
          stored.ruleId === snapshot.ruleId ? snapshot : stored,
        )
      : [...store.rules, snapshot];
    await this.write({ rules });
  }

  async remove(ruleId: string): Promise<void> {
    const store = await this.read();
    await this.write({
      rules: store.rules.filter((rule) => rule.ruleId !== ruleId),
    });
  }

  private async read(): Promise<StoredAgentTriggerRules> {
    try {
      return JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as StoredAgentTriggerRules;
    } catch (error) {
      if (isMissingFile(error)) return EMPTY_STORE;
      throw error;
    }
  }

  private async write(store: StoredAgentTriggerRules): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), {
      mode: 0o600,
    });
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
