import { describe, expect, it } from "vitest";

import type { ChatDto, MessageDto } from "../../../../contracts/src/ipc";
import { KeywordFolder } from "../../domain/keyword-folder/keyword-folder";
import type {
  KeywordFolderChatSource,
  KeywordFolderRepository,
} from "../../domain/keyword-folder/keyword-folder-ports";
import { KeywordFolderService } from "./keyword-folders";

function chat(partial: Partial<ChatDto> & Pick<ChatDto, "id">): ChatDto {
  return {
    title: partial.id,
    preview: "",
    updatedAt: "2026-08-27T14:00:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "direct",
    initials: "C",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    folderId: null,
    ...partial,
  };
}

function message(
  partial: Partial<MessageDto> & Pick<MessageDto, "id" | "chatId" | "body">,
): MessageDto {
  return {
    senderName: "Mina",
    senderId: "demo-mina",
    senderAvatarUrl: null,
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-08-27T14:00:00.000Z",
    outgoing: false,
    status: "read",
    ...partial,
  };
}

function memoryFolders(
  initial: ReadonlyArray<KeywordFolder> = [],
): KeywordFolderRepository {
  const store = new Map(initial.map((folder) => [folder.id, folder]));
  return {
    async list() {
      return [...store.values()];
    },
    async save(folder) {
      store.set(folder.id, folder);
    },
    async remove(id) {
      store.delete(id);
    },
  };
}

function telegram(options: {
  chats?: ReadonlyArray<ChatDto>;
  messages?: ReadonlyArray<MessageDto>;
}): KeywordFolderChatSource {
  const chats = options.chats ?? [];
  const messages = options.messages ?? [];
  return {
    listChatPage: async () => ({ items: [...chats], nextCursor: null }),
    searchGlobal: async (query: string) => {
      const term = query.trim().toLocaleLowerCase();
      return {
        chats: [],
        messages: messages.filter((entry) =>
          entry.body.toLocaleLowerCase().includes(term),
        ),
      };
    },
  };
}

describe("KeywordFolderService", () => {
  it("creates a keyword folder, matches chats by body substring, and sums unread", async () => {
    const design = chat({ id: "design", unreadCount: 3, folderId: 2 });
    const saved = chat({ id: "saved" });
    const service = new KeywordFolderService(
      memoryFolders(),
      telegram({
        chats: [design, saved],
        messages: [
          message({
            id: "design-3",
            chatId: "design",
            body: "This write-up nails the spacing rules.",
          }),
          message({
            id: "saved-1",
            chatId: "saved",
            body: "Release checklist: tests, docs, signed packages.",
          }),
        ],
      }),
    );

    const created = await service.create({
      title: "Spacing",
      query: "SPACING",
    });
    expect(created).toMatchObject({
      id: -1,
      title: "Spacing",
      query: "SPACING",
      kind: "keyword",
      unreadCount: 3,
    });

    const merged = await service.mergeNative([
      { id: 2, title: "Work", unreadCount: 3 },
    ]);
    expect(merged).toEqual([{ id: 2, title: "Work", unreadCount: 3 }, created]);
    expect(service.annotate(design).keywordFolderIds).toEqual([-1]);
    expect(service.annotate(saved).keywordFolderIds).toBeUndefined();
  });

  it("updates, deletes, and notes a newly arrived matching body", async () => {
    const design = chat({ id: "design", unreadCount: 1 });
    const service = new KeywordFolderService(
      memoryFolders([
        KeywordFolder.create({ id: -1, title: "Spacing", query: "spacing" }),
      ]),
      telegram({
        chats: [design],
        messages: [
          message({
            id: "design-1",
            chatId: "design",
            body: "Keep the list compact.",
          }),
        ],
      }),
    );

    await service.mergeNative([]);
    expect(service.annotate(design).keywordFolderIds).toBeUndefined();

    service.noteMessage(
      message({
        id: "design-new",
        chatId: "design",
        body: "The spacing pass landed.",
      }),
    );
    expect(service.annotate(design).keywordFolderIds).toEqual([-1]);

    const updated = await service.update({
      id: -1,
      title: "Retry",
      query: "retry",
    });
    expect(updated).toMatchObject({ title: "Retry", query: "retry", id: -1 });

    await service.remove(-1);
    const merged = await service.mergeNative([]);
    expect(merged).toEqual([]);
  });

  it("rejects unknown ids and an empty query", async () => {
    const service = new KeywordFolderService(memoryFolders(), telegram({}));
    await expect(
      service.update({ id: -1, title: "X", query: "x" }),
    ).rejects.toThrow(/Unknown keyword folder/);
    await expect(service.create({ title: "X", query: "  " })).rejects.toThrow(
      /query is required/,
    );
  });
});
