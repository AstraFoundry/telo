import { describe, expect, it } from "vitest";

import {
  ARCHIVE_FOLDER_ID,
  type ChatDto,
  type MessageDto,
  type MessagePageInput,
} from "../../../../contracts/src/ipc";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { AgentContextService, buildScopedPrompt } from "./agent-context";

function chatDto(partial: Partial<ChatDto> = {}): ChatDto {
  return {
    id: "design",
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
    chatId: "design",
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

/**
 * Page-based stub mirroring the repository contract: `listMessagePage`
 * returns the `limit` messages older than `beforeMessageId` (or the newest
 * page) in chronological order, with the oldest returned id as cursor.
 */
function telegramStub(
  chats: ReadonlyArray<ChatDto>,
  messagesByChat: Record<string, ReadonlyArray<MessageDto>>,
): TelegramRepository {
  return {
    listChatPage: async () => ({ items: chats, nextCursor: null }),
    listMessagePage: async (chatId: string, input: MessagePageInput) => {
      const messages = messagesByChat[chatId] ?? [];
      const end = input.beforeMessageId
        ? messages.findIndex((message) => message.id === input.beforeMessageId)
        : messages.length;
      const start = Math.max(0, end - (input.limit ?? messages.length));
      const items = messages.slice(start, end);
      return { items, nextCursor: start > 0 ? (items[0]?.id ?? null) : null };
    },
  } as unknown as TelegramRepository;
}

const DESIGN_MESSAGES = [
  messageDto({ id: "design-1", senderName: "Mina", body: "Compact list." }),
  messageDto({
    id: "design-2",
    senderName: "You",
    body: "Agreed.",
    outgoing: true,
  }),
  messageDto({ id: "design-3", senderName: "Lev", body: "Retry flow." }),
  messageDto({ id: "design-4", senderName: "Lev", body: "Divider too." }),
];

describe("AgentContextService", () => {
  it("assembles the chat's most recent unreadCount incoming messages for unread scope", async () => {
    const service = new AgentContextService(
      telegramStub([chatDto({ unreadCount: 2 })], { design: DESIGN_MESSAGES }),
    );

    const preview = await service.preview({
      scope: "unread",
      chatId: "design",
    });

    expect(preview.scope).toBe("unread");
    expect(preview.messages.map((message) => message.messageId)).toEqual([
      "design-3",
      "design-4",
    ]);
    expect(preview.messages[0]).toMatchObject({
      chatId: "design",
      chatTitle: "Telo Design",
      senderName: "Lev",
    });
    expect(preview.redactionCounts).toEqual({
      emails: 0,
      phones: 0,
      tokens: 0,
    });
  });

  it("pages backward until the unread counter is satisfied", async () => {
    const messages = Array.from({ length: 120 }, (_, index) =>
      messageDto({ id: `m${index + 1}`, body: `Message ${index + 1}` }),
    );
    const service = new AgentContextService(
      telegramStub([chatDto({ unreadCount: 105 })], { design: messages }),
    );

    const preview = await service.preview({
      scope: "unread",
      chatId: "design",
    });

    expect(preview.messages).toHaveLength(105);
    expect(preview.messages[0]?.messageId).toBe("m16");
    expect(preview.messages.at(-1)?.messageId).toBe("m120");
  });

  it("returns every matching incoming message when history is exhausted first", async () => {
    const service = new AgentContextService(
      telegramStub([chatDto({ unreadCount: 5 })], { design: DESIGN_MESSAGES }),
    );

    const preview = await service.preview({
      scope: "unread",
      chatId: "design",
    });

    // Three incoming messages exist; the outgoing one never counts as unread.
    expect(preview.messages.map((message) => message.messageId)).toEqual([
      "design-1",
      "design-3",
      "design-4",
    ]);
  });

  it("assembles selected messages in chat order and rejects unknown ids", async () => {
    const service = new AgentContextService(
      telegramStub([chatDto()], { design: DESIGN_MESSAGES }),
    );

    const preview = await service.preview({
      scope: "selected",
      chatId: "design",
      // An outgoing message is fair game: the user selected it explicitly.
      messageIds: ["design-4", "design-2"],
    });

    expect(preview.messages.map((message) => message.messageId)).toEqual([
      "design-2",
      "design-4",
    ]);

    await expect(
      service.preview({
        scope: "selected",
        chatId: "design",
        messageIds: ["design-2", "nope"],
      }),
    ).rejects.toThrow("Unknown message id in chat design: nope");
  });

  it("describes media-only messages by kind instead of a blank body", async () => {
    const service = new AgentContextService(
      telegramStub([chatDto()], {
        design: [
          messageDto({
            id: "media-1",
            body: "",
            media: {
              id: "design/media-1",
              kind: "photo",
              fileName: "shot.png",
              mimeType: "image/png",
              size: null,
              width: 640,
              height: 480,
              duration: null,
              spoiler: false,
            },
          }),
        ],
      }),
    );

    const preview = await service.preview({
      scope: "selected",
      chatId: "design",
      messageIds: ["media-1"],
    });

    expect(preview.messages[0]?.body).toBe("[photo]");
  });

  it("collects unread messages across the folder's chats, excluding the Archive from All", async () => {
    const service = new AgentContextService(
      telegramStub(
        [
          chatDto({
            id: "design",
            title: "Telo Design",
            unreadCount: 1,
            folderId: 2,
          }),
          chatDto({
            id: "product",
            title: "Product",
            unreadCount: 1,
            folderId: 2,
          }),
          chatDto({
            id: "offsite",
            title: "Offsite",
            unreadCount: 1,
            folderId: ARCHIVE_FOLDER_ID,
          }),
        ],
        {
          design: [messageDto({ id: "design-4", chatId: "design" })],
          product: [messageDto({ id: "product-1", chatId: "product" })],
          offsite: [messageDto({ id: "offsite-1", chatId: "offsite" })],
        },
      ),
    );

    const all = await service.preview({ scope: "folder", folderId: null });
    expect(
      all.messages.map((message) => [message.chatId, message.messageId]),
    ).toEqual([
      ["design", "design-4"],
      ["product", "product-1"],
    ]);

    const work = await service.preview({ scope: "folder", folderId: 2 });
    expect(work.messages.map((message) => message.messageId)).toEqual([
      "design-4",
      "product-1",
    ]);

    const archive = await service.preview({
      scope: "folder",
      folderId: ARCHIVE_FOLDER_ID,
    });
    expect(archive.messages.map((message) => message.messageId)).toEqual([
      "offsite-1",
    ]);
  });

  it("validates the scope input instead of guessing", async () => {
    const service = new AgentContextService(telegramStub([chatDto()], {}));

    await expect(service.preview({ scope: "unread" })).rejects.toThrow(
      'Agent scope "unread" requires a chatId.',
    );
    await expect(
      service.preview({ scope: "selected", chatId: "design" }),
    ).rejects.toThrow('Agent scope "selected" requires message ids.');
    await expect(
      service.preview({ scope: "unread", chatId: "nope" }),
    ).rejects.toThrow("Unknown chat: nope");
  });

  it("redacts the assembled payload and reports the counts", async () => {
    const service = new AgentContextService(
      telegramStub([chatDto({ unreadCount: 1 })], {
        design: [
          messageDto({
            id: "design-4",
            body: "Mail lev@example.com or call +1 415 555 2671.",
          }),
        ],
      }),
    );

    const preview = await service.preview({
      scope: "unread",
      chatId: "design",
    });

    expect(preview.messages[0]?.body).toBe(
      "Mail [redacted email] or call [redacted phone].",
    );
    expect(preview.redactionCounts).toEqual({
      emails: 1,
      phones: 1,
      tokens: 0,
    });
  });
});

describe("buildScopedPrompt", () => {
  const context = {
    scope: "unread" as const,
    messages: [
      {
        messageId: "design-4",
        chatId: "design",
        chatTitle: "Telo Design",
        senderName: "Lev",
        body: "Ship the\nretry flow.",
        sentAt: "2026-08-27T14:28:00.000Z",
      },
    ],
    redactionCounts: { emails: 0, phones: 0, tokens: 0 },
  };

  it("wraps the payload in input markers ahead of the prompt", () => {
    expect(buildScopedPrompt("Summarize", context)).toBe(
      [
        "[[telo-input]]",
        "id: design-4 | Lev: Ship the retry flow.",
        "[[/telo-input]]",
        "Cite the source message of every point with [[telo-cite:<message id>]] on its own line.",
        "",
        "Summarize",
      ].join("\n"),
    );
  });

  it("groups payloads by chat when a scope spans several", () => {
    expect(
      buildScopedPrompt("Summarize", {
        ...context,
        messages: [
          context.messages[0],
          {
            ...context.messages[0],
            messageId: "product-1",
            chatId: "product",
            chatTitle: "Product",
          },
          { ...context.messages[0], messageId: "design-5" },
        ],
      }),
    ).toBe(
      [
        "[[telo-input]]",
        "chat: Telo Design",
        "id: design-4 | Lev: Ship the retry flow.",
        "chat: Product",
        "id: product-1 | Lev: Ship the retry flow.",
        "chat: Telo Design",
        "id: design-5 | Lev: Ship the retry flow.",
        "[[/telo-input]]",
        "Cite the source message of every point with [[telo-cite:<message id>]] on its own line.",
        "",
        "Summarize",
      ].join("\n"),
    );
  });

  it("sends the bare prompt when the scope has no messages", () => {
    expect(buildScopedPrompt("Summarize", { ...context, messages: [] })).toBe(
      "Summarize",
    );
  });
});
