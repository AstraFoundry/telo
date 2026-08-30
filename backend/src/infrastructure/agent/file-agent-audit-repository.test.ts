import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentAuditRecord } from "../../domain/agent/agent-audit";
import { FileAgentAuditRepository } from "./file-agent-audit-repository";

function record(partial: Partial<AgentAuditRecord> = {}): AgentAuditRecord {
  return {
    id: crypto.randomUUID(),
    timestamp: "2026-08-27T15:00:00.000Z",
    action: "run",
    threadId: "thread-1",
    scope: "unread",
    messageIds: ["design-4"],
    redactionCounts: { emails: 1, phones: 0, tokens: 0 },
    model: "gpt-4.1-mini",
    promptHash: "deadbeef",
    ...partial,
  };
}

describe("FileAgentAuditRepository", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "telo-agent-audit-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("returns an empty list when the log does not exist yet", async () => {
    const repository = new FileAgentAuditRepository(
      path.join(directory, "agent-audit.jsonl"),
    );

    expect(await repository.listRecent(50)).toEqual([]);
  });

  it("appends records and lists them newest first, capped at the limit", async () => {
    const filePath = path.join(directory, "agent-audit.jsonl");
    const repository = new FileAgentAuditRepository(filePath);
    const first = record({ id: "r1", timestamp: "2026-08-27T15:00:00.000Z" });
    const second = record({ id: "r2", timestamp: "2026-08-27T15:01:00.000Z" });
    const third = record({ id: "r3", timestamp: "2026-08-27T15:02:00.000Z" });

    await repository.append(first);
    await repository.append(second);
    await repository.append(third);

    expect((await repository.listRecent(50)).map((entry) => entry.id)).toEqual([
      "r3",
      "r2",
      "r1",
    ]);
    expect((await repository.listRecent(2)).map((entry) => entry.id)).toEqual([
      "r3",
      "r2",
    ]);

    // A fresh instance reads the same log back from disk.
    const reloaded = new FileAgentAuditRepository(filePath);
    expect((await reloaded.listRecent(1)).map((entry) => entry.id)).toEqual([
      "r3",
    ]);
  });
});
