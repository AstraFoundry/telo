import { describe, expect, it, vi } from "vitest";

import type { RunChatAgentInput } from "../../../../contracts/src/ipc";
import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type {
  AgentAuditRepository,
  AgentConfigurationRepository,
  AgentGateway,
  AgentThreadRepository,
} from "../../domain/agent/agent-ports";
import { AgentThread } from "../../domain/agent/agent-thread";
import type { AgentContextService } from "./agent-context";
import { RunAgentService } from "./run-agent";
import { RunChatSummaryService } from "./run-chat-summary";

const input: RunChatAgentInput = {
  threadId: "thread-1",
  chatId: "design",
  chatTitle: "Telo Design",
  promptLabel: "Summarize unread",
  context: {
    activeChat: { id: "design", title: "Telo Design", kind: "group" },
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

function contextService(): AgentContextService {
  return {
    assemble: async () => ({
      scope: "unread",
      messages: [
        {
          messageId: "design-4",
          chatId: "design",
          chatTitle: "Telo Design",
          senderName: "Lev",
          body: "Ship the retry flow.",
          sentAt: "2026-08-27T14:28:00.000Z",
        },
      ],
      redactionCounts: { emails: 0, phones: 0, tokens: 0 },
    }),
  } as unknown as AgentContextService;
}

function auditRepository(): AgentAuditRepository & {
  append: ReturnType<typeof vi.fn>;
} {
  return { append: vi.fn(async () => undefined), listRecent: async () => [] };
}

function service(
  gateway: AgentGateway,
  threads: AgentThreadRepository,
  audits: AgentAuditRepository,
): RunChatSummaryService {
  return new RunChatSummaryService(
    new RunAgentService(
      configurationRepository(),
      gateway,
      threads,
      contextService(),
      audits,
    ),
  );
}

describe("RunChatSummaryService", () => {
  it("runs the unread scope with the summarize marker and citation convention", async () => {
    let seenPrompt: string | null = null;
    const gateway: AgentGateway = {
      async *stream(streamInput) {
        seenPrompt = streamInput.prompt;
        yield { type: "text", delta: "Done" } as const;
      },
    };

    for await (const output of service(
      gateway,
      inMemoryThreads(),
      auditRepository(),
    ).execute(input))
      void output;

    expect(seenPrompt).toBe(
      [
        "[[telo-input]]",
        "id: design-4 | Lev: Ship the retry flow.",
        "[[/telo-input]]",
        "Cite the source message of every point with [[telo-cite:<message id>]] on its own line.",
        "",
        "[[telo-action:summarize]]",
        'Summarize the unread messages of the chat "Telo Design".',
      ].join("\n"),
    );
  });

  it("persists the user-facing label, not the machine prompt", async () => {
    const threads = inMemoryThreads();
    const gateway: AgentGateway = {
      async *stream() {
        yield { type: "text", delta: "Summary" } as const;
      },
    };

    for await (const output of service(
      gateway,
      threads,
      auditRepository(),
    ).execute(input))
      void output;

    const stored = threads.threads.get("thread-1")?.snapshot();
    expect(stored?.messages.map((message) => message.body)).toEqual([
      "Summarize unread",
      "Summary",
    ]);
  });

  it("audits the run with the scope and cited message ids", async () => {
    const audits = auditRepository();
    const gateway: AgentGateway = {
      async *stream() {
        yield { type: "text", delta: "Summary" } as const;
      },
    };

    for await (const output of service(
      gateway,
      inMemoryThreads(),
      audits,
    ).execute(input))
      void output;

    expect(audits.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "run",
        threadId: "thread-1",
        scope: "unread",
        messageIds: ["design-4"],
      }),
    );
  });
});
