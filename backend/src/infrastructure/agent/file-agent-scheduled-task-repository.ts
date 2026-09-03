import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentScheduledTaskRepository } from "../../domain/agent/agent-ports";
import {
  AgentScheduledTask,
  type AgentScheduledTaskSnapshot,
} from "../../domain/agent/agent-scheduled-task";

interface StoredAgentScheduledTasks {
  readonly tasks: ReadonlyArray<AgentScheduledTaskSnapshot>;
}

const EMPTY_STORE: StoredAgentScheduledTasks = { tasks: [] };

/**
 * Persists agent scheduled tasks in a single JSON file. Tasks hold no
 * secrets, so the file stays plain JSON like `preferences.json`, with the
 * same restrictive file mode.
 */
export class FileAgentScheduledTaskRepository implements AgentScheduledTaskRepository {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ReadonlyArray<AgentScheduledTask>> {
    return (await this.read()).tasks.map((task) =>
      AgentScheduledTask.restore(task),
    );
  }

  async save(task: AgentScheduledTask): Promise<void> {
    const store = await this.read();
    const snapshot = task.snapshot();
    const tasks = store.tasks.some(
      (stored) => stored.taskId === snapshot.taskId,
    )
      ? store.tasks.map((stored) =>
          stored.taskId === snapshot.taskId ? snapshot : stored,
        )
      : [...store.tasks, snapshot];
    await this.write({ tasks });
  }

  async remove(taskId: string): Promise<void> {
    const store = await this.read();
    await this.write({
      tasks: store.tasks.filter((task) => task.taskId !== taskId),
    });
  }

  private async read(): Promise<StoredAgentScheduledTasks> {
    try {
      return JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as StoredAgentScheduledTasks;
    } catch (error) {
      if (isMissingFile(error)) return EMPTY_STORE;
      throw error;
    }
  }

  private async write(store: StoredAgentScheduledTasks): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), {
      mode: 0o600,
    });
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
