import { describe, expect, it, vi } from "vitest";

import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { ChatActionsService } from "./chat-actions";

function repository(): TelegramRepository {
  return {
    subscribe: vi.fn(() => () => {}),
    listChatPage: vi.fn(async () => ({ items: [], nextCursor: null })),
    listMessagePage: vi.fn(async () => ({ items: [], nextCursor: null })),
    getCurrentUser: vi.fn(),
    sendMessage: vi.fn(),
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

describe("ChatActionsService", () => {
  it("forwards pin, mute, and read updates to the port", async () => {
    const port = repository();
    const service = new ChatActionsService(port);

    await service.setPinned("chat", true);
    await service.setMuted("chat", false);
    await service.setRead("chat", true);

    expect(port.setChatPinned).toHaveBeenCalledWith("chat", true);
    expect(port.setChatMuted).toHaveBeenCalledWith("chat", false);
    expect(port.setChatRead).toHaveBeenCalledWith("chat", true);
  });

  it.each(["setPinned", "setMuted", "setRead"] as const)(
    "rejects an empty chat id on %s",
    (method) => {
      const port = repository();
      const service = new ChatActionsService(port);

      expect(() => service[method](" ", true)).toThrow("Chat id");
      expect(port.setChatPinned).not.toHaveBeenCalled();
      expect(port.setChatMuted).not.toHaveBeenCalled();
      expect(port.setChatRead).not.toHaveBeenCalled();
    },
  );
});
