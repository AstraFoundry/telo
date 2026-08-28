import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AgentThread } from "../../domain/agent/agent-thread";
import { FileAgentThreadRepository } from "./file-agent-thread-repository";

const NOW = "2026-08-27T12:00:00.000Z";

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "telo-agent-threads-"),
  );
  return path.join(directory, "agent-threads.json");
}

function threadWithMessage(threadId: string, body: string): AgentThread {
  return AgentThread.create({ threadId, now: NOW }).append({
    id: `${threadId}-msg`,
    role: "user",
    body,
    sentAt: NOW,
  });
}

describe("FileAgentThreadRepository", () => {
  it("returns an empty list and no active thread when the file is missing", async () => {
    const repository = new FileAgentThreadRepository(await temporaryFile());

    expect(await repository.listThreads()).toEqual([]);
    expect(await repository.getThread("thread-1")).toBeNull();
    expect(await repository.getActiveThreadId()).toBeNull();
  });

  it("persists threads and the active thread id across instances", async () => {
    const filePath = await temporaryFile();
    const repository = new FileAgentThreadRepository(filePath);

    await repository.saveThread(threadWithMessage("thread-1", "First"));
    await repository.saveThread(threadWithMessage("thread-2", "Second"));
    await repository.setActiveThreadId("thread-2");

    const reloaded = new FileAgentThreadRepository(filePath);
    expect((await reloaded.listThreads()).map((t) => t.threadId)).toEqual([
      "thread-1",
      "thread-2",
    ]);
    expect(await reloaded.getActiveThreadId()).toBe("thread-2");
    expect(
      (await reloaded.getThread("thread-1"))?.snapshot().messages,
    ).toHaveLength(1);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("updates an existing thread instead of duplicating it", async () => {
    const filePath = await temporaryFile();
    const repository = new FileAgentThreadRepository(filePath);

    await repository.saveThread(threadWithMessage("thread-1", "First"));
    const updated = (await repository.getThread("thread-1"))?.append({
      id: "msg-2",
      role: "assistant",
      body: "Done",
      sentAt: "2026-08-27T12:05:00.000Z",
    });
    if (!updated) throw new Error("thread missing after save");
    await repository.saveThread(updated);

    const threads = await repository.listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0]?.snapshot().messages).toHaveLength(2);
    expect(threads[0]?.snapshot().updatedAt).toBe("2026-08-27T12:05:00.000Z");
  });

  it("stores transcripts as plain JSON without secrets", async () => {
    const filePath = await temporaryFile();
    const repository = new FileAgentThreadRepository(filePath);

    await repository.saveThread(threadWithMessage("thread-1", "Plain text"));

    expect(await readFile(filePath, "utf8")).toContain("Plain text");
  });

  it("rejects corrupted JSON instead of falling back", async () => {
    const filePath = await temporaryFile();
    await writeFile(filePath, "not json");
    const repository = new FileAgentThreadRepository(filePath);

    await expect(repository.listThreads()).rejects.toThrow(SyntaxError);
  });

  it("round-trips the error flag on persisted messages", async () => {
    const filePath = await temporaryFile();
    const repository = new FileAgentThreadRepository(filePath);

    await repository.saveThread(
      AgentThread.create({ threadId: "thread-1", now: NOW }).append({
        id: "msg-1",
        role: "assistant",
        body: "Provider unavailable",
        sentAt: NOW,
        error: true,
      }),
    );

    const reloaded = new FileAgentThreadRepository(filePath);
    const message = (await reloaded.getThread("thread-1"))?.snapshot()
      .messages[0];
    expect(message).toMatchObject({ error: true });
    expect(await readFile(filePath, "utf8")).toContain('"error": true');
  });
});
