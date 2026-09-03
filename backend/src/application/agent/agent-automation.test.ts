import { describe, expect, it, vi } from "vitest";

import type {
  SaveScheduledTaskInput,
  SaveTriggerRuleInput,
} from "../../../../contracts/src/ipc";
import type {
  AgentScheduledTaskRepository,
  AgentTriggerRuleRepository,
} from "../../domain/agent/agent-ports";
import type { AgentScheduledTask } from "../../domain/agent/agent-scheduled-task";
import type { AgentTriggerRule } from "../../domain/agent/agent-trigger-rule";
import { AgentAutomationService } from "./agent-automation";

const T0 = new Date("2026-09-03T10:00:00.000Z");
const T1 = new Date("2026-09-03T11:00:00.000Z");

function inMemoryRules(): AgentTriggerRuleRepository & {
  store: AgentTriggerRule[];
} {
  const store: AgentTriggerRule[] = [];
  return {
    store,
    list: async () => [...store],
    save: async (rule) => {
      const index = store.findIndex((entry) => entry.ruleId === rule.ruleId);
      if (index >= 0) store[index] = rule;
      else store.push(rule);
    },
    remove: async (ruleId) => {
      const index = store.findIndex((entry) => entry.ruleId === ruleId);
      if (index >= 0) store.splice(index, 1);
    },
  };
}

function inMemoryTasks(): AgentScheduledTaskRepository & {
  store: AgentScheduledTask[];
} {
  const store: AgentScheduledTask[] = [];
  return {
    store,
    list: async () => [...store],
    save: async (task) => {
      const index = store.findIndex((entry) => entry.taskId === task.taskId);
      if (index >= 0) store[index] = task;
      else store.push(task);
    },
    remove: async (taskId) => {
      const index = store.findIndex((entry) => entry.taskId === taskId);
      if (index >= 0) store.splice(index, 1);
    },
  };
}

function ruleInput(
  overrides: Partial<SaveTriggerRuleInput> = {},
): SaveTriggerRuleInput {
  return {
    name: "Boss pings",
    match: { keywords: ["urgent"] },
    promptTemplate: "Draft a reply",
    ...overrides,
  };
}

function taskInput(
  overrides: Partial<SaveScheduledTaskInput> = {},
): SaveScheduledTaskInput {
  return {
    name: "Morning digest",
    schedule: { kind: "cron", expression: "0 9 * * *" },
    promptTemplate: "Summarize unread",
    chatId: "chat-1",
    ...overrides,
  };
}

function makeService(
  rules: AgentTriggerRuleRepository = inMemoryRules(),
  tasks: AgentScheduledTaskRepository = inMemoryTasks(),
  hooks: { onRulesChanged?: () => void; onTasksChanged?: () => void } = {},
  now: () => Date = () => T0,
) {
  let minted = 0;
  return new AgentAutomationService(rules, tasks, hooks, now, () => {
    minted += 1;
    return `minted-${minted}`;
  });
}

describe("AgentAutomationService rules", () => {
  it("creates a rule with draft-only delivery, enabled, and the creator recorded", async () => {
    const service = makeService();

    const created = await service.saveRule(ruleInput(), "user");
    const snapshot = created.snapshot();

    expect(snapshot.ruleId).toBe("minted-1");
    expect(snapshot.delivery).toBe("draft-only");
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.createdBy).toBe("user");
    expect(snapshot.createdAt).toBe(T0.toISOString());
    expect(snapshot.updatedAt).toBe(T0.toISOString());
  });

  it("enables agent-created rules immediately", async () => {
    const service = makeService();

    const created = await service.saveRule(ruleInput(), "agent");

    expect(created.enabled).toBe(true);
    expect(created.snapshot().createdBy).toBe("agent");
  });

  it("updates editable fields, preserving createdAt and createdBy and bumping updatedAt", async () => {
    const rules = inMemoryRules();
    let clock = T0;
    const service = makeService(rules, inMemoryTasks(), {}, () => clock);
    const created = await service.saveRule(ruleInput(), "agent");
    clock = T1;

    const updated = await service.saveRule(
      ruleInput({
        ruleId: created.ruleId,
        name: "Renamed",
        match: { chatIds: ["chat-9"] },
        delivery: "auto-send",
        promptTemplate: "New template",
      }),
      "user",
    );
    const snapshot = updated.snapshot();

    expect(snapshot.ruleId).toBe(created.ruleId);
    expect(snapshot.name).toBe("Renamed");
    expect(snapshot.match.chatIds).toEqual(["chat-9"]);
    expect(snapshot.match.keywords).toEqual([]);
    expect(snapshot.delivery).toBe("auto-send");
    expect(snapshot.promptTemplate).toBe("New template");
    expect(snapshot.createdBy).toBe("agent");
    expect(snapshot.createdAt).toBe(T0.toISOString());
    expect(snapshot.updatedAt).toBe(T1.toISOString());
  });

  it("keeps the stored delivery when an update omits it", async () => {
    const service = makeService();
    const created = await service.saveRule(
      ruleInput({ delivery: "auto-send" }),
      "user",
    );

    const updated = await service.saveRule(
      ruleInput({ ruleId: created.ruleId, delivery: undefined }),
      "user",
    );

    expect(updated.delivery).toBe("auto-send");
  });

  it("re-validates the match on update", async () => {
    const service = makeService();
    const created = await service.saveRule(ruleInput(), "user");

    await expect(
      service.saveRule(
        ruleInput({ ruleId: created.ruleId, match: {} }),
        "user",
      ),
    ).rejects.toThrow(/at least one match dimension/);
  });

  it("throws on unknown rule ids", async () => {
    const service = makeService();

    await expect(
      service.saveRule(ruleInput({ ruleId: "nope" }), "user"),
    ).rejects.toThrow(/Unknown trigger rule/);
    await expect(service.setRuleEnabled("nope", false)).rejects.toThrow(
      /Unknown trigger rule/,
    );
    await expect(service.removeRule("nope")).rejects.toThrow(
      /Unknown trigger rule/,
    );
  });

  it("toggles enabled and removes rules", async () => {
    const service = makeService();
    const created = await service.saveRule(ruleInput(), "user");

    expect((await service.setRuleEnabled(created.ruleId, false)).enabled).toBe(
      false,
    );
    expect((await service.setRuleEnabled(created.ruleId, true)).enabled).toBe(
      true,
    );

    await service.removeRule(created.ruleId);
    expect(await service.listRules()).toEqual([]);
  });

  it("fires onRulesChanged after every rule mutation", async () => {
    const onRulesChanged = vi.fn();
    const onTasksChanged = vi.fn();
    const service = makeService(inMemoryRules(), inMemoryTasks(), {
      onRulesChanged,
      onTasksChanged,
    });
    const created = await service.saveRule(ruleInput(), "user");
    await service.saveRule(ruleInput({ ruleId: created.ruleId }), "user");
    await service.setRuleEnabled(created.ruleId, false);
    await service.removeRule(created.ruleId);

    expect(onRulesChanged).toHaveBeenCalledTimes(4);
    expect(onTasksChanged).not.toHaveBeenCalled();
  });
});

describe("AgentAutomationService tasks", () => {
  it("creates a task with draft-only delivery, enabled, and the creator recorded", async () => {
    const service = makeService();

    const created = await service.saveTask(taskInput(), "user");
    const snapshot = created.snapshot();

    expect(snapshot.taskId).toBe("minted-1");
    expect(snapshot.delivery).toBe("draft-only");
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.createdBy).toBe("user");
    expect(snapshot.lastRunAt).toBeNull();
    expect(snapshot.createdAt).toBe(T0.toISOString());
  });

  it("enables agent-created tasks immediately", async () => {
    const service = makeService();

    const created = await service.saveTask(taskInput(), "agent");

    expect(created.enabled).toBe(true);
    expect(created.snapshot().createdBy).toBe("agent");
  });

  it("updates editable fields, preserving createdAt, createdBy, and lastRunAt", async () => {
    const tasks = inMemoryTasks();
    let clock = T0;
    const service = makeService(inMemoryRules(), tasks, {}, () => clock);
    const created = await service.saveTask(taskInput(), "agent");
    await tasks.save(created.withLastRun(T0.toISOString()));
    clock = T1;

    const updated = await service.saveTask(
      taskInput({
        taskId: created.taskId,
        name: "Renamed",
        schedule: { kind: "once", runAt: "2026-09-04T09:00:00.000Z" },
        chatId: "chat-2",
      }),
      "user",
    );
    const snapshot = updated.snapshot();

    expect(snapshot.taskId).toBe(created.taskId);
    expect(snapshot.name).toBe("Renamed");
    expect(snapshot.schedule).toEqual({
      kind: "once",
      runAt: "2026-09-04T09:00:00.000Z",
    });
    expect(snapshot.chatId).toBe("chat-2");
    expect(snapshot.createdBy).toBe("agent");
    expect(snapshot.createdAt).toBe(T0.toISOString());
    expect(snapshot.lastRunAt).toBe(T0.toISOString());
    expect(snapshot.updatedAt).toBe(T1.toISOString());
  });

  it("re-validates the schedule on update", async () => {
    const service = makeService();
    const created = await service.saveTask(taskInput(), "user");

    await expect(
      service.saveTask(
        taskInput({
          taskId: created.taskId,
          schedule: { kind: "once", runAt: "not a date" },
        }),
        "user",
      ),
    ).rejects.toThrow(/not a valid date/);
  });

  it("throws on unknown task ids", async () => {
    const service = makeService();

    await expect(
      service.saveTask(taskInput({ taskId: "nope" }), "user"),
    ).rejects.toThrow(/Unknown scheduled task/);
    await expect(service.setTaskEnabled("nope", false)).rejects.toThrow(
      /Unknown scheduled task/,
    );
    await expect(service.removeTask("nope")).rejects.toThrow(
      /Unknown scheduled task/,
    );
  });

  it("fires onTasksChanged after every task mutation", async () => {
    const onRulesChanged = vi.fn();
    const onTasksChanged = vi.fn();
    const service = makeService(inMemoryRules(), inMemoryTasks(), {
      onRulesChanged,
      onTasksChanged,
    });
    const created = await service.saveTask(taskInput(), "user");
    await service.saveTask(taskInput({ taskId: created.taskId }), "user");
    await service.setTaskEnabled(created.taskId, false);
    await service.removeTask(created.taskId);

    expect(onTasksChanged).toHaveBeenCalledTimes(4);
    expect(onRulesChanged).not.toHaveBeenCalled();
  });
});
