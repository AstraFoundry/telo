import { describe, expect, it, vi, type Mock } from "vitest";

import type {
  AgentAutomationEvent,
  ChatDto,
  MessageDto,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";
import type { AgentTriggerRuleRepository } from "../../domain/agent/agent-ports";
import { AgentTriggerRule } from "../../domain/agent/agent-trigger-rule";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import type {
  AgentAutomationRunInput,
  AgentAutomationRunResult,
  AutomationRunExecutor,
} from "./agent-automation-runner";
import { AgentTriggerEngine } from "./agent-trigger-engine";

const NOW = "2026-09-03T10:00:00.000Z";

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
    senderId: "demo-lev",
    senderAvatarUrl: null,
    body: "this is urgent",
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-08-27T14:28:00.000Z",
    outgoing: false,
    status: "read",
    ...partial,
  };
}

function rule(
  overrides: Partial<Parameters<typeof AgentTriggerRule.create>[0]> = {},
): AgentTriggerRule {
  return AgentTriggerRule.create({
    ruleId: "rule-1",
    name: "Urgent replies",
    promptTemplate: "Draft a reply",
    createdBy: "user",
    now: NOW,
    match: { keywords: ["urgent"] },
    ...overrides,
  });
}

function rulesRepo(
  rules: ReadonlyArray<AgentTriggerRule>,
): AgentTriggerRuleRepository {
  return {
    list: async () => rules,
    save: async () => undefined,
    remove: async () => undefined,
  };
}

function telegramFake(): {
  telegram: TelegramRepository;
  emit: (event: TelegramWorkspaceEvent) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<(event: TelegramWorkspaceEvent) => void>();
  const telegram = {
    subscribe: (listener: (event: TelegramWorkspaceEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as TelegramRepository;
  return {
    telegram,
    emit: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}

interface RunnerMock {
  readonly runner: AutomationRunExecutor;
  readonly run: Mock<
    (input: AgentAutomationRunInput) => Promise<AgentAutomationRunResult>
  >;
}

function runnerStub(
  implementation: (
    input: AgentAutomationRunInput,
  ) => Promise<AgentAutomationRunResult> = async () => ({
    status: "sent",
    text: "done",
  }),
): RunnerMock {
  const run = vi.fn(implementation);
  return { runner: { run }, run };
}

function incoming(message: MessageDto): TelegramWorkspaceEvent {
  return { type: "message-upsert", cause: "new", message };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("AgentTriggerEngine", () => {
  it("fires a matching rule with the selected scope and reply-to id", async () => {
    const { telegram, emit } = telegramFake();
    const { runner, run } = runnerStub();
    const notify = vi.fn();
    new AgentTriggerEngine(
      rulesRepo([rule()]),
      telegram,
      runner,
      notify,
    ).start();

    emit(incoming(messageDto()));
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      promptTemplate: "Draft a reply",
      delivery: "draft-only",
      chatId: "chat",
      replyToId: "m1",
      scope: { scope: "selected", chatId: "chat", messageIds: ["m1"] },
    });
    expect(notify).toHaveBeenCalledWith({
      type: "automation-run",
      source: "trigger",
      sourceId: "rule-1",
      sourceName: "Urgent replies",
      chatId: "chat",
      delivery: "draft-only",
      status: "sent",
      preview: "done",
    });
  });

  it("never fires for outgoing messages (anti-loop)", async () => {
    const { telegram, emit } = telegramFake();
    const { runner, run } = runnerStub();
    new AgentTriggerEngine(
      rulesRepo([rule()]),
      telegram,
      runner,
      vi.fn(),
    ).start();

    emit(incoming(messageDto({ outgoing: true })));
    await flush();

    expect(run).not.toHaveBeenCalled();
  });

  it("never fires for edits", async () => {
    const { telegram, emit } = telegramFake();
    const { runner, run } = runnerStub();
    new AgentTriggerEngine(
      rulesRepo([rule()]),
      telegram,
      runner,
      vi.fn(),
    ).start();

    emit({ type: "message-upsert", cause: "edited", message: messageDto() });
    await flush();

    expect(run).not.toHaveBeenCalled();
  });

  it("skips muted chats for excludeMuted rules but fires for opted-out rules", async () => {
    const { telegram, emit } = telegramFake();
    const { runner, run } = runnerStub();
    new AgentTriggerEngine(
      rulesRepo([
        rule({ ruleId: "strict" }),
        rule({
          ruleId: "loud",
          match: { keywords: ["urgent"], excludeMuted: false },
        }),
      ]),
      telegram,
      runner,
      vi.fn(),
    ).start();

    emit({
      type: "chats",
      chats: [chatDto({ muted: true })],
      nextCursor: null,
    });
    emit(incoming(messageDto()));
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].promptTemplate).toBe("Draft a reply");
  });

  it("applies chat-mute events live", async () => {
    const { telegram, emit } = telegramFake();
    const { runner, run } = runnerStub();
    new AgentTriggerEngine(
      rulesRepo([rule()]),
      telegram,
      runner,
      vi.fn(),
    ).start();

    emit({ type: "chat-upsert", chat: chatDto({ muted: false }) });
    emit(incoming(messageDto({ id: "m1" })));
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    emit({ type: "chat-mute", chatId: "chat", muted: true });
    emit(incoming(messageDto({ id: "m2" })));
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    emit({ type: "chat-mute", chatId: "chat", muted: false });
    emit(incoming(messageDto({ id: "m3" })));
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not re-enter a rule that is already running", async () => {
    const { telegram, emit } = telegramFake();
    // The tsconfig lib predates Promise.withResolvers; hand-roll the gate.
    let release!: () => void;
    const gate = {
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
      resolve: () => release(),
    };
    const { runner, run } = runnerStub(async () => {
      await gate.promise;
      return { status: "sent", text: "done" };
    });
    const notify = vi.fn();
    new AgentTriggerEngine(
      rulesRepo([rule()]),
      telegram,
      runner,
      notify,
    ).start();

    emit(incoming(messageDto({ id: "m1" })));
    await flush();
    emit(incoming(messageDto({ id: "m2" })));
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    gate.resolve();
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);

    emit(incoming(messageDto({ id: "m3" })));
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("fires every matching rule once per message", async () => {
    const { telegram, emit } = telegramFake();
    const { runner, run } = runnerStub();
    const notify = vi.fn();
    new AgentTriggerEngine(
      rulesRepo([
        rule({ ruleId: "rule-1" }),
        rule({ ruleId: "rule-2", name: "Second" }),
      ]),
      telegram,
      runner,
      notify,
    ).start();

    emit(incoming(messageDto()));
    await flush();

    expect(run).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls.map(([event]) => event.sourceId)).toEqual([
      "rule-1",
      "rule-2",
    ]);
  });

  it("notifies an error outcome when the runner rejects", async () => {
    const { telegram, emit } = telegramFake();
    const runner = runnerStub(async () => {
      throw new Error("bad scope");
    });
    const notify = vi.fn<(event: AgentAutomationEvent) => void>();
    new AgentTriggerEngine(
      rulesRepo([rule()]),
      telegram,
      runner,
      notify,
    ).start();

    emit(incoming(messageDto()));
    await flush();

    expect(notify).toHaveBeenCalledWith({
      type: "automation-run",
      source: "trigger",
      sourceId: "rule-1",
      sourceName: "Urgent replies",
      chatId: "chat",
      delivery: "draft-only",
      status: "error",
      preview: "",
      error: "bad scope",
    });
  });

  it("stops reacting after the stop function is called", async () => {
    const { telegram, emit, listenerCount } = telegramFake();
    const { runner, run } = runnerStub();
    const stop = new AgentTriggerEngine(
      rulesRepo([rule()]),
      telegram,
      runner,
      vi.fn(),
    ).start();

    expect(listenerCount()).toBe(1);
    stop();
    expect(listenerCount()).toBe(0);

    emit(incoming(messageDto()));
    await flush();
    expect(run).not.toHaveBeenCalled();
  });
});
