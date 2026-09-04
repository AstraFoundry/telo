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

function tdUser(id: number): Td.user {
  return {
    _: "user",
    id,
    first_name: "Ada",
    last_name: "Byron",
    usernames: { active_usernames: ["ada"] },
    phone_number: "+1555",
    status: { _: "userStatusOnline", expires: 1 },
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
    await repository.cancelMediaUpload("up1");
    await repository.cancelMediaDownload("tdfile:8");
    await repository.logout();
  });
});
