import { describe, expect, it, vi } from "vitest";

import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { MessageActionsService } from "./message-actions";
import type { ChatDto } from "../../../../contracts/src/ipc";

function restrictedChat(mediaAllowed: boolean): ChatDto {
  return {
    id: "chat",
    title: "News",
    preview: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "channel",
    initials: "N",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    canSendMessages: false,
    canSendStickers: false,
    canSendMedia: mediaAllowed,
  };
}

function repository(): TelegramRepository {
  return {
    subscribe: vi.fn(() => () => {}),
    listChatPage: vi.fn(async () => ({ items: [], nextCursor: null })),
    getChat: vi.fn(async () => null),
    createSecretChat: vi.fn(),
    listContacts: vi.fn(async () => []),
    openPrivateChat: vi.fn(),
    createGroup: vi.fn(),
    createChannel: vi.fn(),
    listCalls: vi.fn(async () => ({ items: [], nextCursor: null })),
    postStory: vi.fn(),
    openSavedMessages: vi.fn(),
    listFolders: vi.fn(async () => []),
    getChatFolder: vi.fn(async () => null),
    createChatFolder: vi.fn(async () => ({ id: 2, title: "", unreadCount: 0 })),
    editChatFolder: vi.fn(async () => ({ id: 2, title: "", unreadCount: 0 })),
    deleteChatFolder: vi.fn(async () => undefined),
    listMessagePage: vi.fn(async () => ({ items: [], nextCursor: null })),
    listSharedMedia: vi.fn(async () => ({ items: [], nextCursor: null })),
    listPinnedMessages: vi.fn(async () => []),
    listScheduledMessages: vi.fn(async () => []),
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
    updateProfileName: vi.fn(),
    updateBio: vi.fn(async () => undefined),
    checkUsernameAvailability: vi.fn(async () => "available" as const),
    setUsername: vi.fn(),
    setProfilePhoto: vi.fn(),
    addContactByPhone: vi.fn(async () => null),
    setPeerContact: vi.fn(async () => undefined),
    removePeerContact: vi.fn(async () => undefined),
    sendMessage: vi.fn(),
    downloadMedia: vi.fn(),
    cancelMediaDownload: vi.fn(),
    resolveMediaFile: vi.fn(),
    sendMedia: vi.fn(),
    cancelMediaUpload: vi.fn(),
    editMessage: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
    forwardMessage: vi.fn(async () => undefined),
    pinMessage: vi.fn(async () => undefined),
    setMessagePollAnswer: vi.fn(async () => undefined),
    sendPoll: vi.fn(),
    answerBotCallback: vi.fn(async () => ({
      kind: "message" as const,
      text: "Saved",
      alert: true,
    })),
    setMessageReaction: vi.fn(async () => undefined),
    listAvailableReactions: vi.fn(async () => ["👍", "🎉"]),
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
  ])("rejects invalid edit input %j", async (input, error) => {
    const port = repository();
    const service = new MessageActionsService(port);

    await expect(service.editMessage(input)).rejects.toThrow(error);
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
  ])("rejects invalid forward input %j", async (input, error) => {
    const port = repository();
    const service = new MessageActionsService(port);

    await expect(service.forwardMessage(input)).rejects.toThrow(error);
    expect(port.forwardMessage).not.toHaveBeenCalled();
  });

  it("forwards a pin to the port", async () => {
    const port = repository();
    const service = new MessageActionsService(port);
    const pin = { chatId: "chat", messageId: "message", pinned: true };

    await service.pinMessage(pin);

    expect(port.pinMessage).toHaveBeenCalledWith(pin);
  });

  it.each([
    [{ chatId: " ", messageId: "message", pinned: true }, "Chat id"],
    [{ chatId: "chat", messageId: " ", pinned: false }, "Message id"],
  ])("rejects invalid pin input %j", (input, error) => {
    const port = repository();
    const service = new MessageActionsService(port);

    expect(() => service.pinMessage(input)).toThrow(error);
    expect(port.pinMessage).not.toHaveBeenCalled();
  });

  it("forwards a keyboard press and returns the bot's answer", async () => {
    const port = repository();
    const service = new MessageActionsService(port);

    await expect(
      service.answerBotCallback("chat", "message", "0:1"),
    ).resolves.toEqual({ kind: "message", text: "Saved", alert: true });
    expect(port.answerBotCallback).toHaveBeenCalledWith(
      "chat",
      "message",
      "0:1",
    );
  });

  it.each([
    [" ", "message", "0:0", "Chat id"],
    ["chat", " ", "0:0", "Message id"],
    ["chat", "message", " ", "Button id"],
  ])(
    "rejects a keyboard press with a blank %j / %j / %j",
    (chatId, messageId, buttonId, error) => {
      const port = repository();
      const service = new MessageActionsService(port);

      expect(() =>
        service.answerBotCallback(chatId, messageId, buttonId),
      ).toThrow(error);
      expect(port.answerBotCallback).not.toHaveBeenCalled();
    },
  );

  it("sets a reaction with the trimmed emoji", async () => {
    const port = repository();
    const service = new MessageActionsService(port);

    await service.setMessageReaction({
      chatId: "chat",
      messageId: "message",
      emoji: " 👍 ",
    });

    expect(port.setMessageReaction).toHaveBeenCalledWith({
      chatId: "chat",
      messageId: "message",
      emoji: "👍",
      remove: false,
    });
  });

  it("clears a reaction with remove true", async () => {
    const port = repository();
    const service = new MessageActionsService(port);
    const input = {
      chatId: "chat",
      messageId: "message",
      emoji: "👍",
      remove: true,
    };

    await service.setMessageReaction(input);

    expect(port.setMessageReaction).toHaveBeenCalledWith(input);
  });

  it.each([
    [{ chatId: " ", messageId: "message", emoji: "👍" }, "Chat id"],
    [{ chatId: "chat", messageId: " ", emoji: "👍" }, "Message id"],
    [{ chatId: "chat", messageId: "message", emoji: " " }, "Reaction emoji"],
  ])("rejects invalid reaction input %j", (input, error) => {
    const port = repository();
    const service = new MessageActionsService(port);

    expect(() => service.setMessageReaction(input)).toThrow(error);
    expect(port.setMessageReaction).not.toHaveBeenCalled();
  });

  it("lists the chat's available reactions through the port", async () => {
    const port = repository();
    const service = new MessageActionsService(port);

    await expect(service.listAvailableReactions("chat", "m1")).resolves.toEqual(
      ["👍", "🎉"],
    );
    expect(port.listAvailableReactions).toHaveBeenCalledWith("chat", "m1");
  });

  it("rejects an available-reactions lookup without a chat", () => {
    const port = repository();
    const service = new MessageActionsService(port);

    expect(() => service.listAvailableReactions(" ")).toThrow("Chat id");
    expect(port.listAvailableReactions).not.toHaveBeenCalled();
  });

  it("rejects edits and forwards to a chat the account cannot write to", async () => {
    const port = repository();
    port.getChat = vi.fn(async () => restrictedChat(false));
    const service = new MessageActionsService(port);

    await expect(
      service.editMessage({ chatId: "chat", messageId: "m", body: "updated" }),
    ).rejects.toThrow("The current account can't write to this chat");
    await expect(
      service.forwardMessage({
        fromChatId: "elsewhere",
        messageId: "m",
        toChatId: "chat",
      }),
    ).rejects.toThrow("The current account can't write to this chat");

    expect(port.editMessage).not.toHaveBeenCalled();
    expect(port.forwardMessage).not.toHaveBeenCalled();
  });

  it("forwards into a chat where only media is permitted", async () => {
    const port = repository();
    port.getChat = vi.fn(async () => restrictedChat(true));
    const service = new MessageActionsService(port);

    await service.forwardMessage({
      fromChatId: "elsewhere",
      messageId: "m",
      toChatId: "chat",
    });

    expect(port.forwardMessage).toHaveBeenCalled();
  });

  it("votes in a poll through the port", async () => {
    const port = repository();
    const service = new MessageActionsService(port);

    await service.setMessagePollAnswer("chat", "message", [0, 2]);

    expect(port.setMessagePollAnswer).toHaveBeenCalledWith(
      "chat",
      "message",
      [0, 2],
    );
  });

  it.each([
    [" ", "message", [0], "Chat id"],
    ["chat", " ", [0], "Message id"],
    ["chat", "message", [-1], "non-negative integers"],
    ["chat", "message", [1.5], "non-negative integers"],
  ])(
    "rejects an invalid poll vote %j / %j / %j",
    (chatId, messageId, optionIds, error) => {
      const port = repository();
      const service = new MessageActionsService(port);

      expect(() =>
        service.setMessagePollAnswer(chatId, messageId, optionIds),
      ).toThrow(error as string);
      expect(port.setMessagePollAnswer).not.toHaveBeenCalled();
    },
  );

  it("lets an empty option list through to retract the answer", async () => {
    const port = repository();
    const service = new MessageActionsService(port);

    await service.setMessagePollAnswer("chat", "message", []);

    expect(port.setMessagePollAnswer).toHaveBeenCalledWith(
      "chat",
      "message",
      [],
    );
  });
});
