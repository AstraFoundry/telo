import { describe, expect, it } from "vitest";

import type { RunAgentInput } from "../../../../contracts/src/ipc";
import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type {
  AgentConfigurationRepository,
  AgentGateway,
  AgentThreadRepository,
} from "../../domain/agent/agent-ports";
import { AgentThread } from "../../domain/agent/agent-thread";
import { RunAgentService } from "./run-agent";

const input: RunAgentInput = {
  threadId: "thread-1",
  prompt: "Summarize",
  context: {
    activeChat: null,
    visibleChats: [],
    visibleMessages: [],
    components: [],
  },
};

function configurationRepository(): AgentConfigurationRepository {
  return {
    get: async () => AgentConfiguration.default(),
    save: async () => undefined,
  };
}

function inMemoryThreads(): AgentThreadRepository & {
  threads: Map<string, AgentThread>;
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

function gatewayYielding(
  outputs: Array<{
    type: "text" | "activity" | "error";
    delta?: string;
    label?: string;
    message?: string;
  }>,
  inspect?: (input: {
    prompt: string;
    history: ReadonlyArray<{ role: string; body: string }>;
  }) => void,
): AgentGateway {
  return {
    async *stream(streamInput) {
      inspect?.(streamInput);
      for (const output of outputs) yield output as never;
    },
  };
}

async function collect(
  service: RunAgentService,
  runInput: RunAgentInput = input,
) {
  const output = [];
  for await (const event of service.execute(runInput)) output.push(event);
  return output;
}

describe("RunAgentService", () => {
  it("streams gateway output with the stored configuration", async () => {
    const threads = inMemoryThreads();
    const service = new RunAgentService(
      configurationRepository(),
      gatewayYielding([
        { type: "activity", label: "Reading workspace" },
        { type: "text", delta: "Done" },
      ]),
      threads,
    );

    const output = await collect(service);

    expect(output).toEqual([
      { type: "activity", label: "Reading workspace" },
      { type: "text", delta: "Done" },
    ]);
  });

  it("adopts an unknown threadId and persists the user message before streaming", async () => {
    const threads = inMemoryThreads();
    let messagesAtStreamStart: number | null = null;
    const service = new RunAgentService(
      configurationRepository(),
      gatewayYielding([{ type: "text", delta: "Done" }], () => {
        messagesAtStreamStart =
          threads.threads.get("thread-1")?.snapshot().messages.length ?? null;
      }),
      threads,
    );

    await collect(service);

    expect(messagesAtStreamStart).toBe(1);
    const stored = threads.threads.get("thread-1")?.snapshot();
    expect(stored?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(stored?.messages[0]?.body).toBe("Summarize");
    expect(stored?.messages[1]?.body).toBe("Done");
    expect(stored?.threadId).toBe("thread-1");
  });

  it("passes the stored history of the thread to the gateway, not other threads'", async () => {
    const threads = inMemoryThreads();
    await threads.saveThread(
      AgentThread.create({
        threadId: "thread-1",
        now: "2026-08-27T10:00:00.000Z",
      })
        .append({
          id: "m1",
          role: "user",
          body: "Earlier question",
          sentAt: "2026-08-27T10:00:00.000Z",
        })
        .append({
          id: "m2",
          role: "assistant",
          body: "Earlier answer",
          sentAt: "2026-08-27T10:01:00.000Z",
        }),
    );
    await threads.saveThread(
      AgentThread.create({
        threadId: "other",
        now: "2026-08-27T09:00:00.000Z",
      }).append({
        id: "m3",
        role: "user",
        body: "Unrelated",
        sentAt: "2026-08-27T09:00:00.000Z",
      }),
    );
    let seen: unknown = null;
    const service = new RunAgentService(
      configurationRepository(),
      gatewayYielding([{ type: "text", delta: "Done" }], (streamInput) => {
        seen = { prompt: streamInput.prompt, history: streamInput.history };
      }),
      threads,
    );

    await collect(service);

    expect(seen).toEqual({
      prompt: "Summarize",
      history: [
        { role: "user", body: "Earlier question" },
        { role: "assistant", body: "Earlier answer" },
      ],
    });
    expect(threads.threads.get("other")?.snapshot().messages).toHaveLength(1);
  });

  it("persists the error as a flagged assistant message when the run fails", async () => {
    const threads = inMemoryThreads();
    const service = new RunAgentService(
      configurationRepository(),
      gatewayYielding([
        { type: "text", delta: "partial" },
        { type: "error", message: "Model exploded" },
      ]),
      threads,
    );

    await collect(service);

    const stored = threads.threads.get("thread-1")?.snapshot();
    expect(
      stored?.messages.map((message) => [
        message.role,
        message.body,
        message.error ?? false,
      ]),
    ).toEqual([
      ["user", "Summarize", false],
      ["assistant", "partial", false],
      ["assistant", "Model exploded", true],
    ]);
  });

  it("keeps only the user message when the agent produces no output", async () => {
    const threads = inMemoryThreads();
    const service = new RunAgentService(
      configurationRepository(),
      gatewayYielding([]),
      threads,
    );

    await collect(service);

    expect(threads.threads.get("thread-1")?.snapshot().messages).toHaveLength(
      1,
    );
  });
});
