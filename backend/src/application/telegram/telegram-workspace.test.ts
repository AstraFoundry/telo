import { describe, expect, it, vi } from "vitest";

import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { TelegramWorkspaceService } from "./telegram-workspace";

function repository(): TelegramRepository {
  return {
    subscribe: vi.fn(() => () => {}),
    listChatPage: vi.fn(async () => ({ items: [], nextCursor: null })),
    listFolders: vi.fn(async () => []),
    listMessagePage: vi.fn(async () => ({ items: [], nextCursor: null })),
    listSharedMedia: vi.fn(async () => ({ items: [], nextCursor: null })),
    listPinnedMessages: vi.fn(async () => []),
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
    setChatPinned: vi.fn(async () => undefined),
    setChatMuted: vi.fn(async () => undefined),
    setChatRead: vi.fn(async () => undefined),
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

  it("normalizes pagination defaults and validates page boundaries", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);

    await service.listChatPage();
    await service.listMessagePage("chat");

    expect(port.listChatPage).toHaveBeenCalledWith({ limit: 50 });
    expect(port.listMessagePage).toHaveBeenCalledWith("chat", { limit: 50 });
    expect(() => service.listChatPage({ limit: 0 })).toThrow("Page size");
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

    expect(port.listSharedMedia).toHaveBeenCalledWith("chat", {
      beforeMessageId: "42",
      limit: 50,
    });
    expect(port.listPinnedMessages).toHaveBeenCalledWith("chat");
  });

  it.each(["listSharedMedia", "listPinnedMessages"] as const)(
    "%s() rejects an empty chat id",
    (method) => {
      const service = new TelegramWorkspaceService(repository());
      expect(() =>
        method === "listSharedMedia"
          ? service.listSharedMedia(" ")
          : service.listPinnedMessages(" "),
      ).toThrow("Chat id is required");
    },
  );

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
