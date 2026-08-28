import { describe, expect, it } from "vitest";

import type { AgentThreadRepository } from "../../domain/agent/agent-ports";
import { AgentThread } from "../../domain/agent/agent-thread";
import { AgentThreadService } from "./agent-threads";

function inMemoryThreads(): AgentThreadRepository & {
  threads: Map<string, AgentThread>;
  activeThreadId: string | null;
} {
  const store = {
    threads: new Map<string, AgentThread>(),
    activeThreadId: null as string | null,
    async listThreads() {
      return [...store.threads.values()];
    },
    async getThread(threadId: string) {
      return store.threads.get(threadId) ?? null;
    },
    async saveThread(thread: AgentThread) {
      store.threads.set(thread.threadId, thread);
    },
    async getActiveThreadId() {
      return store.activeThreadId;
    },
    async setActiveThreadId(threadId: string) {
      store.activeThreadId = threadId;
    },
  };
  return store;
}

function threadWithMessage(
  threadId: string,
  body: string,
  sentAt: string,
): AgentThread {
  return AgentThread.create({ threadId, now: sentAt }).append({
    id: `${threadId}-msg`,
    role: "user",
    body,
    sentAt,
  });
}

describe("AgentThreadService", () => {
  it("lists summaries newest first with the active thread id", async () => {
    const repository = inMemoryThreads();
    await repository.saveThread(
      threadWithMessage("old", "Old question", "2026-08-27T10:00:00.000Z"),
    );
    await repository.saveThread(
      threadWithMessage("new", "New question", "2026-08-27T12:00:00.000Z"),
    );
    await repository.setActiveThreadId("old");
    const service = new AgentThreadService(repository);

    const list = await service.listThreads();

    expect(list.activeThreadId).toBe("old");
    expect(list.threads.map((thread) => thread.threadId)).toEqual([
      "new",
      "old",
    ]);
    expect(list.threads[0]).toMatchObject({ title: "New question" });
  });

  it("creates an empty thread, persists it, and marks it active", async () => {
    const repository = inMemoryThreads();
    const service = new AgentThreadService(repository);

    const created = await service.createThread();

    expect(created.threadId).toBeTruthy();
    expect(created.title).toBe("");
    expect(created.messages).toEqual([]);
    expect(await repository.getActiveThreadId()).toBe(created.threadId);
    expect(await repository.getThread(created.threadId)).not.toBeNull();
  });

  it("returns null for an unknown thread", async () => {
    const service = new AgentThreadService(inMemoryThreads());

    expect(await service.getThread("missing")).toBeNull();
  });

  it("selects a thread, returning its transcript and marking it active", async () => {
    const repository = inMemoryThreads();
    await repository.saveThread(
      threadWithMessage("thread-1", "Summarize", "2026-08-27T12:00:00.000Z"),
    );
    const service = new AgentThreadService(repository);

    const selected = await service.selectThread("thread-1");

    expect(selected.threadId).toBe("thread-1");
    expect(selected.messages).toEqual([
      {
        id: "thread-1-msg",
        from: "user",
        body: "Summarize",
        sentAt: "2026-08-27T12:00:00.000Z",
      },
    ]);
    expect(await repository.getActiveThreadId()).toBe("thread-1");
  });

  it("rejects selecting an unknown thread", async () => {
    const service = new AgentThreadService(inMemoryThreads());

    await expect(service.selectThread("missing")).rejects.toThrow(
      "Unknown agent thread: missing",
    );
  });

  it("carries the error flag from the transcript into the DTO", async () => {
    const repository = inMemoryThreads();
    await repository.saveThread(
      AgentThread.create({
        threadId: "thread-1",
        now: "2026-08-27T12:00:00.000Z",
      }).append({
        id: "msg-1",
        role: "assistant",
        body: "Provider unavailable",
        sentAt: "2026-08-27T12:00:00.000Z",
        error: true,
      }),
    );
    const service = new AgentThreadService(repository);

    const thread = await service.getThread("thread-1");

    expect(thread?.messages[0]).toMatchObject({
      from: "assistant",
      error: true,
    });
  });
});
