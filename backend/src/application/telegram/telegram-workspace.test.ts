import { describe, expect, it, vi } from "vitest";

import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { TelegramWorkspaceService } from "./telegram-workspace";

function repository(): TelegramRepository {
  return {
    getCurrentUser: vi.fn(async () => ({
      id: "user",
      displayName: "Telo User",
      username: "telo",
      initials: "TU",
      avatarDataUrl: null,
    })),
    listChats: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
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

  it("lists chats and messages through the port", async () => {
    const port = repository();
    const service = new TelegramWorkspaceService(port);
    await expect(service.listChats()).resolves.toEqual([]);
    await expect(service.listMessages("chat")).resolves.toEqual([]);
    expect(port.listMessages).toHaveBeenCalledWith("chat");
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

  it("rejects an empty chat id when loading messages", () => {
    expect(() =>
      new TelegramWorkspaceService(repository()).listMessages(" "),
    ).toThrow("Chat id");
  });
});
