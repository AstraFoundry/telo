import { describe, expect, it, vi } from "vitest";

import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { TelegramWorkspaceService } from "./telegram-workspace";

function repository(): TelegramRepository {
  return {
    subscribe: vi.fn(() => () => {}),
    listChatPage: vi.fn(async () => ({ items: [], nextCursor: null })),
    listMessagePage: vi.fn(async () => ({ items: [], nextCursor: null })),
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
      sentAt: new Date(0).toISOString(),
      outgoing: true,
      status: "sent" as const,
    })),
    editMessage: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
    forwardMessage: vi.fn(async () => undefined),
    setChatPinned: vi.fn(async () => undefined),
    setChatMuted: vi.fn(async () => undefined),
    setChatRead: vi.fn(async () => undefined),
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
    expect(port.sendMessage).toHaveBeenCalledWith("chat", "hello", undefined);
  });

  it("forwards the reply target to the port", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);
    await service.sendMessage("chat", "hello", { replyToId: "message-1" });
    expect(port.sendMessage).toHaveBeenCalledWith("chat", "hello", "message-1");
  });

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
});
