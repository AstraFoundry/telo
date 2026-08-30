import { describe, expect, it } from "vitest";

import type {
  ChatDto,
  MessageDto,
  RunAgentInput,
} from "../../../../contracts/src/ipc";
import { hashAgentPrompt } from "../../domain/agent/agent-audit";
import type { AgentAuditRecord } from "../../domain/agent/agent-audit";
import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type {
  AgentAuditRepository,
  AgentConfigurationRepository,
  AgentGateway,
  AgentThreadRepository,
} from "../../domain/agent/agent-ports";
import { AgentThread } from "../../domain/agent/agent-thread";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { AgentContextService } from "./agent-context";
import { RunAgentService } from "./run-agent";

const input: RunAgentInput = {
  threadId: "thread-1",
  prompt: "Summarize",
  scope: { scope: "unread", chatId: "chat" },
  context: {
    activeChat: null,
    visibleChats: [],
    visibleMessages: [],
    components: [],
  },
};

function chatDto(partial: Partial<ChatDto> = {}): ChatDto {
  return {
    id: "chat",
    title: "Telo Design",
    preview: "Ship it.",
    updatedAt: "2026-08-27T14:32:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "group",
    initials: "TD",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    folderId: null,
    ...partial,
  };
}

function messageDto(partial: Partial<MessageDto> = {}): MessageDto {
  return {
    id: "m1",
    chatId: "chat",
    senderName: "Lev",
    body: "Ship the retry flow.",
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-08-27T14:28:00.000Z",
    outgoing: false,
    status: "read",
    ...partial,
  };
}

// The context service only reads chat and message pages; the rest of the
// repository surface is irrelevant here.
function telegramStub(
  chats: ReadonlyArray<ChatDto> = [chatDto()],
  messages: ReadonlyArray<MessageDto> = [],
): TelegramRepository {
  return {
    listChatPage: async () => ({ items: chats, nextCursor: null }),
    listMessagePage: async () => ({ items: messages, nextCursor: null }),
  } as unknown as TelegramRepository;
}

function inMemoryAudits(): AgentAuditRepository & {
  records: AgentAuditRecord[];
} {
  const store = {
    records: [] as AgentAuditRecord[],
    async append(record: AgentAuditRecord) {
      store.records.push(record);
    },
    async listRecent(limit: number) {
      return store.records.slice(-limit).reverse();
    },
  };
  return store;
}

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

function makeService(
  gateway: AgentGateway,
  threads: AgentThreadRepository,
  telegram: TelegramRepository = telegramStub(),
  audits: AgentAuditRepository = inMemoryAudits(),
): RunAgentService {
  return new RunAgentService(
    configurationRepository(),
    gateway,
    threads,
    new AgentContextService(telegram),
    audits,
  );
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
    const service = makeService(
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
    const service = makeService(
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
    const service = makeService(
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
    const service = makeService(
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
    const service = makeService(gatewayYielding([]), threads);

    await collect(service);

    expect(threads.threads.get("thread-1")?.snapshot().messages).toHaveLength(
      1,
    );
  });

  it("sends the bare prompt when the scope matches no messages", async () => {
    const threads = inMemoryThreads();
    const audits = inMemoryAudits();
    let seenPrompt: string | null = null;
    const service = makeService(
      gatewayYielding([{ type: "text", delta: "Done" }], (streamInput) => {
        seenPrompt = streamInput.prompt;
      }),
      threads,
      telegramStub([chatDto({ unreadCount: 0 })]),
      audits,
    );

    await collect(service);

    expect(seenPrompt).toBe("Summarize");
    expect(audits.records).toHaveLength(1);
    expect(audits.records[0]).toMatchObject({
      scope: "unread",
      messageIds: [],
      redactionCounts: { emails: 0, phones: 0, tokens: 0 },
    });
  });

  it("embeds the redacted scoped payload ahead of the user prompt", async () => {
    const threads = inMemoryThreads();
    let seenPrompt: string | null = null;
    const service = makeService(
      gatewayYielding([{ type: "text", delta: "Done" }], (streamInput) => {
        seenPrompt = streamInput.prompt;
      }),
      threads,
      telegramStub(
        [chatDto({ unreadCount: 1 })],
        [
          messageDto({
            id: "design-4",
            senderName: "Lev",
            body: "Reach me at lev@example.com about the retry flow.",
          }),
        ],
      ),
    );

    await collect(service);

    expect(seenPrompt).toBe(
      [
        "[[telo-input]]",
        "id: design-4 | Lev: Reach me at [redacted email] about the retry flow.",
        "[[/telo-input]]",
        "Cite the source message of every point with [[telo-cite:<message id>]] on its own line.",
        "",
        "Summarize",
      ].join("\n"),
    );
    // The transcript keeps the bare user prompt, not the machine payload.
    const stored = threads.threads.get("thread-1")?.snapshot();
    expect(stored?.messages[0]?.body).toBe("Summarize");
  });

  it("audits the run with scope, message ids, redaction counts, model, and the prompt hash", async () => {
    const threads = inMemoryThreads();
    const audits = inMemoryAudits();
    let seenPrompt: string | null = null;
    const service = makeService(
      gatewayYielding([{ type: "text", delta: "Done" }], (streamInput) => {
        seenPrompt = streamInput.prompt;
      }),
      threads,
      telegramStub(
        [chatDto({ unreadCount: 1 })],
        [
          messageDto({
            id: "design-4",
            body: "Call +1 415 555 2671 or mail lev@example.com with sk-1234567890abcdefgh.",
          }),
        ],
      ),
      audits,
    );

    await collect(service);

    expect(audits.records).toHaveLength(1);
    const record = audits.records[0];
    expect(record).toMatchObject({
      action: "run",
      threadId: "thread-1",
      scope: "unread",
      messageIds: ["design-4"],
      redactionCounts: { emails: 1, phones: 1, tokens: 1 },
      model: "gpt-4.1-mini",
    });
    // The audit stores the hash of the exact gateway prompt, never the text.
    expect(record.promptHash).toBe(await hashAgentPrompt(seenPrompt ?? ""));
    expect(record.promptHash).not.toContain("Summarize");
  });

  it("fails the run without auditing when the scope cannot be assembled", async () => {
    const threads = inMemoryThreads();
    const audits = inMemoryAudits();
    const service = makeService(
      gatewayYielding([{ type: "text", delta: "Done" }]),
      threads,
      telegramStub(),
      audits,
    );

    const output = await collect(service, {
      ...input,
      scope: { scope: "unread", chatId: "unknown-chat" },
    });

    expect(output).toEqual([
      { type: "error", message: "Unknown chat: unknown-chat" },
    ]);
    expect(audits.records).toHaveLength(0);
    const stored = threads.threads.get("thread-1")?.snapshot();
    expect(
      stored?.messages.map((message) => [message.role, message.error ?? false]),
    ).toEqual([
      ["user", false],
      ["assistant", true],
    ]);
  });
});
