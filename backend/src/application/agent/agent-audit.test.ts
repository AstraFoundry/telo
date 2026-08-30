import { describe, expect, it } from "vitest";

import type { AgentAuditRecord } from "../../domain/agent/agent-audit";
import type { AgentAuditRepository } from "../../domain/agent/agent-ports";
import { AgentAuditService } from "./agent-audit";

function record(partial: Partial<AgentAuditRecord> = {}): AgentAuditRecord {
  return {
    id: "r1",
    timestamp: "2026-08-27T15:00:00.000Z",
    action: "run",
    threadId: "thread-1",
    scope: "folder",
    messageIds: ["design-4", "design-5"],
    redactionCounts: { emails: 0, phones: 1, tokens: 0 },
    model: "gpt-4.1-mini",
    promptHash: "deadbeef",
    ...partial,
  };
}

describe("AgentAuditService", () => {
  it("lists the most recent records from the repository", async () => {
    let seenLimit: number | null = null;
    const audits: AgentAuditRepository = {
      append: async () => undefined,
      listRecent: async (limit) => {
        seenLimit = limit;
        return [record({ id: "r2" }), record({ id: "r1" })];
      },
    };

    const records = await new AgentAuditService(audits).listRecent();

    expect(seenLimit).toBe(50);
    expect(records.map((entry) => entry.id)).toEqual(["r2", "r1"]);
    expect(records[0]).toMatchObject({
      action: "run",
      scope: "folder",
      messageIds: ["design-4", "design-5"],
      model: "gpt-4.1-mini",
    });
  });
});
