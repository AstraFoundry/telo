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
    type: { _: "userTypeRegular" },
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

function tdFile(
  id: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    size: 4,
    local: {
      is_downloading_completed: false,
      is_downloading_active: false,
      path: "",
      downloaded_size: 0,
    },
    ...extra,
  };
}

function tdPhotoSize(
  type: string,
  width: number,
  height: number,
  fileId: number,
): Record<string, unknown> {
  return {
    _: "photoSize",
    type,
    width,
    height,
    photo: tdFile(fileId),
  };
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

  it("lists contacts and opens a private chat", async () => {
    const { repository, bridge, events } = setup();
    bridge.handlers.set("getContacts", () => ({
      _: "users",
      total_count: 1,
      user_ids: [11],
    }));
    bridge.handlers.set("createPrivateChat", () => tdChat(11));

    await expect(repository.listContacts()).resolves.toEqual([
      expect.objectContaining({
        id: "11",
        displayName: "Ada Byron",
        username: "ada",
      }),
    ]);
    const chat = await repository.openPrivateChat("11");
    expect(chat.id).toBe("11");
    expect(events).toContainEqual({ type: "chat-upsert", chat });
  });

  it("resolves addContactByPhone to null when the number never joined", async () => {
    const { repository, bridge } = setup();
    // importContacts answers user id 0 for an unregistered number; tdesktop
    // shows the "not joined" state rather than an error.
    bridge.handlers.set("importContacts", () => ({
      _: "importedContacts",
      user_ids: [0],
      importer_count: [0],
    }));

    await expect(
      repository.addContactByPhone({
        firstName: "Mina",
        lastName: "",
        phone: "+1 (555) 0142",
      }),
    ).resolves.toBeNull();
    expect(bridge.invokes).toContainEqual({
      _: "importContacts",
      contacts: [
        {
          _: "importedContact",
          // The adapter normalizes to digits plus an optional leading +.
          phone_number: "+15550142",
          first_name: "Mina",
          last_name: "",
          note: { _: "formattedText", text: "", entities: [] },
        },
      ],
    });
  });

  it("imports a registered phone number as a contact", async () => {
    const { repository, bridge } = setup();
    bridge.handlers.set("importContacts", () => ({
      _: "importedContacts",
      user_ids: [11],
      importer_count: [0],
    }));

    await expect(
      repository.addContactByPhone({
        firstName: "Ada",
        lastName: "Byron",
        phone: "+1 555 0142",
      }),
    ).resolves.toMatchObject({ id: "11", displayName: "Ada Byron" });
  });

  it("renames the account and returns the refreshed identity", async () => {
    const { repository, bridge } = setup();
    let firstName = "Ada";
    let lastName = "Byron";
    // getCurrentUser refetches through getUser when the photo is unknown, so
    // both identity reads must follow the rename.
    bridge.handlers.set("getMe", () =>
      tdUser(1, { first_name: firstName, last_name: lastName }),
    );
    bridge.handlers.set("getUser", (request) =>
      tdUser(Number(request.user_id), {
        first_name: firstName,
        last_name: lastName,
      }),
    );
    bridge.handlers.set("setName", (request) => {
      firstName = String(request.first_name);
      lastName = String(request.last_name);
      return { _: "ok" };
    });

    const updated = await repository.updateProfileName({
      firstName: "Grace",
      lastName: "Hopper",
    });
    expect(updated.displayName).toBe("Grace Hopper");
    expect(bridge.invokes).toContainEqual({
      _: "setName",
      first_name: "Grace",
      last_name: "Hopper",
    });
  });

  it("maps username checks on the Saved Messages chat", async () => {
    const { repository, bridge } = setup();
    for (const [tdResult, expected] of [
      ["checkChatUsernameResultOk", "available"],
      ["checkChatUsernameResultUsernameInvalid", "invalid"],
      ["checkChatUsernameResultUsernameOccupied", "taken"],
      ["checkChatUsernameResultUsernamePurchasable", "unknown"],
    ] as const) {
      bridge.handlers.set("checkChatUsername", () => ({ _: tdResult }));
      await expect(repository.checkUsernameAvailability("telo")).resolves.toBe(
        expected,
      );
    }
    // The Saved Messages chat id is the account's own user id.
    expect(bridge.invokes).toContainEqual({
      _: "checkChatUsername",
      chat_id: 1,
      username: "telo",
    });
  });

  it("emits current-user when the self profile changes arrive as updates", async () => {
    const { repository, bridge, events } = setup();
    await repository.hydrate();
    events.length = 0;

    bridge.emit({ _: "updateUser", user: tdUser(1) } as Td.Update);
    bridge.emit({
      _: "updateUserFullInfo",
      user_id: 1,
      user_full_info: { _: "userFullInfo" },
    } as unknown as Td.Update);
    // Another user's updates never reload the identity card.
    bridge.emit({ _: "updateUser", user: tdUser(11) } as Td.Update);
    bridge.emit({
      _: "updateUserFullInfo",
      user_id: 11,
      user_full_info: { _: "userFullInfo" },
    } as unknown as Td.Update);
    await vi.waitFor(() => {
      // Other users' updates may still upsert their chats; only the two self
      // updates (user and full info) fire current-user.
      const currentUserEvents = events.filter(
        (event) => event.type === "current-user",
      );
      expect(currentUserEvents).toEqual([
        { type: "current-user" },
        { type: "current-user" },
      ]);
    });
  });

  it("creates basic groups and channels through TDLib", async () => {
    const { repository, bridge } = setup();
    bridge.handlers.set("createNewBasicGroupChat", () => ({
      _: "createdBasicGroupChat",
      chat_id: 22,
      failed_to_add_members: {
        _: "failedToAddMembers",
        failed_to_add_members: [],
      },
    }));
    bridge.handlers.set("getChat", (request) =>
      tdChat(Number(request.chat_id), {
        type: { _: "chatTypeBasicGroup", basic_group_id: 22 },
        title: "Design",
      }),
    );
    bridge.handlers.set("createNewSupergroupChat", () =>
      tdChat(33, {
        type: {
          _: "chatTypeSupergroup",
          supergroup_id: 33,
          is_channel: true,
        },
        title: "Announcements",
      }),
    );

    await expect(
      repository.createGroup({ title: "Design", userIds: ["11"] }),
    ).resolves.toMatchObject({ kind: "group", title: "Design" });
    await expect(
      repository.createChannel({
        title: "Announcements",
        description: "Product updates",
      }),
    ).resolves.toMatchObject({ kind: "channel", title: "Announcements" });

    expect(bridge.invokes).toContainEqual(
      expect.objectContaining({
        _: "createNewBasicGroupChat",
        user_ids: [11],
      }),
    );
    expect(bridge.invokes).toContainEqual(
      expect.objectContaining({
        _: "createNewSupergroupChat",
        is_channel: true,
      }),
    );
  });

  it("creates a server folder with every filter flag off", async () => {
    const { repository, bridge } = setup();
    // Fixed reply: the invoke payload itself is asserted below.
    bridge.handlers.set("createChatFolder", () => ({
      _: "chatFolderInfo",
      id: 2,
      name: {
        _: "chatFolderName",
        text: { _: "formattedText", text: "Work", entities: [] },
      },
      icon: { _: "chatFolderIcon", name: "Work" },
    }));

    const created = await repository.createChatFolder({
      title: "Work",
      chatIds: ["11"],
    });

    expect(created).toEqual({ id: 2, title: "Work", unreadCount: 0 });
    expect(bridge.invokes).toContainEqual({
      _: "createChatFolder",
      folder: {
        _: "chatFolder",
        name: {
          _: "chatFolderName",
          text: { _: "formattedText", text: "Work", entities: [] },
        },
        pinned_chat_ids: [],
        included_chat_ids: [11],
        excluded_chat_ids: [],
        exclude_muted: false,
        exclude_read: false,
        exclude_archived: false,
        include_contacts: false,
        include_non_contacts: false,
        include_bots: false,
        include_groups: false,
        include_channels: false,
      },
    });
  });

  it("reads one folder's edit state and preserves untouched flags on edit", async () => {
    const { repository, bridge } = setup();
    bridge.emit({
      _: "updateChatFolders",
      chat_folders: [
        {
          _: "chatFolderInfo",
          id: 2,
          name: {
            _: "chatFolderName",
            text: { _: "formattedText", text: "Work", entities: [] },
          },
          icon: { _: "chatFolderIcon", name: "Work" },
        },
      ],
    } as unknown as Td.Update);
    // The existing filter keeps excluded chats, the exclude-muted switch and
    // an in-folder pin; the edit only renames and re-includes.
    bridge.handlers.set("getChatFolder", () => ({
      _: "chatFolder",
      name: {
        _: "chatFolderName",
        text: { _: "formattedText", text: "Work", entities: [] },
      },
      color_id: -1,
      is_shareable: false,
      pinned_chat_ids: [22],
      included_chat_ids: [11, 22],
      excluded_chat_ids: [33],
      exclude_muted: true,
      exclude_read: false,
      exclude_archived: false,
      include_contacts: false,
      include_non_contacts: false,
      include_bots: false,
      include_groups: false,
      include_channels: false,
    }));
    bridge.handlers.set("editChatFolder", (request) => ({
      _: "chatFolderInfo",
      id: Number(request.chat_folder_id),
      name: {
        _: "chatFolderName",
        text: { _: "formattedText", text: "Studio", entities: [] },
      },
      icon: { _: "chatFolderIcon", name: "Work" },
    }));

    await expect(repository.getChatFolder(2)).resolves.toEqual({
      id: 2,
      title: "Work",
      includedChatIds: ["22", "11"],
    });
    // Unknown ids answer from the cached folder list without asking TDLib.
    await expect(repository.getChatFolder(99)).resolves.toBeNull();

    const edited = await repository.editChatFolder({
      id: 2,
      title: "Studio",
      chatIds: ["11"],
    });

    expect(edited).toEqual({ id: 2, title: "Studio", unreadCount: 0 });
    expect(bridge.invokes).toContainEqual({
      _: "editChatFolder",
      chat_folder_id: 2,
      folder: expect.objectContaining({
        name: {
          _: "chatFolderName",
          text: { _: "formattedText", text: "Studio", entities: [] },
        },
        // Chat 22 left the folder, so its in-folder pin goes with it; the
        // exclusions and flags survive untouched.
        pinned_chat_ids: [],
        included_chat_ids: [11],
        excluded_chat_ids: [33],
        exclude_muted: true,
      }),
    });
  });

  it("deletes a server folder through TDLib", async () => {
    const { repository, bridge } = setup();

    await repository.deleteChatFolder(2);

    expect(bridge.invokes).toContainEqual({
      _: "deleteChatFolder",
      chat_folder_id: 2,
    });
  });

  it("maps TDLib call history", async () => {
    const { repository, bridge } = setup();
    bridge.handlers.set("searchCallMessages", () => ({
      _: "foundMessages",
      total_count: 1,
      next_offset: "next",
      messages: [
        {
          ...tdMessage(7, 11),
          is_outgoing: false,
          content: {
            _: "messageCall",
            unique_id: "call-7",
            is_video: true,
            discard_reason: { _: "callDiscardReasonMissed" },
            duration: 0,
          },
        },
      ],
    }));

    await expect(repository.listCalls()).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "7",
          chatId: "11",
          kind: "missed",
          video: true,
        }),
      ],
      nextCursor: "next",
    });
  });

  it("posts a photo story on behalf of the current user", async () => {
    const { repository, bridge } = setup();
    bridge.handlers.set("createPrivateChat", () =>
      tdChat(1, { type: { _: "chatTypePrivate", user_id: 1 } }),
    );
    bridge.handlers.set("postStory", () => ({
      _: "story",
      id: 9,
      poster_chat_id: 1,
      date: 1_700_000_000,
      content: { _: "storyContentPhoto", photo: {} },
    }));

    await expect(
      repository.postStory(
        {
          source: "/tmp/story.jpg",
          name: "story.jpg",
          mimeType: "image/jpeg",
          size: 1024,
        },
        { privacy: "contacts", activePeriod: 86400 },
      ),
    ).resolves.toMatchObject({
      id: "9",
      posterChatId: "1",
      video: false,
    });
    expect(bridge.invokes).toContainEqual(
      expect.objectContaining({
        _: "postStory",
        chat_id: 1,
        privacy_settings: expect.objectContaining({
          _: "storyPrivacySettingsContacts",
        }),
      }),
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

  it("sends a scheduled message with a scheduling state", async () => {
    const { repository, bridge, events } = setup();
    await repository.hydrate();
    const sendAt = Math.floor(Date.now() / 1000) + 3600;
    bridge.handlers.set("sendMessage", () => ({
      ...tdMessage(100),
      scheduling_state: {
        _: "messageSchedulingStateSendAtDate",
        send_date: sendAt,
      },
    }));

    const sent = await repository.sendMessage(
      "11",
      "later",
      undefined,
      undefined,
      undefined,
      undefined,
      sendAt,
    );

    expect(bridge.invokes).toContainEqual(
      expect.objectContaining({
        _: "sendMessage",
        scheduling_state: {
          _: "messageSchedulingStateSendAtDate",
          send_date: sendAt,
        },
      }),
    );
    expect(sent.scheduledAt).toBe(new Date(sendAt * 1000).toISOString());
    expect(events.some((event) => event.type === "scheduled-messages")).toBe(
      true,
    );
  });

  it("lists scheduled messages soonest first with their delivery time", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    bridge.handlers.set("getChatScheduledMessages", () => ({
      _: "messages",
      total_count: 2,
      messages: [
        {
          ...tdMessage(101),
          scheduling_state: {
            _: "messageSchedulingStateSendAtDate",
            send_date: 1800003600,
          },
        },
        {
          ...tdMessage(100),
          scheduling_state: {
            _: "messageSchedulingStateSendAtDate",
            send_date: 1800000000,
          },
        },
      ],
    }));

    const scheduled = await repository.listScheduledMessages("11");

    expect(bridge.invokes).toContainEqual({
      _: "getChatScheduledMessages",
      chat_id: 11,
    });
    expect(scheduled.map((message) => message.id)).toEqual(["100", "101"]);
    expect(scheduled[0]?.scheduledAt).toBe(
      new Date(1800000000 * 1000).toISOString(),
    );
  });

  it("treats a read-only chat's scheduled list as empty instead of failing", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    // TDLib's answer on a channel where the account cannot post; tdesktop
    // simply offers no scheduled view there.
    bridge.handlers.set("getChatScheduledMessages", () =>
      Promise.reject({
        _: "error",
        code: 400,
        message: "Not enough rights to get scheduled messages",
      }),
    );

    await expect(repository.listScheduledMessages("11")).resolves.toEqual([]);
  });

  it("routes a scheduled message update to the scheduled list, not the transcript", async () => {
    const { repository, bridge, events } = setup();
    await repository.hydrate();
    events.length = 0;

    bridge.emit({
      _: "updateNewMessage",
      message: {
        ...tdMessage(100),
        scheduling_state: {
          _: "messageSchedulingStateSendAtDate",
          send_date: 1800000000,
        },
      },
    } as Td.Update);

    await vi.waitFor(() => {
      expect(events).toEqual([{ type: "scheduled-messages", chatId: "11" }]);
    });
  });

  it("signals the scheduled list after a delete, covering scheduled ids", async () => {
    const { repository, events } = setup();
    await repository.hydrate();
    events.length = 0;

    await repository.deleteMessage({ chatId: "11", messageId: "100" });

    expect(events).toEqual([{ type: "scheduled-messages", chatId: "11" }]);
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
    expect(me.avatarDataUrl).toMatch(/telo-media:\/\/cache\/avatar2_1\.jpg/);
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
    expect(me.avatarDataUrl).toMatch(/telo-media:\/\/cache\/avatar2_1\.jpg/);
  });

  it("loads the current user photo from getUserFullInfo when getUser omits it", async () => {
    const { repository, bridge } = setup();
    const source = path.join(
      os.tmpdir(),
      `telo-avatar-me-full-${Date.now()}.jpg`,
    );
    writeFileSync(source, "jpeg");
    bridge.handlers.set("getMe", () => tdUser(1));
    bridge.handlers.set("getUser", () => tdUser(1));
    bridge.handlers.set("getUserFullInfo", () => ({
      _: "userFullInfo",
      photo: {
        _: "chatPhoto",
        id: "9",
        added_date: 1,
        minithumbnail: {
          _: "minithumbnail",
          width: 8,
          height: 8,
          data: "bWU=",
        },
        sizes: [
          {
            _: "photoSize",
            type: "s",
            width: 160,
            height: 160,
            photo: {
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
        ],
      },
    }));
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
        (item) => (item as { _: string })._ === "getUserFullInfo",
      ),
    ).toBe(true);
    expect(me.avatarDataUrl).toMatch(/telo-media:\/\/cache\/avatar2_1\.jpg/);
  });

  it("skips the 40px thumbnail when getUserFullInfo lists larger sizes", async () => {
    const { repository, bridge } = setup();
    const source = path.join(
      os.tmpdir(),
      `telo-avatar-me-full-sizes-${Date.now()}.jpg`,
    );
    writeFileSync(source, "jpeg");
    bridge.handlers.set("getMe", () => tdUser(1));
    bridge.handlers.set("getUser", () => tdUser(1));
    bridge.handlers.set("getUserFullInfo", () => ({
      _: "userFullInfo",
      photo: {
        _: "chatPhoto",
        id: "9",
        added_date: 1,
        sizes: [
          tdPhotoSize("s", 40, 40, 21),
          tdPhotoSize("a", 160, 160, 22),
          tdPhotoSize("c", 640, 640, 23),
        ],
      },
    }));
    bridge.handlers.set("downloadFile", (request) => {
      expect(request.file_id).toBe(23);
      return {
        id: 23,
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
    expect(
      bridge.invokes.some(
        (item) =>
          (item as { _: string; file_id?: number })._ === "downloadFile" &&
          (item as { file_id?: number }).file_id === 23,
      ),
    ).toBe(true);
    expect(
      bridge.invokes.some(
        (item) =>
          (item as { _: string; file_id?: number })._ === "downloadFile" &&
          ((item as { file_id?: number }).file_id === 21 ||
            (item as { file_id?: number }).file_id === 22),
      ),
    ).toBe(false);
    expect(me.avatarDataUrl).toMatch(/telo-media:\/\/cache\/avatar2_1\.jpg/);
  });

  it("loads a profile photo list when getUserFullInfo has no photo object", async () => {
    const { repository, bridge } = setup();
    const source = path.join(
      os.tmpdir(),
      `telo-avatar-me-photos-${Date.now()}.jpg`,
    );
    writeFileSync(source, "jpeg");
    bridge.handlers.set("getMe", () => tdUser(1));
    bridge.handlers.set("getUser", () => tdUser(1));
    bridge.handlers.set("getUserFullInfo", () => ({ _: "userFullInfo" }));
    bridge.handlers.set("getUserProfilePhotos", () => ({
      _: "chatPhotos",
      total_count: 1,
      photos: [
        {
          _: "chatPhoto",
          id: "9",
          added_date: 1,
          minithumbnail: {
            _: "minithumbnail",
            width: 8,
            height: 8,
            data: "bWU=",
          },
          sizes: [
            {
              _: "photoSize",
              type: "s",
              width: 160,
              height: 160,
              photo: {
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
          ],
        },
      ],
    }));
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
        (item) => (item as { _: string })._ === "getUserProfilePhotos",
      ),
    ).toBe(true);
    expect(me.avatarDataUrl).toMatch(/telo-media:\/\/cache\/avatar2_1\.jpg/);
  });

  it("settles a no-access user photo quietly and never retries the lookup", async () => {
    const { repository, bridge } = setup();
    // TDLib's exact answer for users the account may not resolve (min
    // updateUser shells, privacy-restricted profiles, deleted accounts).
    const noAccess = {
      _: "error",
      code: 400,
      message: "Have no access to the user",
    };
    bridge.handlers.set("getMe", () => tdUser(1));
    bridge.handlers.set("getUser", () => tdUser(1));
    bridge.handlers.set("getUserFullInfo", () => Promise.reject(noAccess));
    bridge.handlers.set("getUserProfilePhotos", () => Promise.reject(noAccess));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const me = await repository.getCurrentUser();
      // Degraded, not pending forever: the placeholder owns the disc now.
      expect(me.avatarPending).toBe(false);
      expect(me.avatarDataUrl).toBeNull();
      expect(
        errorSpy.mock.calls.filter(
          (call) =>
            typeof call[0] === "string" &&
            call[0].includes("photo lookup failed"),
        ),
      ).toHaveLength(0);
      // tdesktop/Web A behavior: the 400 is a settled answer, so a second
      // resolution must not re-issue either lookup.
      const lookups = () =>
        bridge.invokes.filter(
          (item) =>
            (item as { _: string })._ === "getUserFullInfo" ||
            (item as { _: string })._ === "getUserProfilePhotos",
        ).length;
      const before = lookups();
      await repository.getCurrentUser();
      expect(lookups()).toBe(before);
    } finally {
      errorSpy.mockRestore();
    }
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
      expect.objectContaining({
        id: "1",
        displayName: "Ada Byron",
        username: "ada",
        avatarDataUrl: null,
        avatarPending: true,
        avatarPlaceholder: {
          glyph: "A",
          lightColors: ["#E17076", "#FF885E"],
          darkColors: ["#E17076", "#FF885E"],
        },
      }),
    ]);
  });

  it("treats an unknown supergroup as degraded: quiet, cached, never retried", async () => {
    const { bridge, events } = setup();
    bridge.handlers.set("getSupergroup", () =>
      Promise.reject({
        _: "error",
        code: 400,
        message: "Supergroup not found",
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The chat entry itself still renders — TDLib owns its membership and
      // drops it from the list on sync if the group is really gone.
      bridge.emit({
        _: "updateNewChat",
        chat: tdChat(22, {
          type: {
            _: "chatTypeSupergroup",
            supergroup_id: 5,
            is_channel: false,
          },
        }),
      } as Td.Update);
      await vi.waitFor(() => {
        expect(
          bridge.invokes.some(
            (item) => (item as { _: string })._ === "getSupergroup",
          ),
        ).toBe(true);
      });
      // Degraded, not dropped: the chat still reaches the renderer with its
      // cached title and read-only access (writeAccess falls to none without
      // a supergroup status).
      await vi.waitFor(() => {
        expect(
          events.some(
            (event) => event.type === "chat-upsert" && event.chat.id === "22",
          ),
        ).toBe(true);
      });
      expect(
        errorSpy.mock.calls.filter(
          (call) =>
            typeof call[0] === "string" && call[0].includes("getSupergroup"),
        ),
      ).toHaveLength(0);

      const lookups = () =>
        bridge.invokes.filter(
          (item) => (item as { _: string })._ === "getSupergroup",
        ).length;
      const before = lookups();
      bridge.emit({
        _: "updateNewChat",
        chat: tdChat(22, {
          type: {
            _: "chatTypeSupergroup",
            supergroup_id: 5,
            is_channel: false,
          },
        }),
      } as Td.Update);
      // handleUpdate is async; two microtask turns let it settle. A known
      // unknown group must not produce another getSupergroup call.
      await Promise.resolve();
      await Promise.resolve();
      expect(lookups()).toBe(before);
    } finally {
      errorSpy.mockRestore();
    }
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

  it("pins silently by default and unpins through TDLib", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();

    await repository.pinMessage({
      chatId: "11",
      messageId: "20",
      pinned: true,
    });
    await repository.pinMessage({
      chatId: "11",
      messageId: "21",
      pinned: true,
      silent: false,
    });
    await repository.pinMessage({
      chatId: "11",
      messageId: "20",
      pinned: false,
    });

    expect(bridge.invokes).toContainEqual({
      _: "pinChatMessage",
      chat_id: 11,
      message_id: 20,
      disable_notification: true,
      only_for_self: false,
    });
    expect(bridge.invokes).toContainEqual({
      _: "pinChatMessage",
      chat_id: 11,
      message_id: 21,
      disable_notification: false,
      only_for_self: false,
    });
    expect(bridge.invokes).toContainEqual({
      _: "unpinChatMessage",
      chat_id: 11,
      message_id: 20,
    });
  });

  it("maps is_pinned onto the DTO and refreshes on updateMessageIsPinned", async () => {
    const { repository, bridge, events } = setup();
    await repository.hydrate();
    bridge.handlers.set("getMessage", () => ({
      ...tdMessage(3),
      is_pinned: true,
    }));

    bridge.emit({
      _: "updateMessageIsPinned",
      chat_id: 11,
      message_id: 3,
      is_pinned: true,
    } as Td.Update);

    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "pinned-messages",
        chatId: "11",
      });
      const upsert = events.find(
        (event) => event.type === "message-upsert" && event.message.id === "3",
      );
      expect(
        upsert && upsert.type === "message-upsert"
          ? upsert.message.pinned
          : undefined,
      ).toBe(true);
    });
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

  it("lists message reactions from getMessageAvailableReactions in Telegram's order", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    bridge.handlers.set("getMessageAvailableReactions", () => ({
      _: "availableReactions",
      top_reactions: [
        {
          _: "availableReaction",
          type: { _: "reactionTypeEmoji", emoji: "🔥" },
          needs_premium: false,
        },
      ],
      recent_reactions: [],
      popular_reactions: [
        {
          _: "availableReaction",
          type: { _: "reactionTypeEmoji", emoji: "👍" },
          needs_premium: false,
        },
        {
          _: "availableReaction",
          type: { _: "reactionTypeEmoji", emoji: "🎉" },
          needs_premium: false,
        },
      ],
      allow_custom_emoji: false,
      are_tags: false,
    }));

    expect(await repository.listAvailableReactions("11", "1")).toEqual([
      "🔥",
      "👍",
      "🎉",
    ]);
    expect(
      bridge.invokes.some(
        (request) =>
          (request as { _: string })._ === "getMessageAvailableReactions",
      ),
    ).toBe(true);
  });

  it("falls back to the account's active emoji when a chat allows every reaction", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    bridge.emit({
      _: "updateNewChat",
      chat: tdChat(12, {
        available_reactions: {
          _: "chatAvailableReactionsAll",
          max_reaction_count: 11,
        },
      }),
    } as Td.Update);
    bridge.emit({
      _: "updateActiveEmojiReactions",
      emojis: ["👍", "❤️", "🔥"],
    } as Td.Update);

    expect(await repository.listAvailableReactions("12")).toEqual([
      "👍",
      "❤",
      "🔥",
    ]);
  });

  it("sends the wire-form heart when the picker offers the emoji variant", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    await repository.setMessageReaction({
      chatId: "11",
      messageId: "1",
      emoji: "❤️",
    });
    expect(bridge.invokes).toContainEqual({
      _: "addMessageReaction",
      chat_id: 11,
      message_id: 1,
      reaction_type: { _: "reactionTypeEmoji", emoji: "❤" },
      is_big: false,
      update_recent_reactions: true,
    });
  });

  it("adds and removes a reaction through the user-account TDLib methods", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    await repository.setMessageReaction({
      chatId: "11",
      messageId: "1",
      emoji: "👍",
    });
    await repository.setMessageReaction({
      chatId: "11",
      messageId: "1",
      emoji: "👍",
      remove: true,
    });
    expect(bridge.invokes).toContainEqual({
      _: "addMessageReaction",
      chat_id: 11,
      message_id: 1,
      reaction_type: { _: "reactionTypeEmoji", emoji: "👍" },
      is_big: false,
      update_recent_reactions: true,
    });
    expect(bridge.invokes).toContainEqual({
      _: "removeMessageReaction",
      chat_id: 11,
      message_id: 1,
      reaction_type: { _: "reactionTypeEmoji", emoji: "👍" },
    });
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

  it("sends a voice-kind upload as inputMessageVoiceNote", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    bridge.handlers.set("sendMessage", () => tdMessage(31));

    const uploaded = await repository.sendMedia(
      "11",
      [
        {
          source: "/tmp/voice-message.ogg",
          name: "voice-message.ogg",
          mimeType: "audio/ogg",
          size: 512,
          kind: "voice",
          durationSeconds: 2.4,
        },
      ],
      "",
      undefined,
      "cid-voice",
      "up-voice",
    );

    expect(uploaded[0]?.clientId).toBe("cid-voice");
    expect(bridge.invokes).toContainEqual(
      expect.objectContaining({
        _: "sendMessage",
        input_message_content: {
          _: "inputMessageVoiceNote",
          voice_note: {
            _: "inputVoiceNote",
            voice_note: {
              _: "inputFileLocal",
              path: "/tmp/voice-message.ogg",
            },
            duration: 2,
            waveform: "",
          },
          caption: undefined,
        },
      }),
    );
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
            event.avatarDataUrl?.includes("avatar2_11"),
        ),
      ).toBe(true);
    });
    const page = await repository.listChatPage({ limit: 50 });
    expect(page.items[0]?.avatarDataUrl).toMatch(
      /telo-media:\/\/cache\/avatar2_11\.jpg/,
    );
    expect(page.items[0]?.avatarPending).toBe(false);
  });

  it("downloads the 640px chat photo when both small and big are present", async () => {
    const { repository, bridge } = setup();
    const source = path.join(os.tmpdir(), `telo-avatar-big-${Date.now()}.jpg`);
    writeFileSync(source, "jpeg");
    bridge.handlers.set("getChat", () =>
      tdChat(11, {
        photo: {
          _: "chatPhotoInfo",
          small: tdFile(44),
          big: tdFile(99),
        },
      }),
    );
    bridge.handlers.set("downloadFile", (request) => {
      expect(request.file_id).toBe(99);
      return {
        id: 99,
        size: 4,
        local: {
          is_downloading_completed: true,
          is_downloading_active: false,
          path: source,
          downloaded_size: 4,
        },
      };
    });
    await repository.hydrate();
    await vi.waitFor(() => {
      expect(
        bridge.invokes.some(
          (item) =>
            (item as { _: string; file_id?: number })._ === "downloadFile" &&
            (item as { file_id?: number }).file_id === 99,
        ),
      ).toBe(true);
    });
    expect(
      bridge.invokes.some(
        (item) =>
          (item as { _: string; file_id?: number })._ === "downloadFile" &&
          (item as { file_id?: number }).file_id === 44,
      ),
    ).toBe(false);
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

  it("disables sending in a channel the account cannot post to", async () => {
    const { repository, bridge, events } = setup();
    const channel = tdChat(-100, {
      type: {
        _: "chatTypeSupergroup",
        supergroup_id: 9,
        is_channel: true,
      },
      title: "News",
      permissions: {
        _: "chatPermissions",
        can_send_basic_messages: false,
      },
    });
    bridge.handlers.set("getChat", () => channel);
    bridge.handlers.set("getChats", () => ({
      _: "chats",
      chat_ids: [-100],
      total_count: 1,
    }));
    bridge.handlers.set("getSupergroup", () => ({
      _: "supergroup",
      id: 9,
      is_channel: true,
      status: { _: "chatMemberStatusMember", member_until_date: 0 },
    }));
    await repository.hydrate();
    const page = await repository.listChatPage({ limit: 50 });
    expect(page.items[0]?.canSendMessages).toBe(false);
    expect(page.items[0]?.canSendStickers).toBe(false);
    expect(page.items[0]?.canSendMedia).toBe(false);
    expect((await repository.getChat("-100"))?.canSendMessages).toBe(false);
    expect(await repository.getChat("-999")).toBeNull();

    events.length = 0;
    bridge.emit({
      _: "updateSupergroup",
      supergroup: {
        _: "supergroup",
        id: 9,
        is_channel: true,
        status: { _: "chatMemberStatusCreator", is_anonymous: false },
      },
    } as Td.Update);
    const upsert = events.find(
      (event) => event.type === "chat-upsert" && event.chat.id === "-100",
    );
    expect(upsert).toMatchObject({
      type: "chat-upsert",
      chat: { id: "-100", canSendMessages: true },
    });
  });

  it("recomputes write access when chat permissions change", async () => {
    const { repository, bridge, events } = setup();
    const group = tdChat(-5, {
      type: { _: "chatTypeBasicGroup", basic_group_id: 5 },
      title: "Design",
      permissions: {
        _: "chatPermissions",
        can_send_basic_messages: true,
      },
    });
    bridge.handlers.set("getChat", () => group);
    bridge.handlers.set("getChats", () => ({
      _: "chats",
      chat_ids: [-5],
      total_count: 1,
    }));
    bridge.handlers.set("getBasicGroup", () => ({
      _: "basicGroup",
      id: 5,
      member_count: 2,
      status: { _: "chatMemberStatusMember", member_until_date: 0 },
      is_active: true,
      upgraded_to_supergroup_id: 0,
    }));
    await repository.hydrate();
    expect(
      (await repository.listChatPage({ limit: 50 })).items[0]?.canSendMessages,
    ).toBe(true);
    events.length = 0;
    bridge.emit({
      _: "updateChatPermissions",
      chat_id: -5,
      permissions: {
        _: "chatPermissions",
        can_send_basic_messages: false,
      },
    } as Td.Update);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "chat-upsert",
        chat: expect.objectContaining({
          id: "-5",
          canSendMessages: false,
        }),
      }),
    );
  });

  it("keeps text sending when stickers and media are restricted", async () => {
    const { repository, bridge } = setup();
    const group = tdChat(-5, {
      type: { _: "chatTypeBasicGroup", basic_group_id: 5 },
      title: "Design",
      permissions: {
        _: "chatPermissions",
        can_send_basic_messages: true,
        can_send_other_messages: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_documents: false,
      },
    });
    bridge.handlers.set("getChat", () => group);
    bridge.handlers.set("getChats", () => ({
      _: "chats",
      chat_ids: [-5],
      total_count: 1,
    }));
    bridge.handlers.set("getBasicGroup", () => ({
      _: "basicGroup",
      id: 5,
      member_count: 2,
      status: { _: "chatMemberStatusMember", member_until_date: 0 },
      is_active: true,
      upgraded_to_supergroup_id: 0,
    }));
    bridge.handlers.set("sendMessage", () => tdMessage(40, -5));
    await repository.hydrate();
    const item = (await repository.listChatPage({ limit: 50 })).items[0];
    expect(item).toMatchObject({
      id: "-5",
      canSendMessages: true,
      canSendStickers: false,
      canSendMedia: false,
    });
    await expect(repository.sendMessage("-5", "hello")).resolves.toMatchObject({
      id: "40",
    });
  });

  it("votes in a poll through setPollAnswer with 0-based option ids", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();

    await repository.setMessagePollAnswer("11", "7", [1, 2]);

    expect(bridge.invokes).toContainEqual({
      _: "setPollAnswer",
      chat_id: 11,
      message_id: 7,
      option_ids: [1, 2],
    });
  });

  it("creates a poll as sendMessage with inputMessagePoll", async () => {
    const { repository, bridge } = setup();
    await repository.hydrate();
    bridge.handlers.set("sendMessage", () => ({
      ...tdMessage(50),
      content: {
        _: "messagePoll",
        poll: {
          _: "poll",
          id: "p1",
          question: { _: "formattedText", text: "Ship it?", entities: [] },
          options: [
            {
              _: "pollOption",
              id: "a",
              text: { _: "formattedText", text: "Yes", entities: [] },
              voter_count: 0,
              vote_percentage: 0,
              is_chosen: false,
              is_being_chosen: false,
              recent_voter_ids: [],
              addition_date: 0,
            },
            {
              _: "pollOption",
              id: "b",
              text: { _: "formattedText", text: "No", entities: [] },
              voter_count: 0,
              vote_percentage: 0,
              is_chosen: false,
              is_being_chosen: false,
              recent_voter_ids: [],
              addition_date: 0,
            },
          ],
          total_voter_count: 0,
          recent_voter_ids: [],
          can_get_voters: false,
          can_see_results: true,
          is_anonymous: true,
          allows_multiple_answers: false,
          allows_revoting: false,
          members_only: false,
          country_codes: [],
          option_order: [],
          type: {
            _: "pollTypeQuiz",
            correct_option_ids: [],
            explanation: { _: "formattedText", text: "", entities: [] },
          },
          open_period: 0,
          close_date: 0,
          is_closed: false,
        },
      },
    }));

    const sent = await repository.sendPoll("11", {
      question: "Ship it?",
      options: ["Yes", "No"],
      isAnonymous: true,
      kind: "quiz",
      allowMultipleAnswers: false,
      correctOptionId: 0,
    });

    const invoke = bridge.invokes.find(
      (item) => (item as { _: string })._ === "sendMessage",
    ) as { input_message_content: Record<string, unknown> };
    expect(invoke.input_message_content).toEqual({
      _: "inputMessagePoll",
      question: { _: "formattedText", text: "Ship it?", entities: [] },
      options: [
        {
          _: "inputPollOption",
          text: { _: "formattedText", text: "Yes", entities: [] },
        },
        {
          _: "inputPollOption",
          text: { _: "formattedText", text: "No", entities: [] },
        },
      ],
      is_anonymous: true,
      allows_multiple_answers: false,
      // A quiz must name its correct option; the returned poll still hides
      // it from the DTO until the account answers.
      type: { _: "inputPollTypeQuiz", correct_option_ids: [0] },
    });
    expect(sent.poll).toMatchObject({
      question: "Ship it?",
      kind: "quiz",
      correctOptionIds: null,
    });
  });

  it("routes a poll vote update through the edited-message upsert", async () => {
    const { repository, bridge, events } = setup();
    await repository.hydrate();
    bridge.handlers.set("getMessage", () => ({
      ...tdMessage(7),
      content: {
        _: "messagePoll",
        poll: {
          _: "poll",
          id: "p1",
          question: { _: "formattedText", text: "Ship it?", entities: [] },
          options: [
            {
              _: "pollOption",
              id: "a",
              text: { _: "formattedText", text: "Yes", entities: [] },
              voter_count: 1,
              vote_percentage: 100,
              is_chosen: true,
              is_being_chosen: false,
              recent_voter_ids: [],
              addition_date: 0,
            },
          ],
          total_voter_count: 1,
          recent_voter_ids: [],
          can_get_voters: false,
          can_see_results: true,
          is_anonymous: false,
          allows_multiple_answers: false,
          allows_revoting: false,
          members_only: false,
          country_codes: [],
          option_order: [],
          type: { _: "pollTypeRegular" },
          open_period: 0,
          close_date: 0,
          is_closed: false,
        },
      },
    }));
    events.length = 0;

    // TDLib pushes updateMessageContent when a poll's tally moves.
    bridge.emit({
      _: "updateMessageContent",
      chat_id: 11,
      message_id: 7,
      old_content: { _: "messagePoll" },
      new_content: { _: "messagePoll" },
    } as unknown as Td.Update);

    await vi.waitFor(() => {
      const edited = events.find(
        (event) => event.type === "message-upsert" && event.cause === "edited",
      );
      expect(edited).toMatchObject({
        message: {
          id: "7",
          poll: {
            question: "Ship it?",
            options: [{ text: "Yes", voterCount: 1, chosen: true }],
          },
        },
      });
    });
  });
});
