import { describe, expect, it, vi } from "vitest";

import type {
  AgentTriggerRuleDto,
  SaveScheduledTaskInput,
  SaveTriggerRuleInput,
} from "../../../../contracts/src/ipc";
import { AgentScheduledTask } from "../../domain/agent/agent-scheduled-task";
import { AgentTriggerRule } from "../../domain/agent/agent-trigger-rule";
import {
  createAgentAutomationTools,
  type AgentAutomationToolsDeps,
} from "./agent-automation-tools";

const NOW = "2026-09-03T00:00:00.000Z";

// In-memory stand-in for the application service, backed by the real domain
// entities so validation errors and defaults are genuine.
function automationDeps(): AgentAutomationToolsDeps {
  const rules: AgentTriggerRule[] = [];
  const tasks: AgentScheduledTask[] = [];
  return {
    listRules: vi.fn(async () => [...rules]),
    saveRule: vi.fn(
      async (input: SaveTriggerRuleInput, createdBy: "user" | "agent") => {
        if (!input.ruleId) {
          const rule = AgentTriggerRule.create({
            ruleId: `rule-${rules.length + 1}`,
            name: input.name,
            match: input.match,
            delivery: input.delivery,
            promptTemplate: input.promptTemplate,
            createdBy,
            now: NOW,
          });
          rules.push(rule);
          return rule;
        }
        const index = rules.findIndex((rule) => rule.ruleId === input.ruleId);
        if (index === -1) {
          throw new Error(`Unknown trigger rule: ${input.ruleId}`);
        }
        const existing = rules[index].snapshot();
        const rule = AgentTriggerRule.restore({
          ...existing,
          name: input.name,
          match: { ...existing.match, ...input.match },
          delivery: input.delivery ?? existing.delivery,
          promptTemplate: input.promptTemplate,
          updatedAt: NOW,
        });
        rules[index] = rule;
        return rule;
      },
    ),
    removeRule: vi.fn(async (ruleId: string) => {
      const index = rules.findIndex((rule) => rule.ruleId === ruleId);
      if (index === -1) throw new Error(`Unknown trigger rule: ${ruleId}`);
      rules.splice(index, 1);
    }),
    setRuleEnabled: vi.fn(async (ruleId: string, enabled: boolean) => {
      const index = rules.findIndex((rule) => rule.ruleId === ruleId);
      if (index === -1) throw new Error(`Unknown trigger rule: ${ruleId}`);
      const rule = rules[index].withEnabled(enabled, NOW);
      rules[index] = rule;
      return rule;
    }),
    listTasks: vi.fn(async () => [...tasks]),
    saveTask: vi.fn(
      async (input: SaveScheduledTaskInput, createdBy: "user" | "agent") => {
        if (!input.taskId) {
          const task = AgentScheduledTask.create({
            taskId: `task-${tasks.length + 1}`,
            name: input.name,
            schedule: input.schedule,
            delivery: input.delivery,
            promptTemplate: input.promptTemplate,
            chatId: input.chatId,
            context: input.context ?? null,
            createdBy,
            now: NOW,
          });
          tasks.push(task);
          return task;
        }
        const index = tasks.findIndex((task) => task.taskId === input.taskId);
        if (index === -1) {
          throw new Error(`Unknown scheduled task: ${input.taskId}`);
        }
        const existing = tasks[index].snapshot();
        const task = AgentScheduledTask.restore({
          ...existing,
          name: input.name,
          schedule: input.schedule,
          delivery: input.delivery ?? existing.delivery,
          promptTemplate: input.promptTemplate,
          chatId: input.chatId,
          context:
            input.context === undefined ? existing.context : input.context,
          updatedAt: NOW,
        });
        tasks[index] = task;
        return task;
      },
    ),
    removeTask: vi.fn(async (taskId: string) => {
      const index = tasks.findIndex((task) => task.taskId === taskId);
      if (index === -1) throw new Error(`Unknown scheduled task: ${taskId}`);
      tasks.splice(index, 1);
    }),
    setTaskEnabled: vi.fn(async (taskId: string, enabled: boolean) => {
      const index = tasks.findIndex((task) => task.taskId === taskId);
      if (index === -1) throw new Error(`Unknown scheduled task: ${taskId}`);
      const task = tasks[index].withEnabled(enabled, NOW);
      tasks[index] = task;
      return task;
    }),
  };
}

// The AI SDK types execute as (input, options); the tools only read input.
function run<Output>(execute: unknown, input: unknown): Promise<Output> {
  return (execute as (input: unknown) => Promise<Output>)(input);
}

describe("configureTriggerRule", () => {
  it("creates rules as the agent and leaves delivery to the service default", async () => {
    const deps = automationDeps();
    const tools = createAgentAutomationTools(deps);

    const result = await run<AgentTriggerRuleDto>(
      tools.configureTriggerRule.execute,
      {
        action: "create",
        name: "Deploy alerts",
        match: { keywords: ["deploy"] },
        promptTemplate: "Summarize the deploy notice",
      },
    );

    expect(deps.saveRule).toHaveBeenCalledWith(
      {
        name: "Deploy alerts",
        match: { keywords: ["deploy"] },
        delivery: undefined,
        promptTemplate: "Summarize the deploy notice",
      },
      "agent",
    );
    expect(result).toMatchObject({
      name: "Deploy alerts",
      delivery: "draft-only",
      createdBy: "agent",
      enabled: true,
    });
  });

  it("lists rule snapshots", async () => {
    const deps = automationDeps();
    const tools = createAgentAutomationTools(deps);
    await run(tools.configureTriggerRule.execute, {
      action: "create",
      name: "Deploy alerts",
      match: { chatIds: ["chat-1"] },
      promptTemplate: "Summarize",
    });

    const result = await run<ReadonlyArray<AgentTriggerRuleDto>>(
      tools.configureTriggerRule.execute,
      { action: "list" },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ruleId: "rule-1",
      name: "Deploy alerts",
      match: {
        chatIds: ["chat-1"],
        senderIds: [],
        keywords: [],
        pattern: null,
        excludeMuted: true,
      },
    });
  });

  it("updates merge the patch onto the existing rule", async () => {
    const deps = automationDeps();
    const tools = createAgentAutomationTools(deps);
    const created = await run<AgentTriggerRuleDto>(
      tools.configureTriggerRule.execute,
      {
        action: "create",
        name: "Deploy alerts",
        match: { keywords: ["deploy"] },
        promptTemplate: "Summarize",
      },
    );

    const updated = await run<AgentTriggerRuleDto>(
      tools.configureTriggerRule.execute,
      { action: "update", ruleId: created.ruleId, delivery: "auto-send" },
    );

    expect(updated).toMatchObject({
      ruleId: created.ruleId,
      name: "Deploy alerts",
      delivery: "auto-send",
      createdBy: "agent",
      promptTemplate: "Summarize",
    });
    expect(deps.saveRule).toHaveBeenLastCalledWith(
      {
        ruleId: created.ruleId,
        name: "Deploy alerts",
        match: {
          chatIds: [],
          senderIds: [],
          keywords: ["deploy"],
          pattern: null,
          excludeMuted: true,
        },
        delivery: "auto-send",
        promptTemplate: "Summarize",
      },
      "agent",
    );
  });

  it("forwards set-enabled and remove to the service", async () => {
    const deps = automationDeps();
    const tools = createAgentAutomationTools(deps);
    const created = await run<AgentTriggerRuleDto>(
      tools.configureTriggerRule.execute,
      {
        action: "create",
        name: "Deploy alerts",
        match: { keywords: ["deploy"] },
        promptTemplate: "Summarize",
      },
    );

    const toggled = await run<AgentTriggerRuleDto>(
      tools.configureTriggerRule.execute,
      { action: "set-enabled", ruleId: created.ruleId, enabled: false },
    );
    expect(deps.setRuleEnabled).toHaveBeenCalledWith(created.ruleId, false);
    expect(toggled.enabled).toBe(false);

    const removed = await run<{ removed: string }>(
      tools.configureTriggerRule.execute,
      { action: "remove", ruleId: created.ruleId },
    );
    expect(deps.removeRule).toHaveBeenCalledWith(created.ruleId);
    expect(removed).toEqual({ removed: created.ruleId });
    await expect(
      run(tools.configureTriggerRule.execute, { action: "list" }),
    ).resolves.toEqual([]);
  });

  it("rejects unknown rule ids on update", async () => {
    const tools = createAgentAutomationTools(automationDeps());

    await expect(
      run(tools.configureTriggerRule.execute, {
        action: "update",
        ruleId: "missing",
        name: "Nope",
      }),
    ).rejects.toThrow("Unknown trigger rule: missing");
  });

  it("surfaces the domain error when no match dimension is given", async () => {
    const tools = createAgentAutomationTools(automationDeps());

    await expect(
      run(tools.configureTriggerRule.execute, {
        action: "create",
        name: "Bad rule",
        promptTemplate: "Summarize",
      }),
    ).rejects.toThrow(/at least one match dimension/);
  });
});

describe("configureScheduledTask", () => {
  it("creates cron tasks with the delivery chat and exposes nextRunAt", async () => {
    const deps = automationDeps();
    const tools = createAgentAutomationTools(deps);

    const result = await run<{ nextRunAt: string | null; chatId: string }>(
      tools.configureScheduledTask.execute,
      {
        action: "create",
        name: "Morning digest",
        schedule: { kind: "cron", expression: "0 9 * * *" },
        promptTemplate: "Digest unread messages",
        chatId: "chat-1",
      },
    );

    expect(deps.saveTask).toHaveBeenCalledWith(
      {
        name: "Morning digest",
        schedule: { kind: "cron", expression: "0 9 * * *" },
        delivery: undefined,
        promptTemplate: "Digest unread messages",
        chatId: "chat-1",
        context: null,
      },
      "agent",
    );
    expect(result.chatId).toBe("chat-1");
    expect(result.nextRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("reports a null nextRunAt for a spent one-shot", async () => {
    const tools = createAgentAutomationTools(automationDeps());

    const result = await run<{ nextRunAt: string | null }>(
      tools.configureScheduledTask.execute,
      {
        action: "create",
        name: "Past reminder",
        schedule: { kind: "once", runAt: "2020-01-01T00:00:00.000Z" },
        promptTemplate: "Remind",
        chatId: "chat-1",
      },
    );

    expect(result.nextRunAt).toBeNull();
  });

  it("passes the context scope straight through on create", async () => {
    const deps = automationDeps();
    const tools = createAgentAutomationTools(deps);

    const result = await run<{ context: unknown }>(
      tools.configureScheduledTask.execute,
      {
        action: "create",
        name: "Folder digest",
        schedule: { kind: "cron", expression: "0 18 * * 5" },
        promptTemplate: "Digest the folder",
        chatId: "chat-1",
        context: { scope: "folder", folderId: 7 },
      },
    );

    expect(deps.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { scope: "folder", folderId: 7 },
      }),
      "agent",
    );
    expect(result.context).toEqual({ scope: "folder", folderId: 7 });
  });

  it("forwards set-enabled and remove to the service", async () => {
    const deps = automationDeps();
    const tools = createAgentAutomationTools(deps);
    const created = await run<{ taskId: string }>(
      tools.configureScheduledTask.execute,
      {
        action: "create",
        name: "Morning digest",
        schedule: { kind: "cron", expression: "0 9 * * *" },
        promptTemplate: "Digest",
        chatId: "chat-1",
      },
    );

    await run(tools.configureScheduledTask.execute, {
      action: "set-enabled",
      taskId: created.taskId,
      enabled: false,
    });
    expect(deps.setTaskEnabled).toHaveBeenCalledWith(created.taskId, false);

    await run(tools.configureScheduledTask.execute, {
      action: "remove",
      taskId: created.taskId,
    });
    expect(deps.removeTask).toHaveBeenCalledWith(created.taskId);
    await expect(
      run(tools.configureScheduledTask.execute, { action: "list" }),
    ).resolves.toEqual([]);
  });
});
