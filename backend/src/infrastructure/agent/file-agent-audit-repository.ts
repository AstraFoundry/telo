import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentAuditRecord } from "../../domain/agent/agent-audit";
import type { AgentAuditRepository } from "../../domain/agent/agent-ports";

/**
 * Persists the agent audit trail as JSON Lines: one record per line,
 * append-only. Like the thread store the file holds no secrets (hashes and
 * ids only), so it stays plain text with the same restrictive file mode.
 */
export class FileAgentAuditRepository implements AgentAuditRepository {
  constructor(private readonly filePath: string) {}

  async append(record: AgentAuditRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, {
      mode: 0o600,
    });
  }

  async listRecent(limit: number): Promise<ReadonlyArray<AgentAuditRecord>> {
    const content = await this.read();
    if (!content) return [];
    const records = content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as AgentAuditRecord);
    return records.slice(-limit).reverse();
  }

  private async read(): Promise<string | null> {
    try {
      return await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
