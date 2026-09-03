import { describe, expect, it, vi } from "vitest";

import type { RunChatAgentInput } from "../../../../contracts/src/ipc";
import { AGENT_REFERENCE_INSTRUCTION } from "../../domain/agent/agent-actions";
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
import { RunChatExtractionService } from "./run-chat-extraction";

const input: RunChatAgentInput = {
  threadId: "thread-1",
  chatId: "design",
  chatTitle: "Telo Design",
  promptLabel: "Extract decisions & todos",
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

function auditRepository(): AgentAuditRepository {
  return { append: vi.fn(async () => undefined), listRecent: async () => [] };
}

describe("RunChatExtractionService", () => {
  it("runs the unread scope with the extract marker and grouping task", async () => {
    let seenPrompt: string | null = null;
    const gateway: AgentGateway = {
      suggest: async () => [],
      async *stream(streamInput) {
        seenPrompt = streamInput.prompt;
        yield { type: "text", delta: "Done" } as const;
      },
    };
    const service = new RunChatExtractionService(
      new RunAgentService(
        configurationRepository(),
        gateway,
        inMemoryThreads(),
        contextService(),
        auditRepository(),
      ),
    );

    for await (const output of service.execute(input)) void output;

    expect(seenPrompt).toBe(
      [
        "[[telo-input]]",
        "ref: telo://message/design/design-4 | Lev: Ship the retry flow.",
        "[[/telo-input]]",
        AGENT_REFERENCE_INSTRUCTION,
        "",
        "[[telo-action:extract]]",
        'Extract the decisions, open questions, and action items from the unread messages of the chat "Telo Design". Group them under "Decisions", "Open questions", and "Action items".',
      ].join("\n"),
    );
  });

  it("persists the user-facing label, not the machine prompt", async () => {
    const threads = inMemoryThreads();
    const gateway: AgentGateway = {
      suggest: async () => [],
      async *stream() {
        yield { type: "text", delta: "Extracted" } as const;
      },
    };
    const service = new RunChatExtractionService(
      new RunAgentService(
        configurationRepository(),
        gateway,
        threads,
        contextService(),
        auditRepository(),
      ),
    );

    for await (const output of service.execute(input)) void output;

    const stored = threads.threads.get("thread-1")?.snapshot();
    expect(stored?.messages.map((message) => message.body)).toEqual([
      "Extract decisions & todos",
      "Extracted",
    ]);
  });
});
