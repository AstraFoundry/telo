import type {
  SaveScheduledTaskInput,
  SaveTriggerRuleInput,
} from "../../../../contracts/src/ipc";
import type { AgentAutomationCreator } from "../../domain/agent/agent-automation";
import type {
  AgentScheduledTaskRepository,
  AgentTriggerRuleRepository,
} from "../../domain/agent/agent-ports";
import {
  AgentScheduledTask,
  type AgentTaskContext,
} from "../../domain/agent/agent-scheduled-task";
import { AgentTriggerRule } from "../../domain/agent/agent-trigger-rule";

/**
 * Create/update/remove surface for trigger rules and scheduled tasks, shared
 * by the IPC handlers (user-authored) and the agent's own management tools
 * (agent-authored). Updates rebuild the entity through the domain's
 * validated restore path, so a patch can never smuggle in an invalid match
 * or schedule, and notify the runner processes through the change hooks.
 */
export class AgentAutomationService {
  constructor(
    private readonly rules: AgentTriggerRuleRepository,
    private readonly tasks: AgentScheduledTaskRepository,
    private readonly hooks: {
      onRulesChanged?: () => void;
      onTasksChanged?: () => void;
    } = {},
    private readonly now: () => Date = () => new Date(),
    private readonly mintId: () => string = () => crypto.randomUUID(),
  ) {}

  listRules(): Promise<ReadonlyArray<AgentTriggerRule>> {
    return this.rules.list();
  }

  async saveRule(
    input: SaveTriggerRuleInput,
    createdBy: AgentAutomationCreator,
  ): Promise<AgentTriggerRule> {
    const nowIso = this.now().toISOString();
    let rule: AgentTriggerRule;
    if (input.ruleId) {
      const existing = await this.findRule(input.ruleId);
      // Editable fields only: identity, createdAt, and createdBy survive.
      // The patch's partial match replaces the stored one wholesale; the
      // absent-dimension defaults mirror the domain's normalizeMatch, which
      // restore runs again on this snapshot.
      rule = AgentTriggerRule.restore({
        ...existing.snapshot(),
        name: input.name,
        match: {
          chatIds: input.match.chatIds ?? [],
          senderIds: input.match.senderIds ?? [],
          keywords: input.match.keywords ?? [],
          pattern: input.match.pattern ?? null,
          excludeMuted: input.match.excludeMuted ?? true,
        },
        delivery: input.delivery ?? existing.delivery,
        promptTemplate: input.promptTemplate,
        updatedAt: nowIso,
      });
    } else {
      rule = AgentTriggerRule.create({
        ruleId: this.mintId(),
        name: input.name,
        match: input.match,
        delivery: input.delivery,
        promptTemplate: input.promptTemplate,
        createdBy,
        now: nowIso,
      });
    }
    await this.rules.save(rule);
    this.hooks.onRulesChanged?.();
    return rule;
  }

  async removeRule(ruleId: string): Promise<void> {
    await this.findRule(ruleId);
    await this.rules.remove(ruleId);
    this.hooks.onRulesChanged?.();
  }

  async setRuleEnabled(
    ruleId: string,
    enabled: boolean,
  ): Promise<AgentTriggerRule> {
    const rule = (await this.findRule(ruleId)).withEnabled(
      enabled,
      this.now().toISOString(),
    );
    await this.rules.save(rule);
    this.hooks.onRulesChanged?.();
    return rule;
  }

  listTasks(): Promise<ReadonlyArray<AgentScheduledTask>> {
    return this.tasks.list();
  }

  async saveTask(
    input: SaveScheduledTaskInput,
    createdBy: AgentAutomationCreator,
  ): Promise<AgentScheduledTask> {
    const nowIso = this.now().toISOString();
    let task: AgentScheduledTask;
    if (input.taskId) {
      const existing = await this.findTask(input.taskId);
      task = AgentScheduledTask.restore({
        ...existing.snapshot(),
        name: input.name,
        schedule: { ...input.schedule },
        delivery: input.delivery ?? existing.delivery,
        promptTemplate: input.promptTemplate,
        chatId: input.chatId,
        context: defaultContextChat(input.context ?? null, input.chatId),
        updatedAt: nowIso,
      });
    } else {
      task = AgentScheduledTask.create({
        taskId: this.mintId(),
        name: input.name,
        schedule: input.schedule,
        delivery: input.delivery,
        promptTemplate: input.promptTemplate,
        chatId: input.chatId,
        context: input.context,
        createdBy,
        now: nowIso,
      });
    }
    await this.tasks.save(task);
    this.hooks.onTasksChanged?.();
    return task;
  }

  async removeTask(taskId: string): Promise<void> {
    await this.findTask(taskId);
    await this.tasks.remove(taskId);
    this.hooks.onTasksChanged?.();
  }

  async setTaskEnabled(
    taskId: string,
    enabled: boolean,
  ): Promise<AgentScheduledTask> {
    const task = (await this.findTask(taskId)).withEnabled(
      enabled,
      this.now().toISOString(),
    );
    await this.tasks.save(task);
    this.hooks.onTasksChanged?.();
    return task;
  }

  private async findRule(ruleId: string): Promise<AgentTriggerRule> {
    const rule = (await this.rules.list()).find(
      (candidate) => candidate.ruleId === ruleId,
    );
    if (!rule) throw new Error(`Unknown trigger rule: ${ruleId}`);
    return rule;
  }

  private async findTask(taskId: string): Promise<AgentScheduledTask> {
    const task = (await this.tasks.list()).find(
      (candidate) => candidate.taskId === taskId,
    );
    if (!task) throw new Error(`Unknown scheduled task: ${taskId}`);
    return task;
  }
}

/**
 * An "unread" context without an explicit chat reads the delivery chat, the
 * same defaulting `AgentScheduledTask.create` applies on the create path;
 * restore alone would not.
 */
function defaultContextChat(
  context: AgentTaskContext | null,
  chatId: string,
): AgentTaskContext | null {
  if (context?.scope === "unread" && !context.chatId) {
    return { ...context, chatId };
  }
  return context;
}
