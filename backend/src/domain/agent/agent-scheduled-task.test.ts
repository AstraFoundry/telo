import { describe, expect, it } from "vitest";

import { AgentScheduledTask } from "./agent-scheduled-task";

const NOW = "2026-09-03T10:00:00.000Z";

function task(
  overrides: Partial<Parameters<typeof AgentScheduledTask.create>[0]> = {},
): AgentScheduledTask {
  return AgentScheduledTask.create({
    taskId: "task-1",
    name: "Morning digest",
    schedule: { kind: "cron", expression: "0 9 * * *" },
    promptTemplate: "Summarize the unread messages",
    chatId: "chat-1",
    createdBy: "user",
    now: NOW,
    ...overrides,
  });
}

describe("AgentScheduledTask.create", () => {
  it("defaults to draft-only delivery and enabled", () => {
    const snapshot = task().snapshot();
    expect(snapshot.delivery).toBe("draft-only");
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.lastRunAt).toBeNull();
  });

  it("rejects an invalid cron expression", () => {
    expect(() =>
      task({ schedule: { kind: "cron", expression: "0 9 * *" } }),
    ).toThrow(/5 fields/);
  });

  it("rejects an invalid one-shot date", () => {
    expect(() =>
      task({ schedule: { kind: "once", runAt: "not-a-date" } }),
    ).toThrow(/not a valid date/);
  });

  it("normalizes a one-shot date to ISO", () => {
    const snapshot = task({
      schedule: { kind: "once", runAt: "2026-09-04T09:00:00+08:00" },
    }).snapshot();
    expect(snapshot.schedule).toEqual({
      kind: "once",
      runAt: "2026-09-04T01:00:00.000Z",
    });
  });

  it("defaults the unread context scope to the delivery chat", () => {
    const snapshot = task({
      context: { scope: "unread" },
    }).snapshot();
    expect(snapshot.context).toEqual({ scope: "unread", chatId: "chat-1" });
  });

  it("rejects blank identity fields, template, and chat", () => {
    expect(() => task({ taskId: " " })).toThrow(/id is required/);
    expect(() => task({ name: " " })).toThrow(/name is required/);
    expect(() => task({ promptTemplate: " " })).toThrow(
      /prompt template is required/,
    );
    expect(() => task({ chatId: " " })).toThrow(/chatId is required/);
  });
});

describe("AgentScheduledTask.nextRunAt", () => {
  it("computes the next cron fire strictly after the reference time", () => {
    const next = task().nextRunAt(new Date("2026-09-03T09:00:00"));
    expect(next).toEqual(new Date("2026-09-04T09:00:00"));
  });

  it("fires a pending one-shot once, then never again", () => {
    const pending = task({
      schedule: { kind: "once", runAt: "2026-09-04T09:00:00Z" },
    });
    expect(pending.nextRunAt(new Date("2026-09-03T10:00:00Z"))).toEqual(
      new Date("2026-09-04T09:00:00.000Z"),
    );
    expect(pending.nextRunAt(new Date("2026-09-05T00:00:00Z"))).toBeNull();
  });
});

describe("AgentScheduledTask persistence", () => {
  it("round-trips through snapshot and restore", () => {
    const original = task({
      delivery: "auto-send",
      context: { scope: "folder", folderId: 2 },
    }).withLastRun("2026-09-03T11:00:00.000Z");
    const restored = AgentScheduledTask.restore(original.snapshot());
    expect(restored.snapshot()).toEqual(original.snapshot());
  });
});
