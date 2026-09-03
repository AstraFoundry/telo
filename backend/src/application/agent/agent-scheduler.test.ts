import { describe, expect, it, vi } from "vitest";

import type { AgentAutomationEvent } from "../../../../contracts/src/ipc";
import type { AgentScheduledTaskRepository } from "../../domain/agent/agent-ports";
import {
  AgentScheduledTask,
  type AgentTaskSchedule,
} from "../../domain/agent/agent-scheduled-task";
import type { AgentAutomationRunner } from "./agent-automation-runner";
import { AgentScheduler, type AgentSchedulerTimers } from "./agent-scheduler";

// Local-time clock: the cron domain type evaluates in local timezone, so
// expectations are built from the same local fields (10:00:30 → "5 10" is
// exactly 4.5 minutes away).
const NOW = new Date(2026, 8, 3, 10, 0, 30);

interface FakeTimers {
  readonly timers: AgentSchedulerTimers;
  pendingDelay(): number | null;
  fireNext(): void;
}

function fakeTimers(): FakeTimers {
  let pending: { handle: object; callback: () => void; delay: number } | null =
    null;
  return {
    timers: {
      setTimeout: (callback, delay) => {
        const handle = {};
        pending = { handle, callback, delay };
        return handle;
      },
      clearTimeout: (handle) => {
        if (pending?.handle === handle) pending = null;
      },
    },
    pendingDelay: () => pending?.delay ?? null,
    fireNext: () => {
      const current = pending;
      pending = null;
      current?.callback();
    },
  };
}

function inMemoryTasks(
  initial: ReadonlyArray<AgentScheduledTask> = [],
): AgentScheduledTaskRepository & { store: AgentScheduledTask[] } {
  const store = [...initial];
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

function task(
  taskId: string,
  schedule: AgentTaskSchedule,
  overrides: Partial<Parameters<typeof AgentScheduledTask.create>[0]> = {},
): AgentScheduledTask {
  return AgentScheduledTask.create({
    taskId,
    name: `Task ${taskId}`,
    schedule,
    promptTemplate: "Do the thing",
    chatId: `chat-${taskId}`,
    createdBy: "user",
    now: NOW.toISOString(),
    ...overrides,
  });
}

interface RunnerMock {
  readonly runner: AgentAutomationRunner;
  readonly run: ReturnType<typeof vi.fn>;
}

function runnerStub(
  implementation: AgentAutomationRunner["run"] = async () => ({
    status: "sent" as const,
    text: "done",
  }),
): RunnerMock {
  const run = vi.fn(implementation);
  return {
    runner: { run } as unknown as AgentAutomationRunner,
    run,
  };
}

function makeScheduler(
  tasks: AgentScheduledTaskRepository,
  runner: AgentAutomationRunner,
  notify: (event: AgentAutomationEvent) => void,
  timers: FakeTimers,
) {
  return new AgentScheduler(tasks, runner, notify, () => NOW, timers.timers);
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("AgentScheduler", () => {
  it("arms a single timer for the soonest cron occurrence", async () => {
    const timers = fakeTimers();
    const scheduler = makeScheduler(
      inMemoryTasks([
        task("late", { kind: "cron", expression: "10 10 * * *" }),
        task("soon", { kind: "cron", expression: "5 10 * * *" }),
      ]),
      runnerStub().runner,
      vi.fn(),
      timers,
    );

    await scheduler.refresh();

    // 10:00:30 → 10:05:00 is exactly 270 seconds.
    expect(timers.pendingDelay()).toBe(270_000);
  });

  it("fires at the armed instant, persists lastRunAt, and re-arms", async () => {
    const timers = fakeTimers();
    const tasks = inMemoryTasks([
      task("cron", { kind: "cron", expression: "5 10 * * *" }),
    ]);
    const { runner, run } = runnerStub();
    const notify = vi.fn();
    const scheduler = makeScheduler(tasks, runner, notify, timers);

    await scheduler.refresh();
    timers.fireNext();
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      promptTemplate: "Do the thing",
      delivery: "draft-only",
      chatId: "chat-cron",
      scope: null,
    });
    expect(tasks.store[0].snapshot().lastRunAt).toBe(NOW.toISOString());
    expect(notify).toHaveBeenCalledWith({
      type: "automation-run",
      source: "schedule",
      sourceId: "cron",
      sourceName: "Task cron",
      chatId: "chat-cron",
      delivery: "draft-only",
      status: "sent",
      preview: "done",
    });
    // The injected clock has not moved, so the same occurrence re-arms.
    expect(timers.pendingDelay()).toBe(270_000);
  });

  it("passes the task context through as the run scope", async () => {
    const timers = fakeTimers();
    const { runner, run } = runnerStub();
    const scheduler = makeScheduler(
      inMemoryTasks([
        task(
          "scoped",
          { kind: "cron", expression: "5 10 * * *" },
          {
            context: { scope: "unread" },
          },
        ),
      ]),
      runner,
      vi.fn(),
      timers,
    );

    await scheduler.refresh();
    timers.fireNext();
    await flush();

    // create() defaults an unread context's chatId to the delivery chat.
    expect(run).toHaveBeenCalledWith({
      promptTemplate: "Do the thing",
      delivery: "draft-only",
      chatId: "chat-scoped",
      scope: { scope: "unread", chatId: "chat-scoped" },
    });
  });

  it("fires a missed one-shot immediately on start", async () => {
    const timers = fakeTimers();
    const tasks = inMemoryTasks([
      task("once", {
        kind: "once",
        runAt: new Date(2026, 8, 3, 9, 0, 0).toISOString(),
      }),
    ]);
    const { runner, run } = runnerStub();
    const notify = vi.fn();
    const scheduler = makeScheduler(tasks, runner, notify, timers);

    scheduler.start();
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(tasks.store[0].snapshot().lastRunAt).toBe(NOW.toISOString());
    expect(notify).toHaveBeenCalledTimes(1);
    // Spent after firing: nothing remains armed.
    expect(timers.pendingDelay()).toBeNull();
  });

  it("never fires a spent one-shot again", async () => {
    const timers = fakeTimers();
    const spent = task("once", {
      kind: "once",
      runAt: new Date(2026, 8, 3, 9, 0, 0).toISOString(),
    }).withLastRun(new Date(2026, 8, 3, 9, 0, 0).toISOString());
    const { runner, run } = runnerStub();
    const scheduler = makeScheduler(
      inMemoryTasks([spent]),
      runner,
      vi.fn(),
      timers,
    );

    await scheduler.refresh();

    expect(run).not.toHaveBeenCalled();
    expect(timers.pendingDelay()).toBeNull();
  });

  it("never arms a disabled task", async () => {
    const timers = fakeTimers();
    const disabled = task("off", {
      kind: "cron",
      expression: "5 10 * * *",
    }).withEnabled(false, NOW.toISOString());
    const { runner, run } = runnerStub();
    const scheduler = makeScheduler(
      inMemoryTasks([disabled]),
      runner,
      vi.fn(),
      timers,
    );

    await scheduler.refresh();

    expect(run).not.toHaveBeenCalled();
    expect(timers.pendingDelay()).toBeNull();
  });

  it("re-arms a sooner timer when the repository changes", async () => {
    const timers = fakeTimers();
    const tasks = inMemoryTasks([
      task("late", { kind: "cron", expression: "10 10 * * *" }),
    ]);
    const { runner, run } = runnerStub();
    const scheduler = makeScheduler(tasks, runner, vi.fn(), timers);

    await scheduler.refresh();
    // 10:00:30 → 10:10:00.
    expect(timers.pendingDelay()).toBe(570_000);

    await tasks.save(task("soon", { kind: "cron", expression: "2 10 * * *" }));
    await scheduler.refresh();

    // 10:00:30 → 10:02:00.
    expect(timers.pendingDelay()).toBe(90_000);

    timers.fireNext();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].chatId).toBe("chat-soon");
  });

  it("notifies an error outcome when the runner rejects and still re-arms", async () => {
    const timers = fakeTimers();
    const tasks = inMemoryTasks([
      task("cron", { kind: "cron", expression: "5 10 * * *" }),
    ]);
    const { runner } = runnerStub(async () => {
      throw new Error("bad scope");
    });
    const notify = vi.fn();
    const scheduler = makeScheduler(tasks, runner, notify, timers);

    await scheduler.refresh();
    timers.fireNext();
    await flush();

    expect(notify).toHaveBeenCalledWith({
      type: "automation-run",
      source: "schedule",
      sourceId: "cron",
      sourceName: "Task cron",
      chatId: "chat-cron",
      delivery: "draft-only",
      status: "error",
      preview: "",
      error: "bad scope",
    });
    // A failed run still marks lastRunAt (a one-shot attempt is spent) and
    // the cron re-arms for its next occurrence.
    expect(tasks.store[0].snapshot().lastRunAt).toBe(NOW.toISOString());
    expect(timers.pendingDelay()).toBe(270_000);
  });

  it("stop clears the armed timer", async () => {
    const timers = fakeTimers();
    const { runner, run } = runnerStub();
    const scheduler = makeScheduler(
      inMemoryTasks([task("cron", { kind: "cron", expression: "5 10 * * *" })]),
      runner,
      vi.fn(),
      timers,
    );

    await scheduler.refresh();
    expect(timers.pendingDelay()).not.toBeNull();

    scheduler.stop();
    expect(timers.pendingDelay()).toBeNull();

    timers.fireNext();
    await flush();
    expect(run).not.toHaveBeenCalled();
  });
});
