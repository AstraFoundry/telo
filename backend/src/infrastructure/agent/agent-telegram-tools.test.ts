import { describe, expect, it, vi } from "vitest";

import type { ChatDto, MessageDto } from "../../../../contracts/src/ipc";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { createAgentTelegramTools } from "./agent-telegram-tools";

function repository(): TelegramRepository {
  return {
    subscribe: vi.fn(() => () => {}),
    listChatPage: vi.fn(async () => ({ items: [], nextCursor: null })),
    createSecretChat: vi.fn(),
    openSavedMessages: vi.fn(),
    listFolders: vi.fn(async () => []),
    listMessagePage: vi.fn(async () => ({ items: [], nextCursor: null })),
    listSharedMedia: vi.fn(async () => ({ items: [], nextCursor: null })),
    listPinnedMessages: vi.fn(async () => []),
    listChatMembers: vi.fn(async () => []),
    getPeerProfile: vi.fn(),
    listStickerSets: vi.fn(async () => []),
    getStickerCatalog: vi.fn(async () => ({
      recent: [],
      favorites: [],
      sets: [],
    })),
    reorderStickerSets: vi.fn(async () => undefined),
    setStickerFavorite: vi.fn(async () => undefined),
    removeRecentSticker: vi.fn(async () => undefined),
    clearRecentStickers: vi.fn(async () => undefined),
    searchStickers: vi.fn(async () => []),
    sendSticker: vi.fn(),
    getStickerSet: vi.fn(),
    getCustomEmoji: vi.fn(async () => []),
    setStickerSetInstalled: vi.fn(),
    searchGlobal: vi.fn(async () => ({ chats: [], messages: [] })),
    searchMessages: vi.fn(async () => ({
      messageIds: [],
      totalCount: 0,
      nextCursor: null,
    })),
    getCurrentUser: vi.fn(),
    sendMessage: vi.fn(),
    downloadMedia: vi.fn(),
    cancelMediaDownload: vi.fn(),
    resolveMediaFile: vi.fn(),
    sendMedia: vi.fn(),
    cancelMediaUpload: vi.fn(),
    editMessage: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
    forwardMessage: vi.fn(async () => undefined),
    answerBotCallback: vi.fn(async () => ({ kind: "none" }) as const),
    setMessageReaction: vi.fn(async () => undefined),
    listAvailableReactions: vi.fn(async () => []),
    clickAnimatedEmoji: vi.fn(async () => null),
    setChatPinned: vi.fn(async () => undefined),
    setChatMuted: vi.fn(async () => undefined),
    setChatRead: vi.fn(async () => undefined),
    setChatArchived: vi.fn(async () => undefined),
    setTyping: vi.fn(async () => undefined),
    saveDraft: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
  };
}

function chat(overrides: Partial<ChatDto> = {}): ChatDto {
  return {
    id: "chat-1",
    title: "Telo Design",
    preview: "",
    updatedAt: "2026-09-03T00:00:00.000Z",
    unreadCount: 3,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "group",
    initials: "TD",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    ...overrides,
  };
}

function message(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: "m-1",
    chatId: "chat-1",
    senderName: "Mina",
    senderId: "user-1",
    senderAvatarUrl: null,
    body: "Ship it",
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-09-03T10:00:00.000Z",
    outgoing: false,
    status: "sent",
    ...overrides,
  };
}

// The AI SDK types execute as (input, options); the tools only read input.
function run<Output>(execute: unknown, input: unknown): Promise<Output> {
  return (execute as (input: unknown) => Promise<Output>)(input);
}

describe("createAgentTelegramTools", () => {
  it("listChats defaults the limit and maps chat fields", async () => {
    const telegram = repository();
    vi.mocked(telegram.listChatPage).mockResolvedValue({
      items: [
        chat({ folderId: 7 }),
        chat({ id: "chat-2", title: "Muted", muted: true, unreadCount: 0 }),
      ],
      nextCursor: null,
    });
    const tools = createAgentTelegramTools(telegram);

    const result = await run<ReadonlyArray<unknown>>(
      tools.listChats.execute,
      {},
    );

    expect(telegram.listChatPage).toHaveBeenCalledWith({ limit: 50 });
    expect(result).toEqual([
      {
        id: "chat-1",
        title: "Telo Design",
        kind: "group",
        unreadCount: 3,
        muted: false,
        folderId: 7,
      },
      {
        id: "chat-2",
        title: "Muted",
        kind: "group",
        unreadCount: 0,
        muted: true,
        folderId: null,
      },
    ]);
  });

  it("listChats forwards an explicit limit", async () => {
    const telegram = repository();
    const tools = createAgentTelegramTools(telegram);

    await run(tools.listChats.execute, { limit: 10 });

    expect(telegram.listChatPage).toHaveBeenCalledWith({ limit: 10 });
  });

  it("readChatHistory maps fields and redacts emails, phones, and tokens", async () => {
    const telegram = repository();
    vi.mocked(telegram.listMessagePage).mockResolvedValue({
      items: [
        message({
          senderName: "Mina +1 415 555 2671",
          body: "Mail mina@example.com with sk-test-ABCDefgh1234",
        }),
      ],
      nextCursor: null,
    });
    const tools = createAgentTelegramTools(telegram);

    const result = await run<ReadonlyArray<Record<string, unknown>>>(
      tools.readChatHistory.execute,
      { chatId: "chat-1" },
    );

    expect(telegram.listMessagePage).toHaveBeenCalledWith("chat-1", {
      limit: 30,
    });
    expect(result).toEqual([
      {
        messageId: "m-1",
        senderName: "Mina [redacted phone]",
        body: "Mail [redacted email] with [redacted token]",
        sentAt: "2026-09-03T10:00:00.000Z",
        outgoing: false,
      },
    ]);
  });

  it("readChatHistory forwards an explicit limit", async () => {
    const telegram = repository();
    const tools = createAgentTelegramTools(telegram);

    await run(tools.readChatHistory.execute, { chatId: "chat-1", limit: 5 });

    expect(telegram.listMessagePage).toHaveBeenCalledWith("chat-1", {
      limit: 5,
    });
  });

  it("searchChatMessages forwards the query with the capped limit", async () => {
    const telegram = repository();
    vi.mocked(telegram.searchMessages).mockResolvedValue({
      messageIds: ["m-9"],
      totalCount: 4,
      nextCursor: "m-9",
    });
    const tools = createAgentTelegramTools(telegram);

    const result = await run<Record<string, unknown>>(
      tools.searchChatMessages.execute,
      { chatId: "chat-1", query: "deploy" },
    );

    expect(telegram.searchMessages).toHaveBeenCalledWith("chat-1", "deploy", {
      limit: 20,
    });
    expect(result).toEqual({ messageIds: ["m-9"], totalCount: 4 });
  });

  it("searchGlobal maps chat essentials and redacts message hits", async () => {
    const telegram = repository();
    vi.mocked(telegram.searchGlobal).mockResolvedValue({
      chats: [chat()],
      messages: [message({ body: "the key sk-live_ABCDEFGH1234 leaked" })],
    });
    const tools = createAgentTelegramTools(telegram);

    const result = await run<{
      chats: ReadonlyArray<Record<string, unknown>>;
      messages: ReadonlyArray<Record<string, unknown>>;
    }>(tools.searchGlobal.execute, { query: "key" });

    expect(telegram.searchGlobal).toHaveBeenCalledWith("key");
    expect(result.chats).toEqual([
      {
        id: "chat-1",
        title: "Telo Design",
        kind: "group",
        unreadCount: 3,
        muted: false,
        folderId: null,
      },
    ]);
    expect(result.messages[0]?.body).toBe("the key [redacted token] leaked");
    expect(result.messages[0]?.messageId).toBe("m-1");
  });
});
