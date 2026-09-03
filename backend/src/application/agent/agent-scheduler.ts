import type { AgentAutomationEvent } from "../../../../contracts/src/ipc";
import type { AgentScheduledTaskRepository } from "../../domain/agent/agent-ports";
import type { AgentScheduledTask } from "../../domain/agent/agent-scheduled-task";
import type { AutomationRunExecutor } from "./agent-automation-runner";

/** setTimeout clamps at 2^31-1 ms; larger delays would fire immediately. */
const MAX_DELAY = 2 ** 31 - 1;

export interface AgentSchedulerTimers {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

const DEFAULT_TIMERS: AgentSchedulerTimers = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) =>
    clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};

/**
 * Fires scheduled agent tasks on a single re-armed timer. `refresh` is the
 * whole scheduling step: it fires missed one-shots (an enabled `once` task
 * whose instant passed while the app was down and that never ran) and arms
 * one timer for the soonest upcoming fire. Every completed run re-enters
 * `refresh`, so cron tasks re-arm and spent one-shots drop out. Clock and
 * timers are injectable for deterministic tests.
 */
export class AgentScheduler {
  private timer: unknown = null;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly tasks: AgentScheduledTaskRepository,
    private readonly runner: AutomationRunExecutor,
    private readonly notify: (event: AgentAutomationEvent) => void,
    private readonly now: () => Date = () => new Date(),
    private readonly timers: AgentSchedulerTimers = DEFAULT_TIMERS,
  ) {}

  start(): void {
    // A corrupt store must not kill the main process; per-run failures are
    // reported through notify instead.
    void this.refresh().catch((error) => {
      console.error("Agent scheduler refresh failed", error);
    });
  }

  stop(): void {
    this.clearTimer();
  }

  async refresh(): Promise<void> {
    this.clearTimer();
    const now = this.now();
    const missed: AgentScheduledTask[] = [];
    let soonest: { task: AgentScheduledTask; at: Date } | null = null;
    for (const task of await this.tasks.list()) {
      if (!task.enabled) continue;
      const snapshot = task.snapshot();
      if (
        snapshot.schedule.kind === "once" &&
        snapshot.lastRunAt === null &&
        new Date(snapshot.schedule.runAt).getTime() <= now.getTime()
      ) {
        missed.push(task);
        continue;
      }
      const at = task.nextRunAt(now);
      if (at && (!soonest || at.getTime() < soonest.at.getTime())) {
        soonest = { task, at };
      }
    }
    await Promise.all(missed.map((task) => this.fire(task)));
    if (soonest) {
      const { task, at } = soonest;
      const delay = Math.min(
        Math.max(at.getTime() - now.getTime(), 0),
        MAX_DELAY,
      );
      this.timer = this.timers.setTimeout(() => void this.fire(task), delay);
    }
  }

  private async fire(task: AgentScheduledTask): Promise<void> {
    if (this.inFlight.has(task.taskId)) return;
    this.inFlight.add(task.taskId);
    try {
      let outcome;
      try {
        outcome = await this.runner.run({
          promptTemplate: task.promptTemplate,
          delivery: task.delivery,
          chatId: task.chatId,
          scope: task.context ? { ...task.context } : null,
        });
      } catch (error) {
        outcome = {
          status: "error" as const,
          text: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      // lastRunAt is persisted even for failed runs: a one-shot is spent
      // once attempted, and a cron's next occurrence comes from the clock.
      await this.tasks.save(task.withLastRun(this.now().toISOString()));
      this.notify({
        type: "automation-run",
        source: "schedule",
        sourceId: task.taskId,
        sourceName: task.snapshot().name,
        chatId: task.chatId,
        delivery: task.delivery,
        status: outcome.status,
        preview: outcome.text.slice(0, 200),
        ...(outcome.error ? { error: outcome.error } : {}),
      });
    } finally {
      this.inFlight.delete(task.taskId);
      // Re-arm: cron occurrences move forward, spent one-shots drop out.
      void this.refresh().catch((error) => {
        console.error("Agent scheduler refresh failed", error);
      });
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
