import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import type * as Td from "tdlib-types";

import type { TelegramWorkspaceEvent } from "../../../../contracts/src/ipc";
import type { TdlibBridge } from "./tdlib-client";
import { TdlibTelegramRepository } from "./tdlib-telegram-repository";

class FakeBridge implements TdlibBridge {
  readonly invokes: object[] = [];
  readonly handlers = new Map<
    string,
    (request: Record<string, unknown>) => unknown
  >();
  private readonly listeners = new Set<(update: Td.Update) => void>();
  closed = false;

  invoke<T>(request: object): Promise<T> {
    this.invokes.push(request);
    const typed = request as { _: string };
    const handler = this.handlers.get(typed._);
    if (handler) {
      return Promise.resolve(handler(request as Record<string, unknown>) as T);
    }
    return Promise.resolve({ _: "ok" } as T);
  }

  onUpdate(listener: (update: Td.Update) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(update: Td.Update): void {
    for (const listener of this.listeners) listener(update);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  isClosed(): boolean {
    return this.closed;
  }
}

function tdChat(id: number, extra: Record<string, unknown> = {}): Td.chat {
  return {
    _: "chat",
    id,
    type: { _: "chatTypePrivate", user_id: id },
    title: `Chat ${id}`,
    unread_count: 0,
    last_read_inbox_message_id: 0,
    last_message: {
      _: "message",
      id: 1,
      chat_id: id,
      date: 1700000000,
      content: {
        _: "messageText",
        text: { _: "formattedText", text: "preview", entities: [] },
      },
    },
    positions: [
      {
        _: "chatPosition",
        list: { _: "chatListMain" },
        order: String(1000 - id),
        is_pinned: false,
      },
    ],
    notification_settings: { _: "chatNotificationSettings", mute_for: 0 },
    available_reactions: {
      _: "chatAvailableReactionsSome",
      reactions: [{ _: "reactionTypeEmoji", emoji: "👍" }],
    },
    ...extra,
  } as unknown as Td.chat;
}

function tdMessage(id: number, chatId = 11): Td.message {
  return {
    _: "message",
    id,
    chat_id: chatId,
    is_outgoing: true,
    date: 1700000000,
    edit_date: 0,
    media_album_id: "0",
    sender_id: { _: "messageSenderUser", user_id: 1 },
    content: {
      _: "messageText",
      text: { _: "formattedText", text: `msg ${id}`, entities: [] },
    },
  } as unknown as Td.message;
}

function tdUser(id: number, extra: Record<string, unknown> = {}): Td.user {
  return {
    _: "user",
    id,
    first_name: "Ada",
    last_name: "Byron",
    usernames: { active_usernames: ["ada"] },
    phone_number: "+1555",
    status: { _: "userStatusOnline", expires: 1 },
    ...extra,
  } as unknown as Td.user;
}

function tdSticker(id: number): Td.sticker {
  return {
    _: "sticker",
    emoji: "🐙",
    width: 512,
    height: 512,
    format: { _: "stickerFormatWebp" },
    sticker: { id, size: 10 },
  } as unknown as Td.sticker;
}

describe("TdlibTelegramRepository", () => {
  function setup() {
    const bridge = new FakeBridge();
    const me = tdUser(1);
    const chat = tdChat(11);
    bridge.handlers.set("getMe", () => me);
    bridge.handlers.set("loadChats", () => ({ _: "ok" }));
    bridge.handlers.set("getChats", () => ({
      _: "chats",
      chat_ids: [11],
      total_count: 1,
    }));
    bridge.handlers.set("getChat", () => chat);
    bridge.handlers.set("getUser", (request) =>
      tdUser(Number(request.user_id)),
    );
    bridge.handlers.set("getChatHistory", () => ({
      _: "messages",
      total_count: 1,
      messages: [tdMessage(2), tdMessage(1)],
    }));
    bridge.handlers.set("searchChatMessages", (request) => ({
      _: "foundChatMessages",
      total_count: 1,
      next_from_message_id: 0,
      messages: [tdMessage(3, Number(request.chat_id))],
    }));
    const cache = path.join(os.tmpdir(), `telo-tdlib-cache-${Date.now()}`);
    const repository = new TdlibTelegramRepository(
      bridge,
      cache,
      async () => 1024 ** 3,
    );
    const events: TelegramWorkspaceEvent[] = [];
    repository.subscribe((event) => events.push(event));
    return { bridge, repository, events, cache };
  }

  it("hydrates chats from local TDLib lists and pages them", async () => {
    const { repository } = setup();
    await repository.hydrate();
    const page = await repository.listChatPage({ limit: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe("11");
    expect(page.nextCursor).toBeNull();
    expect(await repository.getCurrentUser()).toMatchObject({
      id: "1",
      displayName: "Ada Byron",
      username: "ada",
    });
  });

  it("creates a secret chat and upserts it", async () => {
    const { repository, events, bridge } = setup();
    bridge.handlers.set("createNewSecretChat", () =>
      tdChat(-99, {
        type: { _: "chatTypeSecret", user_id: 11, secret_chat_id: 4 },
        title: "Mina",
      }),
    );
    const created = await repository.createSecretChat("11");
    expect(created.kind).toBe("secret");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "chat-upsert", chat: created }),
    );
  });

  it("pages history past a short first batch and drops the cursor message", async () => {
    const { repository, bridge } = setup();
    bridge.handlers.set("getChatHistory", (request) => {
      const from = Number(request.from_message_id);
      if (from === 0) {
        return {
          _: "messages",
          total_count: 40,
          messages: [tdMessage(40)],
        };
      }
      if (from === 40) {
        return {
          _: "messages",
          total_count: 40,
          messages: [tdMessage(40), tdMessage(39), tdMessage(38)],
        };
      }
      return {
        _: "messages",
        total_count: 40,
        messages: [tdMessage(from)],
      };
    });
    const first = await repository.listMessagePage("11", { limit: 1 });
    expect(first.items.map((item) => item.id)).toEqual(["40"]);
    expect(first.nextCursor).toBe("40");
    const second = await repository.listMessagePage("11", {
      beforeMessageId: first.nextCursor,
      limit: 50,
    });
    expect(second.items.map((item) => item.id)).toEqual(["38", "39"]);
    expect(second.nextCursor).toBe("38");
    const third = await repository.listMessagePage("11", {
      beforeMessageId: second.nextCursor,
      limit: 50,
    });
    expect(third.items).toEqual([]);
    expect(third.nextCursor).toBeNull();
  });

  it("opens Saved Messages through createPrivateChat", async () => {
    const { repository, bridge, events } = setup();
    await repository.hydrate();
    const saved = tdChat(1, {
      title: "Saved Messages",
      type: { _: "chatTypePrivate", user_id: 1 },
    });
    bridge.handlers.set("createPrivateChat", () => saved);
    const opened = await repository.openSavedMessages();
    expect(opened.kind).toBe("saved");
    expect(opened.id).toBe("1");
    expect(
      bridge.invokes.some(
        (item) => (item as { _: string })._ === "createPrivateChat",
      ),
    ).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "chat-upsert", chat: opened }),
    );
  });

  it("reconciles a pending send onto the server message id", async () => {
    const { repository, bridge, events } = setup();
    await repository.hydrate();
    bridge.handlers.set("sendMessage", (request) => {
      const sendingId = (request.options as { sending_id: number }).sending_id;
      return {
        ...tdMessage(100),
        sending_state: {
          _: "messageSendingStatePending",
          sending_id: sendingId,
        },
      };
    });
    const sent = await repository.sendMessage("11", "hello", undefined, "c1");
    expect(sent.clientId).toBe("c1");
    const sendingId = (
      bridge.invokes.find(
        (item) => (item as { _: string })._ === "sendMessage",
      ) as {
        options: { sending_id: number };
      }
    ).options.sending_id;
    events.length = 0;
    bridge.emit({
      _: "updateNewMessage",
      message: {
        ...tdMessage(100),
        sending_state: {
          _: "messageSendingStatePending",
          sending_id: sendingId,
        },
      },
    } as Td.Update);
    bridge.emit({
      _: "updateMessageSendSucceeded",
      old_message_id: 100,
      message: tdMessage(200),
    } as Td.Update);
    await vi.waitFor(() => {
      expect(
        events.some(
          (event) =>
            event.type === "message-delete" && event.messageIds.includes("100"),
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.type === "message-upsert" &&
            event.message.id === "200" &&
            event.message.clientId === "c1",
        ),
      ).toBe(true);
    });
  });

  it("keeps a min chat avatar pending until the photo arrives", async () => {
    const { events, bridge } = setup();
    const source = path.join(os.tmpdir(), `telo-avatar-min-${Date.now()}.jpg`);
    writeFileSync(source, "jpeg");
    events.length = 0;
    bridge.emit({
      _: "updateNewChat",
      chat: tdChat(77),
    } as Td.Update);
    const created = events.find(
      (event) => event.type === "chat-upsert" && event.chat.id === "77",
    );
    expect(created).toMatchObject({
      type: "chat-upsert",
      chat: { id: "77", avatarPending: true, avatarDataUrl: null },
    });
    expect(
      events.some(
        (event) => event.type === "chat-avatar" && event.chatId === "77",
      ),
    ).toBe(false);
    bridge.handlers.set("downloadFile", () => ({
      id: 91,
      size: 4,
      local: {
        is_downloading_completed: true,
        is_downloading_active: false,
        path: source,
        downloaded_size: 4,
      },
    }));
    bridge.emit({
      _: "updateChatPhoto",
      chat_id: 77,
      photo: {
        _: "chatPhotoInfo",
        small: {
          id: 91,
          size: 4,
          local: {
            is_downloading_completed: false,
            is_downloading_active: false,
            path: "",
            downloaded_size: 0,
          },
        },
      },
    } as Td.Update);
    await vi.waitFor(() => {
      expect(
        events.some(
          (event) =>
            event.type === "chat-avatar" &&
            event.chatId === "77" &&
            Boolean(event.avatarDataUrl),
        ),
      ).toBe(true);
    });
  });

  it("fetches getUser for a private chat even after a min updateUser", async () => {
    const { repository, events, bridge } = setup();
    const source = path.join(os.tmpdir(), `telo-avatar-user-${Date.now()}.jpg`);
    writeFileSync(source, "jpeg");
    bridge.handlers.set("getChat", () => tdChat(11, { photo: null }));
    bridge.handlers.set("getUser", () =>
      tdUser(11, {
        profile_photo: {
          _: "profilePhoto",
          id: "5",
          small: {
            id: 70,
            size: 4,
            local: {
              is_downloading_completed: false,
              is_downloading_active: false,
              path: "",
              downloaded_size: 0,
            },
          },
        },
      }),
    );
    bridge.handlers.set("downloadFile", () => ({
      id: 70,
      size: 4,
      local: {
        is_downloading_completed: true,
        is_downloading_active: false,
        path: source,
        downloaded_size: 4,
      },
    }));
    bridge.emit({ _: "updateUser", user: tdUser(11) } as Td.Update);
    events.length = 0;
    await repository.hydrate();
    await vi.waitFor(() => {
      expect(
        events.some(
          (event) =>
            event.type === "chat-avatar" &&
            event.chatId === "11" &&
            Boolean(event.avatarDataUrl),
        ),
      ).toBe(true);
    });
    expect(
      bridge.invokes.some(
        (item) =>
          (item as { _: string; user_id?: number })._ === "getUser" &&
          (item as { user_id?: number }).user_id === 11,
      ),
    ).toBe(true);
  });

  it("waits for the current user profile photo before returning", async () => {
    const { repository, bridge } = setup();
    const source = path.join(os.tmpdir(), `telo-avatar-me-${Date.now()}.jpg`);
    writeFileSync(source, "jpeg");
    bridge.handlers.set("getMe", () =>
      tdUser(1, {
        profile_photo: {
          _: "profilePhoto",
          id: "9",
          small: {
            id: 22,
            size: 4,
            local: {
              is_downloading_completed: false,
              is_downloading_active: false,
              path: "",
              downloaded_size: 0,
            },
          },
        },
      }),
    );
    bridge.handlers.set("downloadFile", (request) => {
      expect(request.synchronous).toBe(true);
      return {
        id: 22,
        size: 4,
        local: {
          is_downloading_completed: true,
          is_downloading_active: false,
          path: source,
          downloaded_size: 4,
        },
      };
    });
    const me = await repository.getCurrentUser();
    expect(me.avatarDataUrl).toMatch(/telo-media:\/\/cache\/avatar_1\.jpg/);
    expect(me.avatarPending).toBe(false);
  });

  it("paints a profile minithumbnail before the file download settles", async () => {
    const { repository, events, bridge } = setup();
    bridge.handlers.set("getChat", () => tdChat(11, { photo: null }));
    bridge.handlers.set("getUser", () =>
      tdUser(11, {
        profile_photo: {
          _: "profilePhoto",
          id: "5",
          minithumbnail: {
            _: "minithumbnail",
            width: 8,
            height: 8,
            data: "YQ==",
          },
          small: {
            id: 70,
            size: 4,
            local: {
              is_downloading_completed: false,
              is_downloading_active: false,
              path: "",
              downloaded_size: 0,
            },
          },
        },
      }),
    );
    bridge.handlers.set("downloadFile", () => ({
      id: 70,
      size: 4,
      local: {
        is_downloading_completed: false,
        is_downloading_active: true,
        path: "",
        downloaded_size: 0,
      },
    }));
    await repository.hydrate();
    const page = await repository.listChatPage({ limit: 50 });
    expect(page.items[0]).toMatchObject({
      id: "11",
      avatarPending: false,
      avatarDataUrl: "data:image/jpeg;base64,YQ==",
    });
    expect(
      events.some(
        (event) =>
          event.type === "chat-avatar" &&
          event.chatId === "11" &&
          event.avatarDataUrl === "data:image/jpeg;base64,YQ==",
      ),
    ).toBe(true);
    expect(
      bridge.invokes.some(
        (item) =>
          (item as { _: string; file_id?: number })._ === "downloadFile" &&
          (item as { file_id?: number }).file_id === 70,
      ),
    ).toBe(true);
  });

  it("returns the current user minithumbnail when downloadFile is still running", async () => {
    const { repository, bridge } = setup();
    bridge.handlers.set("getMe", () =>
      tdUser(1, {
        profile_photo: {
          _: "profilePhoto",
          id: "9",
          minithumbnail: {
            _: "minithumbnail",
            width: 8,
            height: 8,
            data: "bWU=",
          },
          small: {
            id: 22,
            size: 4,
            local: {
              is_downloading_completed: false,
              is_downloading_active: false,
              path: "",
              downloaded_size: 0,
            },
          },
        },
      }),
    );
    bridge.handlers.set("downloadFile", () => ({
      id: 22,
      size: 4,
      local: {
        is_downloading_completed: false,
        is_downloading_active: true,
        path: "",
        downloaded_size: 0,
      },
    }));
    const me = await repository.getCurrentUser();
    expect(me.avatarDataUrl).toBe("data:image/jpeg;base64,bWU=");
    expect(me.avatarPending).toBe(false);
  });

  it("calls getUser for the current account when getMe omits the profile photo", async () => {
    const { repository, bridge } = setup();
    const source = path.join(
      os.tmpdir(),
      `telo-avatar-me-getuser-${Date.now()}.jpg`,
    );
    writeFileSync(source, "jpeg");
    bridge.handlers.set("getMe", () => tdUser(1));
    bridge.handlers.set("getUser", (request) => {
      if (Number(request.user_id) !== 1) return tdUser(Number(request.user_id));
      return tdUser(1, {
        profile_photo: {
          _: "profilePhoto",
          id: "9",
          small: {
            id: 22,
            size: 4,
            local: {
              is_downloading_completed: false,
              is_downloading_active: false,
              path: "",
              downloaded_size: 0,
            },
          },
        },
      });
    });
    bridge.handlers.set("downloadFile", () => ({
      id: 22,
      size: 4,
      local: {
        is_downloading_completed: true,
        is_downloading_active: false,
        path: source,
        downloaded_size: 4,
      },
    }));
    const me = await repository.getCurrentUser();
    expect(
      bridge.invokes.some(
        (item) =>
          (item as { _: string; user_id?: number })._ === "getUser" &&
          (item as { user_id?: number }).user_id === 1,
      ),
    ).toBe(true);
    expect(me.avatarDataUrl).toMatch(/telo-media:\/\/cache\/avatar_1\.jpg/);
  });

  it("downloads an unready sticker file and retries send", async () => {
    const { repository, bridge } = setup();
    const sticker = tdSticker(8);
    bridge.handlers.set("searchStickers", () => ({ stickers: [sticker] }));
    await repository.searchStickers("octopus");
    let attempts = 0;
    bridge.handlers.set("sendMessage", () => {
      attempts += 1;
      if (attempts === 1) throw new Error("FILE not found");
      return tdMessage(10);
    });
    bridge.handlers.set("downloadFile", () => ({
      id: 8,
      size: 10,
      local: {
        is_downloading_completed: true,
        is_downloading_active: false,
        path: "/tmp/sticker.webp",
        downloaded_size: 10,
      },
    }));
    expect((await repository.sendSticker("11", "tdfile:8", "sid")).id).toBe(
      "10",
    );
    expect(attempts).toBe(2);
    expect(
      bridge.invokes.some(
        (item) => (item as { _: string })._ === "downloadFile",
      ),
    ).toBe(true);
    const send = bridge.invokes.find(
      (item) =>
        (item as { _: string; input_message_content?: { _: string } })._ ===
          "sendMessage" &&
        (item as { input_message_content?: { _: string } })
          .input_message_content?._ === "inputMessageSticker",
    ) as {
      input_message_content: {
        emoji: string;
        sticker: { width: number; height: number };
      };
      options: { sending_id: number };
    };
    expect(send.input_message_content.emoji).toBe("🐙");
    expect(send.input_message_content.sticker).toMatchObject({
      width: 512,
      height: 512,
    });
    expect(send.options.sending_id).toBeGreaterThan(0);
  });

  it("loads history, shared media, pins, and members", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    const history = await repository.listMessagePage("11", { limit: 50 });
    expect(history.items.map((item) => item.id)).toEqual(["1", "2"]);
    expect(
      (await repository.listSharedMedia("11", { limit: 50 })).items,
    ).toHaveLength(1);
    expect(await repository.listPinnedMessages("11")).toHaveLength(1);

    bridge.handlers.set("getSupergroupMembers", () => ({
      _: "chatMembers",
      total_count: 1,
      members: [{ member_id: { _: "messageSenderUser", user_id: 1 } }],
    }));
    bridge.emit({
      _: "updateNewChat",
      chat: tdChat(22, {
        type: { _: "chatTypeSupergroup", supergroup_id: 5, is_channel: false },
      }),
    } as Td.Update);
    expect(await repository.listChatMembers("22")).toEqual([
      {
        id: "1",
        displayName: "Ada Byron",
        username: "ada",
        avatarDataUrl: null,
        avatarPending: true,
      },
    ]);
  });

  it("maps sticker catalog, favorites, search, and send", async () => {
    const { repository, bridge } = setup();
    const sticker = tdSticker(8);
    bridge.handlers.set("getInstalledStickerSets", () => ({
      _: "stickerSets",
      total_count: 1,
      sets: [{ id: "9", title: "Pack", name: "pack" }],
    }));
    bridge.handlers.set("getRecentStickers", () => ({ stickers: [sticker] }));
    bridge.handlers.set("getFavoriteStickers", () => ({ stickers: [sticker] }));
    bridge.handlers.set("getStickerSet", () => ({
      id: "9",
      title: "Pack",
      name: "pack",
      is_installed: true,
      stickers: [sticker],
    }));
    bridge.handlers.set("searchStickers", () => ({ stickers: [sticker] }));
    bridge.handlers.set("sendMessage", () => tdMessage(10));
    const catalog = await repository.getStickerCatalog();
    expect(catalog.sets[0]?.reference).toEqual({ kind: "id", id: "9" });
    await repository.setStickerFavorite("tdfile:8", true);
    await repository.setStickerFavorite("tdfile:8", false);
    expect(bridge.invokes.map((item) => (item as { _: string })._)).toEqual(
      expect.arrayContaining(["addFavoriteSticker", "removeFavoriteSticker"]),
    );
    expect(await repository.searchStickers("octopus")).toHaveLength(1);
    expect((await repository.sendSticker("11", "tdfile:8")).id).toBe("10");
  });

  it("sends, edits, deletes, forwards, and answers callbacks", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    bridge.handlers.set("sendMessage", () => tdMessage(20));
    const sent = await repository.sendMessage("11", "hello", undefined, "c1");
    expect(sent.clientId).toBe("c1");
    await repository.editMessage({ chatId: "11", messageId: "20", body: "hi" });
    await repository.deleteMessage({
      chatId: "11",
      messageId: "20",
      scope: "everyone",
    });
    await repository.forwardMessage({
      fromChatId: "11",
      messageId: "20",
      toChatId: "12",
      hideSender: true,
    });
    bridge.emit({
      _: "updateNewMessage",
      message: {
        ...tdMessage(21),
        reply_markup: {
          _: "replyMarkupInlineKeyboard",
          rows: [
            [
              {
                text: "Go",
                type: { _: "inlineKeyboardButtonTypeCallback", data: "abc" },
              },
            ],
          ],
        },
      },
    } as Td.Update);
    bridge.handlers.set("getCallbackQueryAnswer", () => ({
      text: "ok",
      show_alert: false,
      url: "",
    }));
    await expect(
      repository.answerBotCallback("11", "21", "0:0"),
    ).resolves.toEqual({ kind: "message", text: "ok", alert: false });
  });

  it("publishes file, list-order, and connection updates", async () => {
    const { repository, bridge, events, cache } = setup();
    await repository.hydrate();
    const source = path.join(os.tmpdir(), `telo-src-${Date.now()}.bin`);
    writeFileSync(source, "payload");
    bridge.emit({
      _: "updateFile",
      file: {
        id: 8,
        size: 10,
        local: {
          is_downloading_completed: true,
          is_downloading_active: false,
          path: source,
          downloaded_size: 10,
        },
      },
    } as Td.Update);
    await vi.waitFor(() => {
      expect(
        events.some(
          (event) => event.type === "media-download" && event.state === "ready",
        ),
      ).toBe(true);
    });
    expect(cache.length).toBeGreaterThan(0);
    bridge.emit({
      _: "updateChatPosition",
      chat_id: 11,
      position: {
        _: "chatPosition",
        list: { _: "chatListMain" },
        order: "9999",
        is_pinned: true,
      },
    } as Td.Update);
    bridge.emit({
      _: "updateConnectionState",
      state: { _: "connectionStateReady" },
    } as Td.Update);
    expect(events).toContainEqual({
      type: "connection-state",
      state: "connected",
    });
    await repository.setChatPinned("11", true);
    await repository.setChatMuted("11", true);
    await repository.setChatRead("11", true);
    await repository.setChatArchived("11", true);
    await repository.setTyping("11", true);
    await repository.saveDraft("11", "later");
    await repository.setMessageReaction({
      chatId: "11",
      messageId: "1",
      emoji: "👍",
    });
    expect(await repository.listAvailableReactions("11")).toEqual(["👍"]);
  });

  it("searches globally and by chat", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    bridge.handlers.set("searchChats", () => ({ chat_ids: [11] }));
    bridge.handlers.set("searchMessages", () => ({
      messages: [tdMessage(4)],
    }));
    const global = await repository.searchGlobal("hello");
    expect(global.chats).toHaveLength(1);
    expect(global.messages).toHaveLength(1);
    const page = await repository.searchMessages("11", "hello", {});
    expect(page.messageIds).toEqual(["3"]);
  });

  it("resolves peer profiles, stickers by id, media send, and logout", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    bridge.handlers.set("getUser", () => tdUser(11));
    bridge.handlers.set("getUserFullInfo", () => ({
      _: "userFullInfo",
      bio: { _: "formattedText", text: "bio", entities: [] },
    }));
    expect(await repository.getPeerProfile("11")).toMatchObject({
      id: "11",
      title: "Ada Byron",
      bio: "bio",
    });
    bridge.handlers.set("getStickerSet", () => ({
      id: "9",
      title: "Pack",
      name: "pack",
      is_installed: true,
      stickers: [tdSticker(8)],
    }));
    expect(
      (await repository.getStickerSet({ kind: "id", id: "9" })).shortName,
    ).toBe("pack");
    await repository.reorderStickerSets(["9"]);
    await repository.removeRecentSticker("tdfile:8");
    await repository.clearRecentStickers();
    bridge.handlers.set("getCustomEmojiStickers", () => ({
      stickers: [tdSticker(8)],
    }));
    expect(await repository.getCustomEmoji(["1"])).toHaveLength(1);
    bridge.handlers.set("sendMessage", () => tdMessage(30));
    const uploaded = await repository.sendMedia(
      "11",
      [
        {
          source: "/tmp/a.jpg",
          name: "a.jpg",
          mimeType: "image/jpeg",
          size: 10,
        },
      ],
      "cap",
      undefined,
      "cid",
      "up1",
    );
    expect(uploaded[0]?.clientId).toBe("cid");
    expect(bridge.invokes).toContainEqual(
      expect.objectContaining({
        _: "sendMessage",
        input_message_content: expect.objectContaining({
          _: "inputMessagePhoto",
        }),
      }),
    );
    await repository.cancelMediaUpload("up1");
    await repository.cancelMediaDownload("tdfile:8");
    await repository.logout();
  });

  it("copies a completed chat photo into the avatar cache", async () => {
    const { repository, events, bridge } = setup();
    const source = path.join(os.tmpdir(), `telo-avatar-${Date.now()}.jpg`);
    writeFileSync(source, "jpeg");
    bridge.handlers.set("getChat", () =>
      tdChat(11, {
        photo: {
          _: "chatPhotoInfo",
          small: {
            id: 44,
            size: 4,
            local: {
              is_downloading_completed: true,
              is_downloading_active: false,
              path: source,
              downloaded_size: 4,
            },
          },
        },
      }),
    );
    await repository.hydrate();
    await vi.waitFor(() => {
      expect(
        events.some(
          (event) =>
            event.type === "chat-avatar" &&
            event.avatarDataUrl?.includes("avatar_11"),
        ),
      ).toBe(true);
    });
    const page = await repository.listChatPage({ limit: 50 });
    expect(page.items[0]?.avatarDataUrl).toMatch(
      /telo-media:\/\/cache\/avatar_11\.jpg/,
    );
    expect(page.items[0]?.avatarPending).toBe(false);
  });

  it("downloads an incomplete chat photo and stays pending until updateFile", async () => {
    const { repository, events, bridge } = setup();
    const source = path.join(os.tmpdir(), `telo-avatar-dl-${Date.now()}.jpg`);
    writeFileSync(source, "jpeg");
    bridge.handlers.set("getChat", () =>
      tdChat(11, {
        photo: {
          _: "chatPhotoInfo",
          small: {
            id: 45,
            size: 4,
            local: {
              is_downloading_completed: false,
              is_downloading_active: false,
              path: "",
              downloaded_size: 0,
            },
          },
        },
      }),
    );
    bridge.handlers.set("downloadFile", () => ({
      id: 45,
      size: 4,
      local: {
        is_downloading_completed: false,
        is_downloading_active: true,
        path: "",
        downloaded_size: 0,
      },
    }));
    await repository.hydrate();
    expect(
      (await repository.listChatPage({ limit: 50 })).items[0],
    ).toMatchObject({
      avatarPending: true,
      avatarDataUrl: null,
    });
    expect(
      bridge.invokes.some(
        (item) => (item as { _: string })._ === "downloadFile",
      ),
    ).toBe(true);
    bridge.emit({
      _: "updateFile",
      file: {
        id: 45,
        size: 4,
        local: {
          is_downloading_completed: true,
          is_downloading_active: false,
          path: source,
          downloaded_size: 4,
        },
      },
    } as Td.Update);
    await vi.waitFor(() => {
      expect(
        events.some(
          (event) => event.type === "chat-avatar" && event.avatarDataUrl,
        ),
      ).toBe(true);
    });
    expect(
      events.some(
        (event) =>
          event.type === "media-download" && event.mediaId === "tdfile:45",
      ),
    ).toBe(false);
  });

  it("expires typing after six seconds", async () => {
    vi.useFakeTimers();
    try {
      const { repository, events, bridge } = setup();
      await repository.hydrate();
      events.length = 0;
      bridge.emit({
        _: "updateChatAction",
        chat_id: 11,
        action: { _: "chatActionTyping" },
      } as Td.Update);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "chat-upsert",
          chat: expect.objectContaining({ id: "11", typing: true }),
        }),
      );
      await vi.advanceTimersByTimeAsync(6_000);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "chat-upsert",
          chat: expect.objectContaining({ id: "11", typing: false }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps secret-chat pending from getSecretChat", async () => {
    const { repository, bridge } = setup();
    bridge.handlers.set("createNewSecretChat", () =>
      tdChat(-99, {
        type: { _: "chatTypeSecret", user_id: 11, secret_chat_id: 4 },
        title: "Mina",
      }),
    );
    bridge.handlers.set("getSecretChat", () => ({
      _: "secretChat",
      id: 4,
      user_id: 11,
      state: { _: "secretChatStatePending" },
    }));
    const created = await repository.createSecretChat("11");
    expect(created.kind).toBe("secret");
    expect(created.secretState).toBe("pending");
  });

  it("hydrates a same-chat reply through getRepliedMessage", async () => {
    const { repository, bridge } = setup();
    bridge.handlers.set("getChatHistory", () => ({
      _: "messages",
      total_count: 1,
      messages: [
        {
          ...tdMessage(4),
          is_outgoing: false,
          sender_id: { _: "messageSenderUser", user_id: 11 },
          reply_to: {
            _: "messageReplyToMessage",
            chat_id: 11,
            message_id: 2,
          },
        },
      ],
    }));
    bridge.handlers.set("getRepliedMessage", () => ({
      ...tdMessage(2),
      is_outgoing: false,
      sender_id: { _: "messageSenderUser", user_id: 11 },
      content: {
        _: "messageText",
        text: { _: "formattedText", text: "original", entities: [] },
      },
    }));
    await repository.hydrate();
    const page = await repository.listMessagePage("11", { limit: 50 });
    expect(page.items[0]?.replyTo).toMatchObject({
      id: "2",
      senderName: "Ada Byron",
      body: "original",
    });
  });

  it("emits outbox read receipts from updateChatReadOutbox", async () => {
    const { repository, events, bridge } = setup();
    await repository.hydrate();
    events.length = 0;
    bridge.emit({
      _: "updateChatReadOutbox",
      chat_id: 11,
      last_read_outbox_message_id: 8,
    } as Td.Update);
    expect(events).toContainEqual({
      type: "message-read",
      chatId: "11",
      maxMessageId: "8",
      direction: "outbox",
    });
  });

  it("lists basic-group members via getBasicGroupFullInfo", async () => {
    const { repository, bridge } = setup();
    bridge.handlers.set("getChat", () =>
      tdChat(-5, {
        type: { _: "chatTypeBasicGroup", basic_group_id: 5 },
        title: "Design",
      }),
    );
    bridge.handlers.set("getChats", () => ({
      _: "chats",
      chat_ids: [-5],
      total_count: 1,
    }));
    bridge.handlers.set("getBasicGroupFullInfo", () => ({
      _: "basicGroupFullInfo",
      members: [
        {
          member_id: { _: "messageSenderUser", user_id: 11 },
        },
      ],
    }));
    await repository.hydrate();
    const members = await repository.listChatMembers("-5");
    expect(members).toEqual([
      expect.objectContaining({
        id: "11",
        displayName: "Ada Byron",
        username: "ada",
      }),
    ]);
  });
});
