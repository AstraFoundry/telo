import { describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  MessageDto,
  StickerSetReferenceDto,
} from "../../../../contracts/src/ipc";
import { KeywordFolder } from "../../domain/keyword-folder/keyword-folder";
import type { KeywordFolderRepository } from "../../domain/keyword-folder/keyword-folder-ports";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { KeywordFolderService } from "../keyword-folder/keyword-folders";
import { TelegramWorkspaceService } from "./telegram-workspace";

function repository(): TelegramRepository {
  return {
    subscribe: vi.fn(() => () => {}),
    listChatPage: vi.fn(async () => ({ items: [], nextCursor: null })),
    createSecretChat: vi.fn(async (userId: string) => ({
      id: `secret-${userId}`,
      title: "Secret",
      preview: "",
      updatedAt: "2026-01-01T00:00:00.000Z",
      unreadCount: 0,
      lastReadMessageId: null,
      muted: false,
      pinned: false,
      kind: "secret" as const,
      initials: "S",
      avatarDataUrl: null,
      draftPreview: null,
      typing: false,
      secretState: "pending" as const,
    })),
    listFolders: vi.fn(async () => []),
    listMessagePage: vi.fn(async () => ({ items: [], nextCursor: null })),
    listSharedMedia: vi.fn(async () => ({ items: [], nextCursor: null })),
    listPinnedMessages: vi.fn(async () => []),
    listChatMembers: vi.fn(async () => []),
    getPeerProfile: vi.fn(async (peerId: string) => ({
      id: peerId,
      title: "Peer",
      username: null,
      kind: "direct" as const,
      avatarDataUrl: null,
      bio: null,
      phone: null,
    })),
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
    sendSticker: vi.fn(async (chatId: string) => ({
      id: "sticker-message",
      chatId,
      senderName: "You",
      senderId: "demo-you",
      senderAvatarUrl: null,
      body: "",
      entities: [],
      media: null,
      groupedId: null,
      sentAt: new Date(0).toISOString(),
      outgoing: true,
      status: "sent" as const,
    })),
    getStickerSet: vi.fn(async (reference: StickerSetReferenceDto) => ({
      id: "sticker-set",
      title: "Telo Pack",
      shortName:
        reference.kind === "short-name" ? reference.shortName : "telofaces",
      reference,
      stickers: [],
      installed: false,
    })),
    setStickerSetInstalled: vi.fn(async () => undefined),
    getCustomEmoji: vi.fn(async () => []),
    searchGlobal: vi.fn(async () => ({ chats: [], messages: [] })),
    searchMessages: vi.fn(async () => ({
      messageIds: [],
      totalCount: 0,
      nextCursor: null,
    })),
    getCurrentUser: vi.fn(async () => ({
      id: "user",
      displayName: "Telo User",
      username: "telo",
      initials: "TU",
      avatarDataUrl: null,
    })),
    sendMessage: vi.fn(async (chatId, body) => ({
      id: "message",
      chatId,
      senderName: "You",
      senderId: "demo-you",
      senderAvatarUrl: null,
      body,
      entities: [],
      media: null,
      groupedId: null,
      sentAt: new Date(0).toISOString(),
      outgoing: true,
      status: "sent" as const,
    })),
    downloadMedia: vi.fn(async () => undefined),
    cancelMediaDownload: vi.fn(async () => undefined),
    resolveMediaFile: vi.fn(async () => "/cache/chat_1.png"),
    sendMedia: vi.fn(async () => []),
    cancelMediaUpload: vi.fn(async () => undefined),
    editMessage: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
    forwardMessage: vi.fn(async () => undefined),
    answerBotCallback: vi.fn(async () => ({ kind: "none" }) as const),
    setMessageReaction: vi.fn(async () => undefined),
    listAvailableReactions: vi.fn(async () => []),
    setChatPinned: vi.fn(async () => undefined),
    setChatMuted: vi.fn(async () => undefined),
    setChatRead: vi.fn(async () => undefined),
    setChatArchived: vi.fn(async () => undefined),
    setTyping: vi.fn(async () => undefined),
    saveDraft: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
  };
}

describe("TelegramWorkspaceService", () => {
  it("returns the current account identity through the port", async () => {
    const service = new TelegramWorkspaceService(repository());
    await expect(service.getCurrentUser()).resolves.toMatchObject({
      displayName: "Telo User",
      username: "telo",
    });
  });

  it("lists folders through the port", async () => {
    const port = repository();
    const folders = [{ id: 2, title: "Work", unreadCount: 3 }];
    port.listFolders = vi.fn(async () => folders);
    const service = new TelegramWorkspaceService(port);

    await expect(service.listFolders()).resolves.toEqual(folders);
  });

  it("merges keyword folders into listFolders and annotates chats", async () => {
    const design: ChatDto = {
      id: "design",
      title: "Telo Design",
      preview: "Ship it.",
      updatedAt: "2026-08-27T14:32:00.000Z",
      unreadCount: 3,
      lastReadMessageId: null,
      muted: false,
      pinned: false,
      kind: "group",
      initials: "TD",
      avatarDataUrl: null,
      draftPreview: null,
      typing: false,
      folderId: 2,
    };
    const match: MessageDto = {
      id: "design-3",
      chatId: "design",
      senderName: "Aron",
      senderId: "demo-aron",
      senderAvatarUrl: null,
      body: "This write-up nails the spacing rules.",
      entities: [],
      media: null,
      groupedId: null,
      sentAt: "2026-08-27T14:26:00.000Z",
      outgoing: false,
      status: "read",
    };
    const port = repository();
    port.listFolders = vi.fn(async () => [
      { id: 2, title: "Work", unreadCount: 3 },
    ]);
    port.listChatPage = vi.fn(async () => ({
      items: [design],
      nextCursor: null,
    }));
    port.searchGlobal = vi.fn(async () => ({ chats: [], messages: [match] }));
    const store: KeywordFolderRepository = {
      async list() {
        return [
          KeywordFolder.create({
            id: -1,
            title: "Spacing",
            query: "spacing",
          }),
        ];
      },
      async save() {},
      async remove() {},
    };
    const service = new TelegramWorkspaceService(
      port,
      new KeywordFolderService(store, port),
    );

    await expect(service.listFolders()).resolves.toEqual([
      { id: 2, title: "Work", unreadCount: 3 },
      {
        id: -1,
        title: "Spacing",
        unreadCount: 3,
        kind: "keyword",
        query: "spacing",
      },
    ]);
    await expect(service.listChatPage()).resolves.toMatchObject({
      items: [{ id: "design", keywordFolderIds: [-1] }],
    });
  });

  it("normalizes pagination defaults and validates page boundaries", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.listChatPage();
    await service.listMessagePage("chat");

    expect(port.listChatPage).toHaveBeenCalledWith({ limit: 50 });
    expect(port.listMessagePage).toHaveBeenCalledWith("chat", { limit: 50 });
    await expect(service.listChatPage({ limit: 0 })).rejects.toThrow(
      "Page size",
    );
    expect(() => service.listMessagePage("chat", { limit: 101 })).toThrow(
      "Page size",
    );
  });

  it("trims outgoing messages", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);
    const message = await service.sendMessage("chat", "  hello  ");
    expect(message.body).toBe("hello");
    expect(port.sendMessage).toHaveBeenCalledWith(
      "chat",
      "hello",
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it("forwards the reply target and client id to the port", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);
    await service.sendMessage("chat", "hello", {
      replyToId: "message-1",
      clientId: "client-1",
    });
    expect(port.sendMessage).toHaveBeenCalledWith(
      "chat",
      "hello",
      "message-1",
      "client-1",
      undefined,
      undefined,
    );
  });

  it("forwards the silent flag to the port", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);
    await service.sendMessage("chat", "hello", { silent: true });
    expect(port.sendMessage).toHaveBeenCalledWith(
      "chat",
      "hello",
      undefined,
      undefined,
      true,
      undefined,
    );
  });

  it("forwards composer entities and shifts them when the body is trimmed", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);
    await service.sendMessage("chat", "  hello  ", {
      entities: [{ type: "bold", offset: 2, length: 5 }],
    });
    expect(port.sendMessage).toHaveBeenCalledWith(
      "chat",
      "hello",
      undefined,
      undefined,
      undefined,
      [{ type: "bold", offset: 0, length: 5 }],
    );
  });

  it("forwards typing and draft signals through the port", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.setTyping("chat", true);
    await service.saveDraft("chat", "draft text");

    expect(port.setTyping).toHaveBeenCalledWith("chat", true);
    expect(port.saveDraft).toHaveBeenCalledWith("chat", "draft text");
  });

  it("pages shared media and lists pinned messages through the port", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.listSharedMedia("chat", { beforeMessageId: "42" });
    await service.listPinnedMessages("chat");
    await service.listChatMembers("chat");

    expect(port.listSharedMedia).toHaveBeenCalledWith("chat", {
      beforeMessageId: "42",
      limit: 50,
    });
    expect(port.listPinnedMessages).toHaveBeenCalledWith("chat");
    expect(port.listChatMembers).toHaveBeenCalledWith("chat");
  });

  it.each([
    "listSharedMedia",
    "listPinnedMessages",
    "listChatMembers",
  ] as const)("%s() rejects an empty chat id", (method) => {
    const service = new TelegramWorkspaceService(repository());
    expect(() =>
      method === "listSharedMedia"
        ? service.listSharedMedia(" ")
        : method === "listPinnedMessages"
          ? service.listPinnedMessages(" ")
          : service.listChatMembers(" "),
    ).toThrow("Chat id is required");
  });

  it("reads a peer profile through the port", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await expect(service.getPeerProfile("peer")).resolves.toMatchObject({
      id: "peer",
    });
    expect(port.getPeerProfile).toHaveBeenCalledWith("peer");
  });

  it("getPeerProfile() rejects an empty peer id", () => {
    const service = new TelegramWorkspaceService(repository());
    expect(() => service.getPeerProfile(" ")).toThrow("Peer id is required");
  });

  it("lists sticker sets through the port", async () => {
    const port = repository();
    const sets = [
      {
        id: "set-1",
        title: "Telo Faces",
        shortName: "telofaces",
        reference: { kind: "short-name" as const, shortName: "telofaces" },
        stickers: [
          {
            id: "sticker/12345",
            emoji: "🙂",
            format: "static" as const,
            width: 512,
            height: 512,
            outlinePath: null,
          },
        ],
        installed: true,
      },
    ];
    port.listStickerSets = vi.fn(async () => sets);
    const service = new TelegramWorkspaceService(port);

    await expect(service.listStickerSets()).resolves.toEqual(sets);
  });

  it("reads and mutates account-level sticker catalog state", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await expect(service.getStickerCatalog()).resolves.toEqual({
      recent: [],
      favorites: [],
      sets: [],
    });
    await service.setStickerFavorite("sticker/1", true);
    await service.removeRecentSticker("sticker/1");
    await service.clearRecentStickers();

    expect(port.setStickerFavorite).toHaveBeenCalledWith("sticker/1", true);
    expect(port.removeRecentSticker).toHaveBeenCalledWith("sticker/1");
    expect(port.clearRecentStickers).toHaveBeenCalledOnce();
  });

  it("validates and forwards the complete sticker-set order", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.reorderStickerSets(["2", "1"]);
    expect(port.reorderStickerSets).toHaveBeenCalledWith(["2", "1"]);
    expect(() => service.reorderStickerSets([])).toThrow(
      "Sticker set order is required",
    );
    expect(() => service.reorderStickerSets(["1", "1"])).toThrow(
      "Sticker set order contains duplicates",
    );
  });

  it("normalizes sticker search before forwarding it", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.searchStickers("  party  ");
    expect(port.searchStickers).toHaveBeenCalledWith("party");
    expect(() => service.searchStickers("  ")).toThrow(
      "Sticker search query is required",
    );
  });

  it("sends a sticker through the port", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await expect(
      service.sendSticker("chat", "sticker/12345"),
    ).resolves.toMatchObject({ chatId: "chat", outgoing: true });
    expect(port.sendSticker).toHaveBeenCalledWith("chat", "sticker/12345");
  });

  it.each([
    [" ", "sticker/12345", "Chat id is required"],
    ["chat", " ", "Sticker id is required"],
  ])("sendSticker() rejects %s / %s", (chatId, stickerId, error) => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    expect(() => service.sendSticker(chatId, stickerId)).toThrow(error);
    expect(port.sendSticker).not.toHaveBeenCalled();
  });

  it("gets one sticker set through the port", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    const reference = { kind: "short-name" as const, shortName: "telofaces" };
    await expect(service.getStickerSet(reference)).resolves.toMatchObject({
      shortName: "telofaces",
      installed: false,
    });
    expect(port.getStickerSet).toHaveBeenCalledWith(reference);
  });

  it("normalizes an id-based sticker set reference before forwarding it", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.getStickerSet({
      kind: "id",
      id: " 9 ",
    });

    expect(port.getStickerSet).toHaveBeenCalledWith({
      kind: "id",
      id: "9",
    });
  });

  it.each([true, false])(
    "forwards installed=%s to the port",
    async (installed) => {
      const port = repository();
      const service = new TelegramWorkspaceService(port);

      await expect(
        service.setStickerSetInstalled("telofaces", installed),
      ).resolves.toBeUndefined();
      expect(port.setStickerSetInstalled).toHaveBeenCalledWith(
        "telofaces",
        installed,
      );
    },
  );

  it("rejects an empty sticker set name on both set methods", () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    expect(() =>
      service.getStickerSet({ kind: "short-name", shortName: " " }),
    ).toThrow("Sticker set name is required");
    expect(() => service.setStickerSetInstalled(" ", true)).toThrow(
      "Sticker set name is required",
    );
    expect(port.getStickerSet).not.toHaveBeenCalled();
    expect(port.setStickerSetInstalled).not.toHaveBeenCalled();
  });

  it("rejects an invalid shared media cursor", () => {
    const service = new TelegramWorkspaceService(repository());
    expect(() =>
      service.listSharedMedia("chat", { beforeMessageId: " " }),
    ).toThrow("Message id is required");
  });

  it.each(["setTyping", "saveDraft"] as const)(
    "%s() rejects an empty chat id",
    (method) => {
      const service = new TelegramWorkspaceService(repository());
      expect(() =>
        method === "setTyping"
          ? service.setTyping(" ", true)
          : service.saveDraft(" ", "text"),
      ).toThrow("Chat id is required");
    },
  );

  it.each([
    ["", "message", "Chat id"],
    ["chat", "  ", "Message body"],
  ])("rejects invalid messages", (chatId, body, error) => {
    expect(() =>
      new TelegramWorkspaceService(repository()).sendMessage(chatId, body),
    ).toThrow(error);
  });

  it("rejects an empty chat id when loading a message page", () => {
    expect(() =>
      new TelegramWorkspaceService(repository()).listMessagePage(" "),
    ).toThrow("Chat id");
  });

  it("forwards a trimmed global search query to the port", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.searchGlobal("  report  ");

    expect(port.searchGlobal).toHaveBeenCalledWith("report");
    expect(() => service.searchGlobal("  ")).toThrow("Search query");
  });

  it("forwards in-chat search with validation and page defaults", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.searchMessages("chat", " report ", {
      beforeMessageId: "42",
    });

    expect(port.searchMessages).toHaveBeenCalledWith("chat", "report", {
      beforeMessageId: "42",
      limit: 50,
    });
    expect(() => service.searchMessages(" ", "report")).toThrow("Chat id");
    expect(() => service.searchMessages("chat", " ")).toThrow("Search query");
    expect(() =>
      service.searchMessages("chat", "report", { beforeMessageId: " " }),
    ).toThrow("Message id");
    expect(() =>
      service.searchMessages("chat", "report", { limit: 0 }),
    ).toThrow("Page size");
  });

  it("resolves the cached media path through the port", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await expect(service.resolveMediaFile("chat/1")).resolves.toBe(
      "/cache/chat_1.png",
    );
    expect(port.resolveMediaFile).toHaveBeenCalledWith("chat/1");
  });

  it("rejects an empty media id when resolving a media file", () => {
    expect(() =>
      new TelegramWorkspaceService(repository()).resolveMediaFile(" "),
    ).toThrow("Media id is required");
  });

  const uploadFile = {
    source: "/tmp/photo.jpg",
    name: "photo.jpg",
    mimeType: "image/jpeg",
    size: 1234,
  };

  it("forwards media sends to the port with a trimmed caption", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.sendMedia("chat", [uploadFile], {
      uploadId: "upload-1",
      caption: "  hello  ",
      replyToId: "message-1",
      clientId: "client-1",
    });

    expect(port.sendMedia).toHaveBeenCalledWith(
      "chat",
      [uploadFile],
      "hello",
      "message-1",
      "client-1",
      "upload-1",
    );
  });

  it("defaults a missing caption to an empty string", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.sendMedia("chat", [uploadFile], { uploadId: "upload-1" });

    expect(port.sendMedia).toHaveBeenCalledWith(
      "chat",
      [uploadFile],
      "",
      undefined,
      undefined,
      "upload-1",
    );
  });

  it.each([
    [" ", [uploadFile], { uploadId: "u" }, "Chat id is required"],
    ["chat", [uploadFile], { uploadId: " " }, "Upload id is required"],
    ["chat", [], { uploadId: "u" }, "Select from 1 to 10 files"],
    [
      "chat",
      Array.from({ length: 11 }, () => uploadFile),
      { uploadId: "u" },
      "Select from 1 to 10 files",
    ],
    [
      "chat",
      [{ ...uploadFile, source: " " }],
      { uploadId: "u" },
      "source and file name",
    ],
    [
      "chat",
      [{ ...uploadFile, name: " " }],
      { uploadId: "u" },
      "source and file name",
    ],
    [
      "chat",
      [{ ...uploadFile, size: 0 }],
      { uploadId: "u" },
      "Upload size is invalid",
    ],
    [
      "chat",
      [{ ...uploadFile, size: 1.5 }],
      { uploadId: "u" },
      "Upload size is invalid",
    ],
  ])(
    "rejects invalid media input %j",
    (chatId, files, input, error: string) => {
      expect(() =>
        new TelegramWorkspaceService(repository()).sendMedia(
          chatId,
          files,
          input,
        ),
      ).toThrow(error);
    },
  );

  it("cancels uploads through the port and validates the upload id", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.cancelMediaUpload("upload-1");

    expect(port.cancelMediaUpload).toHaveBeenCalledWith("upload-1");
    expect(() => service.cancelMediaUpload(" ")).toThrow(
      "Upload id is required",
    );
  });
});
