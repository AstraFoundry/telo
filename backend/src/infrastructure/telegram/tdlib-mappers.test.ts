import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type * as Td from "tdlib-types";

import {
  chatIdOf,
  compareListOrder,
  fileIdFromMediaId,
  initials,
  mapAuthorizationStatus,
  mapChat,
  mapChatKind,
  mapConnectionState,
  mapFolders,
  mapMessage,
  mediaIdForFile,
} from "./tdlib-mappers";

const goldenRoot = path.dirname(fileURLToPath(import.meta.url));

function loadGolden<T>(name: string): T {
  return JSON.parse(
    readFileSync(path.join(goldenRoot, "goldens", name), "utf8"),
  ) as T;
}

const emptyContext = {
  selfUserId: 1,
  avatarUrl: () => null,
  avatarPending: () => false,
};

function chat(partial: Record<string, unknown>): Td.chat {
  return {
    _: "chat",
    id: 11,
    type: { _: "chatTypePrivate", user_id: 11 },
    title: "Ada",
    unread_count: 0,
    last_read_inbox_message_id: 0,
    last_read_outbox_message_id: 0,
    unread_mention_count: 0,
    unread_reaction_count: 0,
    notification_settings: { _: "chatNotificationSettings", mute_for: 0 },
    positions: [
      {
        _: "chatPosition",
        list: { _: "chatListMain" },
        order: "100",
        is_pinned: false,
      },
    ],
    ...partial,
  } as unknown as Td.chat;
}

describe("tdlib mappers", () => {
  it("maps authorization and connection states", () => {
    expect(
      mapAuthorizationStatus({ _: "authorizationStateWaitPhoneNumber" }),
    ).toBe("idle");
    expect(
      mapAuthorizationStatus({
        _: "authorizationStateWaitCode",
      } as Td.AuthorizationState),
    ).toBe("code-required");
    expect(
      mapAuthorizationStatus({
        _: "authorizationStateWaitPassword",
        password_hint: "hint",
        has_recovery_email_address: false,
        has_passport_data: false,
      } as Td.AuthorizationState),
    ).toBe("password-required");
    expect(mapAuthorizationStatus({ _: "authorizationStateReady" })).toBe(
      "ready",
    );
    expect(
      mapAuthorizationStatus({ _: "authorizationStateWaitTdlibParameters" }),
    ).toBe("idle");
    expect(mapConnectionState({ _: "connectionStateReady" })).toBe("connected");
    expect(mapConnectionState({ _: "connectionStateUpdating" })).toBe(
      "synchronizing",
    );
    expect(mapConnectionState({ _: "connectionStateWaitingForNetwork" })).toBe(
      "offline",
    );
  });

  it("maps chat kinds including secret and saved", () => {
    expect(
      mapChatKind(
        chat({ type: { _: "chatTypeSecret", user_id: 2, secret_chat_id: 9 } }),
        1,
      ),
    ).toBe("secret");
    expect(
      mapChatKind(
        chat({
          type: { _: "chatTypeSupergroup", supergroup_id: 3, is_channel: true },
        }),
        1,
      ),
    ).toBe("channel");
    expect(
      mapChatKind(
        chat({
          type: {
            _: "chatTypeSupergroup",
            supergroup_id: 3,
            is_channel: false,
          },
        }),
        1,
      ),
    ).toBe("group");
    expect(
      mapChatKind(chat({ type: { _: "chatTypePrivate", user_id: 1 } }), 1),
    ).toBe("saved");
    expect(
      mapChatKind(chat({ type: { _: "chatTypePrivate", user_id: 11 } }), 1),
    ).toBe("direct");
  });

  it("maps chats with list order, mute, pin, and archive folder", () => {
    const mapped = mapChat(
      chat({
        unread_count: 3,
        last_read_inbox_message_id: 9,
        notification_settings: { _: "chatNotificationSettings", mute_for: 60 },
        positions: [
          {
            _: "chatPosition",
            list: { _: "chatListArchive" },
            order: "200",
            is_pinned: true,
          },
        ],
        last_message: {
          _: "message",
          date: 1700000000,
          content: {
            _: "messageText",
            text: { _: "formattedText", text: "Hi", entities: [] },
          },
        },
        draft_message: {
          _: "draftMessage",
          content: {
            _: "draftMessageContentText",
            text: { _: "formattedText", text: "draft", entities: [] },
          },
        },
      }),
      emptyContext,
    );
    expect(mapped).toMatchObject({
      id: "11",
      title: "Ada",
      preview: "Hi",
      unreadCount: 3,
      lastReadMessageId: "9",
      muted: true,
      pinned: true,
      kind: "direct",
      draftPreview: "draft",
      folderId: 1,
      listOrder: "200",
    });
  });

  it("sorts TDLib list-order strings highest first", () => {
    expect(compareListOrder("9", "10")).toBeGreaterThan(0);
    expect(compareListOrder("100", "20")).toBeLessThan(0);
    expect(compareListOrder("5", "5")).toBe(0);
  });

  it("maps folders and injects Archive when chats sit there", () => {
    const chats = [
      mapChat(
        chat({
          positions: [
            {
              _: "chatPosition",
              list: { _: "chatListArchive" },
              order: "1",
              is_pinned: false,
            },
          ],
          unread_count: 2,
        }),
        emptyContext,
      ),
    ];
    expect(
      mapFolders(
        [
          {
            _: "chatFolderInfo",
            id: 2,
            name: {
              _: "chatFolderName",
              text: { _: "formattedText", text: "Work", entities: [] },
            },
          } as unknown as Td.chatFolderInfo,
        ],
        chats,
      ),
    ).toEqual([
      { id: 1, title: "Archive", unreadCount: 2 },
      { id: 2, title: "Work", unreadCount: 0 },
    ]);
  });

  it("maps a checked-in td_api message JSON onto MessageDto", () => {
    const message = loadGolden<Td.message>("message-text.json");
    const mapped = mapMessage(message, {
      ...emptyContext,
      senderName: () => "Mina",
      senderId: () => "7",
    });
    expect(mapped).toMatchObject({
      id: "42",
      chatId: "11",
      senderName: "Mina",
      senderId: "7",
      body: "Hello **Ada**",
      entities: [{ offset: 6, length: 5, type: "bold" }],
      outgoing: false,
      reactions: [{ emoji: "👍", count: 2, chosen: true }],
    });
  });

  it("maps media kinds and file ids", () => {
    expect(mediaIdForFile(8)).toBe("tdfile:8");
    expect(fileIdFromMediaId("tdfile:8")).toBe(8);
    expect(fileIdFromMediaId("other")).toBeNull();
    expect(chatIdOf(11)).toBe("11");
    expect(initials("Ada Byron")).toBe("AB");
    expect(initials("Ada")).toBe("AD");
    expect(initials("")).toBe("?");

    const photo = mapMessage(
      {
        _: "message",
        id: 1,
        chat_id: 11,
        is_outgoing: true,
        date: 1,
        edit_date: 0,
        media_album_id: "0",
        content: {
          _: "messagePhoto",
          photo: {
            sizes: [{ width: 10, height: 10, photo: { id: 8, size: 12 } }],
          },
          has_spoiler: true,
        },
      } as unknown as Td.message,
      { ...emptyContext, senderName: () => "", senderId: () => "" },
    );
    expect(photo.media).toMatchObject({
      id: "tdfile:8",
      kind: "photo",
      spoiler: true,
    });

    const sticker = mapMessage(
      {
        _: "message",
        id: 2,
        chat_id: 11,
        is_outgoing: false,
        date: 1,
        edit_date: 0,
        media_album_id: "0",
        sender_id: { _: "messageSenderUser", user_id: 7 },
        content: {
          _: "messageSticker",
          sticker: {
            emoji: "🐙",
            width: 512,
            height: 512,
            set_id: "9",
            format: { _: "stickerFormatWebp" },
            sticker: { id: 3, size: 10 },
          },
        },
      } as unknown as Td.message,
      {
        ...emptyContext,
        senderName: () => "Mina",
        senderId: () => "7",
      },
    );
    expect(sticker.media).toMatchObject({
      kind: "sticker",
      sticker: {
        emoji: "🐙",
        format: "static",
        setReference: { kind: "id", id: "9" },
      },
    });
  });
});
