import { describe, expect, it, vi } from "vitest";

import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { MessageActionsService } from "./message-actions";

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
    setChatPinned: vi.fn(async () => undefined),
    setChatMuted: vi.fn(async () => undefined),
    setChatRead: vi.fn(async () => undefined),
    setTyping: vi.fn(async () => undefined),
    saveDraft: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
  };
}

describe("MessageActionsService", () => {
  it("forwards edit, delete, and forward to the port", async () => {
    const port = repository();
    const service = new MessageActionsService(port);
    const edit = { chatId: "chat", messageId: "message", body: "updated" };
    const del = { chatId: "chat", messageId: "message" };
    const forward = {
      fromChatId: "chat",
      messageId: "message",
      toChatId: "saved",
    };

    await service.editMessage(edit);
    await service.deleteMessage(del);
    await service.forwardMessage(forward);

    expect(port.editMessage).toHaveBeenCalledWith(edit);
    expect(port.deleteMessage).toHaveBeenCalledWith(del);
    expect(port.forwardMessage).toHaveBeenCalledWith(forward);
  });

  it("passes the hide-sender flag through to the port", async () => {
    const port = repository();
    const service = new MessageActionsService(port);
    const forward = {
      fromChatId: "chat",
      messageId: "message",
      toChatId: "saved",
      hideSender: true,
    };

    await service.forwardMessage(forward);

    expect(port.forwardMessage).toHaveBeenCalledWith(forward);
  });

  it("trims the edited body", async () => {
    const port = repository();
    const service = new MessageActionsService(port);

    await service.editMessage({
      chatId: "chat",
      messageId: "message",
      body: "  updated  ",
    });

    expect(port.editMessage).toHaveBeenCalledWith({
      chatId: "chat",
      messageId: "message",
      body: "updated",
    });
  });

  it.each([
    [{ chatId: " ", messageId: "message", body: "body" }, "Chat id"],
    [{ chatId: "chat", messageId: " ", body: "body" }, "Message id"],
    [{ chatId: "chat", messageId: "message", body: "  " }, "Message body"],
  ])("rejects invalid edit input %j", (input, error) => {
    const port = repository();
    const service = new MessageActionsService(port);

    expect(() => service.editMessage(input)).toThrow(error);
    expect(port.editMessage).not.toHaveBeenCalled();
  });

  it.each([
    [{ chatId: " ", messageId: "message" }, "Chat id"],
    [{ chatId: "chat", messageId: " " }, "Message id"],
  ])("rejects invalid delete input %j", (input, error) => {
    const port = repository();
    const service = new MessageActionsService(port);

    expect(() => service.deleteMessage(input)).toThrow(error);
    expect(port.deleteMessage).not.toHaveBeenCalled();
  });

  it("passes the delete scope through to the port", async () => {
    const port = repository();
    const service = new MessageActionsService(port);
    const del = { chatId: "chat", messageId: "message", scope: "me" as const };

    await service.deleteMessage(del);

    expect(port.deleteMessage).toHaveBeenCalledWith(del);
  });

  it("rejects an unknown delete scope", () => {
    const port = repository();
    const service = new MessageActionsService(port);

    expect(() =>
      service.deleteMessage({
        chatId: "chat",
        messageId: "message",
        scope: "them" as never,
      }),
    ).toThrow("Delete scope");
    expect(port.deleteMessage).not.toHaveBeenCalled();
  });

  it.each([
    [{ fromChatId: " ", messageId: "message", toChatId: "saved" }, "Chat id"],
    [{ fromChatId: "chat", messageId: " ", toChatId: "saved" }, "Message id"],
    [{ fromChatId: "chat", messageId: "message", toChatId: " " }, "Chat id"],
  ])("rejects invalid forward input %j", (input, error) => {
    const port = repository();
    const service = new MessageActionsService(port);

    expect(() => service.forwardMessage(input)).toThrow(error);
    expect(port.forwardMessage).not.toHaveBeenCalled();
  });
});
