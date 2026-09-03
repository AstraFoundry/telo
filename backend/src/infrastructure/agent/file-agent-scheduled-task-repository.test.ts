import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AgentScheduledTask } from "../../domain/agent/agent-scheduled-task";
import { FileAgentScheduledTaskRepository } from "./file-agent-scheduled-task-repository";

const NOW = "2026-09-03T12:00:00.000Z";

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "telo-agent-tasks-"));
  return path.join(directory, "agent-scheduled-tasks.json");
}

function task(taskId: string, name: string): AgentScheduledTask {
  return AgentScheduledTask.create({
    taskId,
    name,
    schedule: { kind: "cron", expression: "0 9 * * *" },
    promptTemplate: "Summarize unread",
    chatId: "chat-1",
    createdBy: "user",
    now: NOW,
  });
}

describe("FileAgentScheduledTaskRepository", () => {
  it("returns an empty list when the file is missing", async () => {
    const repository = new FileAgentScheduledTaskRepository(
      await temporaryFile(),
    );

    expect(await repository.list()).toEqual([]);
  });

  it("persists tasks across instances in creation order", async () => {
    const filePath = await temporaryFile();

    await new FileAgentScheduledTaskRepository(filePath).save(
      task("t1", "One"),
    );
    await new FileAgentScheduledTaskRepository(filePath).save(
      task("t2", "Two"),
    );

    const restored = await new FileAgentScheduledTaskRepository(
      filePath,
    ).list();
    expect(restored.map((entry) => entry.taskId)).toEqual(["t1", "t2"]);
    expect(restored[0].snapshot()).toEqual(task("t1", "One").snapshot());
  });

  it("updates an existing task instead of duplicating it", async () => {
    const filePath = await temporaryFile();
    const repository = new FileAgentScheduledTaskRepository(filePath);

    await repository.save(task("t1", "One"));
    await repository.save(
      task("t1", "Renamed").withLastRun("2026-09-03T13:00:00.000Z"),
    );

    const restored = await repository.list();
    expect(restored).toHaveLength(1);
    expect(restored[0].snapshot().name).toBe("Renamed");
    expect(restored[0].snapshot().lastRunAt).toBe("2026-09-03T13:00:00.000Z");
  });

  it("removes a task by id", async () => {
    const filePath = await temporaryFile();
    const repository = new FileAgentScheduledTaskRepository(filePath);

    await repository.save(task("t1", "One"));
    await repository.save(task("t2", "Two"));
    await repository.remove("t1");

    expect((await repository.list()).map((entry) => entry.taskId)).toEqual([
      "t2",
    ]);
  });

  it("stores tasks as plain JSON with a restrictive file mode", async () => {
    const filePath = await temporaryFile();

    await new FileAgentScheduledTaskRepository(filePath).save(
      task("t1", "One"),
    );

    const stored = JSON.parse(await readFile(filePath, "utf8")) as {
      tasks: Array<{ taskId: string }>;
    };
    expect(stored.tasks.map((entry) => entry.taskId)).toEqual(["t1"]);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("rejects snapshots that fail domain validation", async () => {
    const filePath = await temporaryFile();
    await writeFile(
      filePath,
      JSON.stringify({
        tasks: [
          {
            ...task("t1", "One").snapshot(),
            schedule: { kind: "cron", expression: "not a cron" },
          },
        ],
      }),
    );

    await expect(
      new FileAgentScheduledTaskRepository(filePath).list(),
    ).rejects.toThrow();
  });

  it("rejects corrupted JSON instead of falling back", async () => {
    const filePath = await temporaryFile();
    await writeFile(filePath, "{ not json");

    await expect(
      new FileAgentScheduledTaskRepository(filePath).list(),
    ).rejects.toThrow();
  });
});
