import {
  AGENT_DELIVERY_DEFAULT,
  isAgentDeliveryMode,
  type AgentAutomationCreator,
  type AgentDeliveryMode,
} from "./agent-automation";
import { CronExpression } from "./agent-cron";

/**
 * When a scheduled task fires. `cron` recurs on a five-field expression
 * (local timezone, see agent-cron); `once` fires a single time at `runAt`
 * and then becomes spent — it never fires again even if re-enabled.
 */
export type AgentTaskSchedule =
  | { readonly kind: "cron"; readonly expression: string }
  | { readonly kind: "once"; readonly runAt: string };

/**
 * Optional context scope of a scheduled run, mirroring the panel's scopes
 * minus "selected" (pinned message ids go stale between scheduling and
 * firing, so a timer cannot meaningfully re-select them).
 */
export interface AgentTaskContext {
  readonly scope: "unread" | "folder";
  /** Required for "unread"; defaults to the delivery chat. */
  readonly chatId?: string;
  /** Folder for "folder" scope; absent means the main list. */
  readonly folderId?: number;
}

export interface AgentScheduledTaskSnapshot {
  readonly taskId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly schedule: AgentTaskSchedule;
  readonly delivery: AgentDeliveryMode;
  /** The instruction of the agent run; the scoped payload is prepended. */
  readonly promptTemplate: string;
  /** Chat the run's result is delivered to (message or draft). */
  readonly chatId: string;
  readonly context: AgentTaskContext | null;
  readonly lastRunAt: string | null;
  readonly createdBy: AgentAutomationCreator;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function normalizeSchedule(schedule: AgentTaskSchedule): AgentTaskSchedule {
  if (schedule.kind === "cron") {
    // Parsing validates; the compiled form is rebuilt per nextRunAt call
    // because entities are restored from JSON on every repository read.
    CronExpression.parse(schedule.expression);
    return { kind: "cron", expression: schedule.expression.trim() };
  }
  if (schedule.kind === "once") {
    const runAt = new Date(schedule.runAt);
    if (Number.isNaN(runAt.getTime())) {
      throw new Error(
        `Scheduled task runAt is not a valid date: ${schedule.runAt}`,
      );
    }
    return { kind: "once", runAt: runAt.toISOString() };
  }
  throw new Error(`Unknown schedule kind: ${String(schedule)}`);
}

export class AgentScheduledTask {
  private constructor(private readonly value: AgentScheduledTaskSnapshot) {}

  static create(input: {
    taskId: string;
    name: string;
    schedule: AgentTaskSchedule;
    delivery?: AgentDeliveryMode;
    promptTemplate: string;
    chatId: string;
    context?: AgentTaskContext | null;
    createdBy: AgentAutomationCreator;
    now: string;
  }): AgentScheduledTask {
    const taskId = input.taskId.trim();
    if (!taskId) throw new Error("Scheduled task id is required");
    const name = input.name.trim();
    if (!name) throw new Error("Scheduled task name is required");
    const promptTemplate = input.promptTemplate.trim();
    if (!promptTemplate) {
      throw new Error("Scheduled task prompt template is required");
    }
    const chatId = input.chatId.trim();
    if (!chatId) throw new Error("Scheduled task chatId is required");
    const delivery = input.delivery ?? AGENT_DELIVERY_DEFAULT;
    if (!isAgentDeliveryMode(delivery)) {
      throw new Error(`Unknown delivery mode: ${String(input.delivery)}`);
    }
    if (input.context?.scope === "unread" && !input.context.chatId) {
      input = {
        ...input,
        context: { ...input.context, chatId },
      };
    }
    return new AgentScheduledTask({
      taskId,
      name,
      enabled: true,
      schedule: normalizeSchedule(input.schedule),
      delivery,
      promptTemplate,
      chatId,
      context: input.context ?? null,
      lastRunAt: null,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static restore(snapshot: AgentScheduledTaskSnapshot): AgentScheduledTask {
    return new AgentScheduledTask({
      ...snapshot,
      schedule: normalizeSchedule(snapshot.schedule),
    });
  }

  get taskId(): string {
    return this.value.taskId;
  }

  get enabled(): boolean {
    return this.value.enabled;
  }

  get schedule(): AgentTaskSchedule {
    return this.value.schedule;
  }

  get delivery(): AgentDeliveryMode {
    return this.value.delivery;
  }

  get promptTemplate(): string {
    return this.value.promptTemplate;
  }

  get chatId(): string {
    return this.value.chatId;
  }

  get context(): AgentTaskContext | null {
    return this.value.context ? { ...this.value.context } : null;
  }

  /**
   * The next fire strictly after `after` (defaults to now), or null when
   * the task never fires again: a spent one-shot, or a cron expression with
   * no occurrence inside the search horizon.
   */
  nextRunAt(after: Date = new Date()): Date | null {
    const schedule = this.value.schedule;
    if (schedule.kind === "once") {
      const runAt = new Date(schedule.runAt);
      return runAt > after ? runAt : null;
    }
    return CronExpression.parse(schedule.expression).nextAfter(after);
  }

  withEnabled(enabled: boolean, now: string): AgentScheduledTask {
    return new AgentScheduledTask({
      ...this.value,
      enabled,
      updatedAt: now,
    });
  }

  withLastRun(now: string): AgentScheduledTask {
    return new AgentScheduledTask({
      ...this.value,
      lastRunAt: now,
      updatedAt: now,
    });
  }

  snapshot(): AgentScheduledTaskSnapshot {
    return {
      ...this.value,
      schedule: { ...this.value.schedule },
      context: this.value.context ? { ...this.value.context } : null,
    };
  }
}
