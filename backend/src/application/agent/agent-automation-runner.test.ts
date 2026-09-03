import { describe, expect, it, vi } from "vitest";

import type { ChatDto, MessageDto } from "../../../../contracts/src/ipc";
import { hashAgentPrompt } from "../../domain/agent/agent-audit";
import type { AgentAuditRecord } from "../../domain/agent/agent-audit";
import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type {
  AgentAuditRepository,
  AgentConfigurationRepository,
  AgentGateway,
} from "../../domain/agent/agent-ports";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { AgentContextService } from "./agent-context";
import {
  AgentAutomationRunner,
  type AgentAutomationRunInput,
} from "./agent-automation-runner";

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

function telegramStub(
  overrides: Partial<TelegramRepository> = {},
): TelegramRepository {
  return {
    listChatPage: async () => ({ items: [chatDto()], nextCursor: null }),
    listMessagePage: async () => ({
      items: [messageDto()],
      nextCursor: null,
    }),
    sendMessage: vi.fn(async () => messageDto()),
    saveDraft: vi.fn(async () => undefined),
    ...overrides,
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

function gatewayYielding(
  outputs: Array<{ type: "text" | "error"; delta?: string; message?: string }>,
  inspect?: (input: { prompt: string }) => void,
): AgentGateway {
  return {
    suggest: async () => [],
    async *stream(streamInput) {
      inspect?.(streamInput);
      for (const output of outputs) yield output as never;
    },
  };
}

function makeRunner(
  gateway: AgentGateway,
  telegram: TelegramRepository = telegramStub(),
  audits: AgentAuditRepository = inMemoryAudits(),
): { runner: AgentAutomationRunner; context: AgentContextService } {
  const context = new AgentContextService(telegram);
  const runner = new AgentAutomationRunner(
    configurationRepository(),
    gateway,
    context,
    telegram,
    audits,
  );
  return { runner, context };
}

function runInput(
  overrides: Partial<AgentAutomationRunInput> = {},
): AgentAutomationRunInput {
  return {
    promptTemplate: "Summarize this",
    delivery: "auto-send",
    chatId: "chat",
    scope: null,
    ...overrides,
  };
}

describe("AgentAutomationRunner", () => {
  it("auto-sends the reply with the reply-to id", async () => {
    const telegram = telegramStub();
    const { runner } = makeRunner(
      gatewayYielding([{ type: "text", delta: "On it." }]),
      telegram,
    );

    const result = await runner.run(runInput({ replyToId: "m1" }));

    expect(result).toEqual({ status: "sent", text: "On it." });
    expect(telegram.sendMessage).toHaveBeenCalledWith("chat", "On it.", "m1");
    expect(telegram.saveDraft).not.toHaveBeenCalled();
  });

  it("saves a draft when the composer is empty", async () => {
    const telegram = telegramStub();
    const { runner } = makeRunner(
      gatewayYielding([{ type: "text", delta: "Draft text" }]),
      telegram,
    );

    const result = await runner.run(runInput({ delivery: "draft-only" }));

    expect(result).toEqual({ status: "draft", text: "Draft text" });
    expect(telegram.saveDraft).toHaveBeenCalledWith("chat", "Draft text");
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("parks as draft-conflict without touching an occupied composer", async () => {
    const telegram = telegramStub({
      listChatPage: async () => ({
        items: [chatDto({ draftPreview: "half-written human draft" })],
        nextCursor: null,
      }),
    });
    const { runner } = makeRunner(
      gatewayYielding([{ type: "text", delta: "Draft text" }]),
      telegram,
    );

    const result = await runner.run(runInput({ delivery: "draft-only" }));

    expect(result).toEqual({ status: "draft-conflict", text: "Draft text" });
    expect(telegram.saveDraft).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("reports gateway error outputs and delivers nothing", async () => {
    const telegram = telegramStub();
    const { runner } = makeRunner(
      gatewayYielding([
        { type: "text", delta: "partial" },
        { type: "error", message: "model exploded" },
      ]),
      telegram,
    );

    const result = await runner.run(runInput());

    expect(result).toEqual({
      status: "error",
      text: "partial",
      error: "model exploded",
    });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(telegram.saveDraft).not.toHaveBeenCalled();
  });

  it("reports an empty reply without delivering", async () => {
    const telegram = telegramStub();
    const { runner } = makeRunner(gatewayYielding([]), telegram);

    const result = await runner.run(runInput());

    expect(result).toEqual({ status: "empty", text: "" });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(telegram.saveDraft).not.toHaveBeenCalled();
  });

  it("sends the bare template when no scope is given and never assembles", async () => {
    const telegram = telegramStub();
    const { runner, context } = makeRunner(
      gatewayYielding([{ type: "text", delta: "ok" }]),
      telegram,
    );
    const assemble = vi.spyOn(context, "assemble");
    let seenPrompt: string | null = null;
    const inspecting = gatewayYielding(
      [{ type: "text", delta: "ok" }],
      ({ prompt }) => {
        seenPrompt = prompt;
      },
    );
    const inspected = new AgentAutomationRunner(
      configurationRepository(),
      inspecting,
      context,
      telegram,
      inMemoryAudits(),
    );

    await runner.run(runInput());
    expect(assemble).not.toHaveBeenCalled();

    await inspected.run(runInput({ promptTemplate: "Bare question?" }));
    expect(seenPrompt).toBe("Bare question?");
  });

  it("assembles the scope into the prompt and audits message ids", async () => {
    const telegram = telegramStub();
    const audits = inMemoryAudits();
    let seenPrompt: string | null = null;
    const gateway = gatewayYielding(
      [{ type: "text", delta: "ok" }],
      ({ prompt }) => {
        seenPrompt = prompt;
      },
    );
    const context = new AgentContextService(telegram);
    const runner = new AgentAutomationRunner(
      configurationRepository(),
      gateway,
      context,
      telegram,
      audits,
    );

    const result = await runner.run(
      runInput({
        scope: { scope: "selected", chatId: "chat", messageIds: ["m1"] },
      }),
    );

    expect(result.status).toBe("sent");
    expect(seenPrompt).toContain("Ship the retry flow.");
    expect(seenPrompt).toContain("Summarize this");
    expect(audits.records).toHaveLength(1);
    expect(audits.records[0].scope).toBe("selected");
    expect(audits.records[0].messageIds).toEqual(["m1"]);
  });

  it("audits a hash of the exact prompt, never the raw text", async () => {
    const telegram = telegramStub();
    const audits = inMemoryAudits();
    const { runner } = makeRunner(
      gatewayYielding([{ type: "text", delta: "ok" }]),
      telegram,
      audits,
    );

    await runner.run(runInput({ promptTemplate: "Secret instruction" }));

    expect(audits.records).toHaveLength(1);
    const record = audits.records[0];
    expect(record.threadId).toBe("automation");
    expect(record.promptHash).toBe(await hashAgentPrompt("Secret instruction"));
    expect(JSON.stringify(record)).not.toContain("Secret instruction");
    expect(record.model).toBe(AgentConfiguration.default().snapshot().model);
  });

  it("propagates invalid scope errors before anything is delivered or audited", async () => {
    const telegram = telegramStub();
    const audits = inMemoryAudits();
    const { runner } = makeRunner(
      gatewayYielding([{ type: "text", delta: "ok" }]),
      telegram,
      audits,
    );

    await expect(
      runner.run(runInput({ scope: { scope: "selected" } })),
    ).rejects.toThrow(/requires a chatId/);
    expect(audits.records).toEqual([]);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });
});
