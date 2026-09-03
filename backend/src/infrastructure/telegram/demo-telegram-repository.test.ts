import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TelegramUploadFile } from "../../domain/telegram/telegram-ports";
import { ARCHIVE_FOLDER_ID } from "../../../../contracts/src/ipc";
import {
  DEMO_SEND_FAIL_ONCE_MARKER,
  DemoTelegramRepository,
} from "./demo-telegram-repository";

const photoUpload: TelegramUploadFile = {
  source: "/tmp/photo.jpg",
  name: "photo.jpg",
  mimeType: "image/jpeg",
  size: 1234,
};

const videoUpload: TelegramUploadFile = {
  source: "/tmp/clip.mp4",
  name: "clip.mp4",
  mimeType: "video/mp4",
  size: 98765,
};

const documentUpload: TelegramUploadFile = {
  source: "/tmp/notes.pdf",
  name: "notes.pdf",
  mimeType: "application/pdf",
  size: 4321,
};

interface MediaUploadEvent {
  readonly type: "media-upload";
  readonly uploadId: string;
  readonly state: string;
  readonly progress: number;
  readonly error: string | null;
}

function uploadEvents(events: ReadonlyArray<unknown>): MediaUploadEvent[] {
  return events.filter(
    (event): event is MediaUploadEvent =>
      (event as { type: string }).type === "media-upload",
  );
}

async function listChats(repository: DemoTelegramRepository) {
  return (await repository.listChatPage({ limit: 100 })).items;
}

async function listMessages(
  repository: DemoTelegramRepository,
  chatId: string,
) {
  return (await repository.listMessagePage(chatId, { limit: 100 })).items;
}

describe("DemoTelegramRepository", () => {
  it("publishes message and chat changes to subscribers", async () => {
    const repository = new DemoTelegramRepository();
    const events: unknown[] = [];
    const unsubscribe = repository.subscribe((event) => events.push(event));

    const sent = await repository.sendMessage("design", "Live update");
    unsubscribe();
    await repository.sendMessage("design", "After unsubscribe");

    expect(events).toEqual([
      expect.objectContaining({ type: "chat-upsert" }),
      { type: "message-upsert", cause: "new", message: sent },
    ]);
  });
  it("returns the demo account identity", async () => {
    await expect(
      new DemoTelegramRepository().getCurrentUser(),
    ).resolves.toMatchObject({
      displayName: "Demo User",
      initials: "DU",
      avatarDataUrl: null,
    });
  });

  it("returns deterministic demo chats", async () => {
    const chats = await listChats(new DemoTelegramRepository());
    expect(chats).toHaveLength(5);
    expect(chats[0]?.pinned).toBe(true);
  });

  it("lists a Work folder and the Archive with per-folder unread counts", async () => {
    const repository = new DemoTelegramRepository();
    const folders = await repository.listFolders();

    expect(folders).toEqual([
      { id: 2, title: "Work", unreadCount: 3 },
      { id: ARCHIVE_FOLDER_ID, title: "Archive", unreadCount: 2 },
    ]);
    const chats = await listChats(repository);
    expect(chats.map((chat) => chat.folderId)).toEqual([
      null,
      2,
      2,
      ARCHIVE_FOLDER_ID,
      null,
    ]);
  });

  it("emits a folder snapshot when a read state change moves folder badges", async () => {
    const repository = new DemoTelegramRepository();
    const events: unknown[] = [];
    repository.subscribe((event) => events.push(event));

    await repository.setChatRead("design", true);

    expect(events).toContainEqual({
      type: "folders",
      folders: [
        { id: 2, title: "Work", unreadCount: 0 },
        { id: ARCHIVE_FOLDER_ID, title: "Archive", unreadCount: 2 },
      ],
    });
  });

  it("exposes a deterministic read boundary for the chat with unread messages", async () => {
    const repository = new DemoTelegramRepository();
    const chats = await listChats(repository);
    const design = chats.find((chat) => chat.id === "design");

    expect(design?.unreadCount).toBe(3);
    expect(design?.lastReadMessageId).toBe("design-3");
    const messages = await listMessages(repository, "design");
    // Three incoming messages sit past the read boundary, matching the count.
    expect(messages.slice(-3).every((message) => !message.outgoing)).toBe(true);
  });

  it("rejects the first send of a fail-once body, then delivers the retry", async () => {
    const repository = new DemoTelegramRepository();
    const body = `Flaky connection send ${DEMO_SEND_FAIL_ONCE_MARKER}`;

    await expect(repository.sendMessage("design", body)).rejects.toThrow(
      "Demo transient send failure",
    );
    const sent = await repository.sendMessage("design", body);

    expect(sent).toMatchObject({ body, outgoing: true, status: "sent" });
  });

  it("paginates chats with an exclusive cursor", async () => {
    const repository = new DemoTelegramRepository();
    const first = await repository.listChatPage({ limit: 1 });
    const second = await repository.listChatPage({
      limit: 1,
      cursor: first.nextCursor,
    });
    const third = await repository.listChatPage({
      limit: 1,
      cursor: second.nextCursor,
    });
    const fourth = await repository.listChatPage({
      limit: 1,
      cursor: third.nextCursor,
    });
    const fifth = await repository.listChatPage({
      limit: 1,
      cursor: fourth.nextCursor,
    });

    expect(first.items.map((chat) => chat.id)).toEqual(["saved"]);
    expect(second.items.map((chat) => chat.id)).toEqual(["design"]);
    expect(third.items.map((chat) => chat.id)).toEqual(["product"]);
    expect(fourth.items.map((chat) => chat.id)).toEqual(["offsite"]);
    expect(fifth.items.map((chat) => chat.id)).toEqual(["telobot"]);
    expect(fifth.nextCursor).toBeNull();
  });

  it("returns a snapshot that does not leak internal chat state", async () => {
    const repository = new DemoTelegramRepository();
    const chats = await listChats(repository);
    await repository.setChatPinned("saved", false);
    expect(chats[0]?.pinned).toBe(true);
  });

  it("adds a sent message to the selected conversation", async () => {
    const repository = new DemoTelegramRepository();
    const sent = await repository.sendMessage("design", "Hello");
    const messages = await listMessages(repository, "design");
    expect(sent).toMatchObject({
      body: "Hello",
      outgoing: true,
      status: "sent",
    });
    expect(messages.at(-1)).toEqual(sent);
  });

  it("paginates messages backward without duplicating the boundary", async () => {
    const repository = new DemoTelegramRepository();
    const first = await repository.listMessagePage("design", { limit: 1 });
    const second = await repository.listMessagePage("design", {
      limit: 1,
      beforeMessageId: first.nextCursor,
    });
    const third = await repository.listMessagePage("design", {
      limit: 1,
      beforeMessageId: second.nextCursor,
    });

    expect(first.items.map((message) => message.id)).toEqual(["design-6"]);
    expect(second.items.map((message) => message.id)).toEqual(["design-5"]);
    expect(third.items.map((message) => message.id)).toEqual(["design-4"]);
    expect(third.nextCursor).toBe("design-4");
  });

  it("pins and unpins a chat persistently", async () => {
    const repository = new DemoTelegramRepository();
    await repository.setChatPinned("product", true);
    let chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "product")?.pinned).toBe(true);

    await repository.setChatPinned("product", false);
    chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "product")?.pinned).toBe(false);
  });

  it("mutes and unmutes a chat persistently", async () => {
    const repository = new DemoTelegramRepository();
    await repository.setChatMuted("design", true);
    let chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "design")?.muted).toBe(true);

    await repository.setChatMuted("design", false);
    chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "design")?.muted).toBe(false);
  });

  it("clears the unread counter when a chat is marked read", async () => {
    const repository = new DemoTelegramRepository();
    await repository.setChatRead("design", true);
    const chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "design")?.unreadCount).toBe(0);
  });

  it("flags a chat with one unread when it is marked unread", async () => {
    const repository = new DemoTelegramRepository();
    await repository.setChatRead("saved", false);
    const chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "saved")?.unreadCount).toBe(1);
  });

  it("archives and restores a chat, and the Archive folder follows its members", async () => {
    const repository = new DemoTelegramRepository();
    // "offsite" starts archived, so the Archive folder is already listed.
    expect(
      (await repository.listFolders()).some(
        (folder) => folder.id === ARCHIVE_FOLDER_ID,
      ),
    ).toBe(true);

    await repository.setChatArchived("telobot", true);
    let chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "telobot")?.folderId).toBe(
      ARCHIVE_FOLDER_ID,
    );
    // The Archive badge sums its members: offsite (2) + telobot (0).
    expect(
      (await repository.listFolders()).find(
        (folder) => folder.id === ARCHIVE_FOLDER_ID,
      )?.unreadCount,
    ).toBe(2);

    await repository.setChatArchived("offsite", false);
    await repository.setChatArchived("telobot", false);
    chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "offsite")?.folderId).toBeNull();
    expect(chats.find((chat) => chat.id === "telobot")?.folderId).toBeNull();
    // With no members left, the Archive folder disappears from the list.
    expect(
      (await repository.listFolders()).some(
        (folder) => folder.id === ARCHIVE_FOLDER_ID,
      ),
    ).toBe(false);
  });

  it.each([
    "setChatPinned",
    "setChatMuted",
    "setChatRead",
    "setChatArchived",
  ] as const)("rejects %s for an unknown chat", async (method) => {
    const repository = new DemoTelegramRepository();
    await expect(repository[method]("missing", true)).rejects.toThrow(
      "Unknown chat missing",
    );
  });

  it("attaches a reply snapshot when sending with a reply target", async () => {
    const repository = new DemoTelegramRepository();
    const sent = await repository.sendMessage("design", "On it", "design-1");
    expect(sent.replyTo).toEqual({
      id: "design-1",
      senderName: "Mina",
      body: "The conversation list should stay compact at desktop widths.",
      entities: [{ type: "bold", offset: 34, length: 7 }],
    });
    const messages = await listMessages(repository, "design");
    expect(messages.at(-1)?.replyTo).toEqual(sent.replyTo);
  });

  it("rejects a reply target that does not exist", async () => {
    const repository = new DemoTelegramRepository();
    await expect(
      repository.sendMessage("design", "On it", "missing"),
    ).rejects.toThrow("Unknown message missing");
  });

  it("edits an outgoing message and stamps editedAt", async () => {
    const repository = new DemoTelegramRepository();
    await repository.editMessage({
      chatId: "design",
      messageId: "design-2",
      body: "Agreed. Composer stays anchored.",
    });
    const messages = await listMessages(repository, "design");
    const edited = messages.find((message) => message.id === "design-2");
    expect(edited?.body).toBe("Agreed. Composer stays anchored.");
    expect(edited?.editedAt).toEqual(expect.any(String));
    // Other messages stay untouched.
    expect(
      messages.find((message) => message.id === "design-1")?.editedAt,
    ).toBeUndefined();
  });

  it("rejects editing a message that is not outgoing", async () => {
    const repository = new DemoTelegramRepository();
    await expect(
      repository.editMessage({
        chatId: "design",
        messageId: "design-1",
        body: "hijack",
      }),
    ).rejects.toThrow("Message design-1 is not outgoing");
    const messages = await listMessages(repository, "design");
    expect(messages.find((message) => message.id === "design-1")?.body).toBe(
      "The conversation list should stay compact at desktop widths.",
    );
  });

  it.each([
    [
      { chatId: "missing", messageId: "design-2", body: "x" },
      "Unknown chat missing",
    ],
    [
      { chatId: "design", messageId: "missing", body: "x" },
      "Unknown message missing",
    ],
  ])("rejects editMessage for unknown targets %j", async (input, error) => {
    const repository = new DemoTelegramRepository();
    await expect(repository.editMessage(input)).rejects.toThrow(error);
  });

  it("deletes a message from its conversation", async () => {
    const repository = new DemoTelegramRepository();
    await repository.deleteMessage({ chatId: "design", messageId: "design-1" });
    const messages = await listMessages(repository, "design");
    expect(messages.map((message) => message.id)).toEqual([
      "design-2",
      "design-3",
      "design-media-1",
      "design-media-2",
      "design-media-3",
      "design-media-4",
      "design-media-5",
      "design-4",
      "design-5",
      "design-6",
    ]);
  });

  it.each([
    [{ chatId: "missing", messageId: "design-1" }, "Unknown chat missing"],
    [{ chatId: "design", messageId: "missing" }, "Unknown message missing"],
  ])("rejects deleteMessage for unknown targets %j", async (input, error) => {
    const repository = new DemoTelegramRepository();
    await expect(repository.deleteMessage(input)).rejects.toThrow(error);
  });

  it("hides a message deleted for me without revoking it for everyone", async () => {
    const repository = new DemoTelegramRepository();
    await repository.deleteMessage({
      chatId: "design",
      messageId: "design-1",
      scope: "me",
    });

    // This client stops seeing the message in history and in both searches…
    const messages = await listMessages(repository, "design");
    expect(messages.some((message) => message.id === "design-1")).toBe(false);
    expect(
      (await repository.searchGlobal("compact")).messages.some(
        (message) => message.id === "design-1",
      ),
    ).toBe(false);
    expect(
      (await repository.searchMessages("design", "compact", {})).messageIds,
    ).not.toContain("design-1");

    // …but it was hidden, not revoked: a later delete-for-everyone still
    // finds it, and only then is it gone for good.
    await repository.deleteMessage({
      chatId: "design",
      messageId: "design-1",
      scope: "everyone",
    });
    await expect(
      repository.deleteMessage({ chatId: "design", messageId: "design-1" }),
    ).rejects.toThrow("Unknown message design-1");
  });

  it("forwards a message as a new outgoing message without a reply snapshot", async () => {
    const repository = new DemoTelegramRepository();
    await repository.forwardMessage({
      fromChatId: "design",
      messageId: "design-1",
      toChatId: "saved",
    });

    const target = await listMessages(repository, "saved");
    const forwarded = target.at(-1);
    expect(forwarded).toMatchObject({
      chatId: "saved",
      senderName: "You",
      body: "The conversation list should stay compact at desktop widths.",
      outgoing: true,
      status: "sent",
      replyTo: null,
    });
    expect(forwarded?.id).not.toBe("design-1");
    // The source conversation is untouched.
    const source = await listMessages(repository, "design");
    expect(source).toHaveLength(11);
  });

  it("attributes the forwarded copy to the original sender by default", async () => {
    const repository = new DemoTelegramRepository();
    await repository.forwardMessage({
      fromChatId: "design",
      messageId: "design-1",
      toChatId: "saved",
    });

    const target = await listMessages(repository, "saved");
    // Forwarding into Saved Messages is the wire header's savedFromPeer
    // case: the copy names the original author and points back at the
    // message it was made from.
    expect(target.at(-1)?.forwardedFrom).toEqual({
      senderName: "Mina",
      senderId: "design",
      messageId: "design-1",
      postAuthor: null,
    });
  });

  it("strips the sender attribution when forwarding with hideSender", async () => {
    const repository = new DemoTelegramRepository();
    await repository.forwardMessage({
      fromChatId: "design",
      messageId: "design-1",
      toChatId: "saved",
      hideSender: true,
    });

    const target = await listMessages(repository, "saved");
    const forwarded = target.at(-1);
    expect(forwarded?.forwardedFrom).toBeNull();
    expect(forwarded?.body).toBe(
      "The conversation list should stay compact at desktop widths.",
    );
  });

  it("keeps the original author when chaining a forward", async () => {
    const repository = new DemoTelegramRepository();
    await repository.forwardMessage({
      fromChatId: "design",
      messageId: "design-1",
      toChatId: "saved",
    });
    const saved = await listMessages(repository, "saved");
    const copy = saved.at(-1);
    await repository.forwardMessage({
      fromChatId: "saved",
      messageId: copy?.id ?? "",
      toChatId: "product",
    });

    const product = await listMessages(repository, "product");
    // The header travels with the copy, target included.
    expect(product.at(-1)?.forwardedFrom).toEqual({
      senderName: "Mina",
      senderId: "design",
      messageId: "design-1",
      postAuthor: null,
    });
  });

  it("refreshes the target chat preview without touching unread count", async () => {
    const repository = new DemoTelegramRepository();
    await repository.forwardMessage({
      fromChatId: "saved",
      messageId: "saved-1",
      toChatId: "design",
    });
    const chats = await listChats(repository);
    const design = chats.find((chat) => chat.id === "design");
    expect(design?.preview).toBe(
      "Release checklist: tests, docs, signed packages.",
    );
    expect(design?.unreadCount).toBe(3);
  });

  it.each([
    [
      { fromChatId: "missing", messageId: "design-1", toChatId: "saved" },
      "Unknown chat missing",
    ],
    [
      { fromChatId: "design", messageId: "missing", toChatId: "saved" },
      "Unknown message missing",
    ],
    [
      { fromChatId: "design", messageId: "design-1", toChatId: "missing" },
      "Unknown chat missing",
    ],
  ])("rejects forwardMessage for unknown targets %j", async (input, error) => {
    const repository = new DemoTelegramRepository();
    await expect(repository.forwardMessage(input)).rejects.toThrow(error);
  });

  it("lists shared media as the photo/video/file slice of the history", async () => {
    const repository = new DemoTelegramRepository();

    const page = await repository.listSharedMedia("design", {});

    // The design fixtures carry five media messages (four photos, one video)
    // plus one link preview, which stays out of the shared media slice.
    expect(page.items.map((message) => message.id)).toEqual([
      "design-media-1",
      "design-media-2",
      "design-media-3",
      "design-media-4",
      "design-media-5",
    ]);
    expect(
      page.items.every(
        (message) => message.media !== null && message.media.kind !== "webpage",
      ),
    ).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it("pages shared media with the transcript's exclusive cursor", async () => {
    const repository = new DemoTelegramRepository();

    const first = await repository.listSharedMedia("design", { limit: 2 });
    expect(first.items.map((message) => message.id)).toEqual([
      "design-media-4",
      "design-media-5",
    ]);
    expect(first.nextCursor).toBe("design-media-4");

    const older = await repository.listSharedMedia("design", {
      limit: 2,
      beforeMessageId: first.nextCursor,
    });
    expect(older.items.map((message) => message.id)).toEqual([
      "design-media-2",
      "design-media-3",
    ]);
    expect(older.nextCursor).toBe("design-media-2");
  });

  it("rejects shared media for an unknown chat", async () => {
    const repository = new DemoTelegramRepository();
    await expect(repository.listSharedMedia("missing", {})).rejects.toThrow(
      "Unknown chat missing",
    );
  });

  it("lists pinned messages most recently pinned first", async () => {
    const repository = new DemoTelegramRepository();

    const pinned = await repository.listPinnedMessages("design");

    expect(pinned.map((message) => message.id)).toEqual([
      "design-6",
      "design-1",
    ]);
  });

  it("lists no pinned messages for a chat without pins and rejects an unknown chat", async () => {
    const repository = new DemoTelegramRepository();

    await expect(repository.listPinnedMessages("saved")).resolves.toEqual([]);
    await expect(repository.listPinnedMessages("missing")).rejects.toThrow(
      "Unknown chat missing",
    );
  });

  it("lists deterministic group members for mention autocomplete", async () => {
    const repository = new DemoTelegramRepository();

    await expect(repository.listChatMembers("design")).resolves.toEqual([
      { id: "demo-mina", displayName: "Mina", username: "mina" },
      { id: "demo-aron", displayName: "Aron", username: "aron" },
      { id: "demo-lev", displayName: "Lev", username: "lev" },
    ]);
    await expect(repository.listChatMembers("saved")).resolves.toEqual([]);
    await expect(repository.listChatMembers("missing")).rejects.toThrow(
      "Unknown chat missing",
    );
  });

  it("resolves a group member peer to an identity card with a bio", async () => {
    const repository = new DemoTelegramRepository();

    await expect(repository.getPeerProfile("demo-mina")).resolves.toEqual({
      id: "demo-mina",
      title: "Mina",
      username: "mina",
      kind: "direct",
      avatarDataUrl: null,
      bio: "Design systems, spacing rules, and long changelogs.",
      phone: "+1 555 0142",
    });
    // Only one demo peer shares a number, so the card's phone row has both a
    // present and an absent case to render.
    await expect(repository.getPeerProfile("demo-lev")).resolves.toMatchObject({
      title: "Lev",
      phone: null,
    });
  });

  it("resolves a peer that has a dialog to that chat's identity", async () => {
    const repository = new DemoTelegramRepository();

    await expect(repository.getPeerProfile("product")).resolves.toEqual({
      id: "product",
      title: "Product Notes",
      username: null,
      kind: "channel",
      avatarDataUrl: null,
      bio: null,
      phone: null,
    });
  });

  it("rejects a peer profile lookup for an unknown peer", async () => {
    const repository = new DemoTelegramRepository();

    await expect(repository.getPeerProfile("missing")).rejects.toThrow(
      "Unknown peer missing",
    );
  });

  it("stores composer-authored entities on a sent message", async () => {
    const repository = new DemoTelegramRepository();
    const entities = [{ type: "bold" as const, offset: 0, length: 5 }];
    const sent = await repository.sendMessage(
      "design",
      "Hello",
      undefined,
      undefined,
      undefined,
      entities,
    );
    expect(sent.entities).toEqual(entities);
  });

  it("echoes the clientId back on the sent message for optimistic reconciliation", async () => {
    const repository = new DemoTelegramRepository();
    const sent = await repository.sendMessage(
      "design",
      "Hello",
      undefined,
      "client-1",
    );
    expect(sent.clientId).toBe("client-1");
  });

  it("saveDraft persists the draft and emits a draft event without a chat-upsert", async () => {
    const repository = new DemoTelegramRepository();
    const events: unknown[] = [];
    repository.subscribe((event) => events.push(event));

    await repository.saveDraft("design", "Unsent reply");

    const chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "design")?.draftPreview).toBe(
      "Unsent reply",
    );
    expect(events).toEqual([
      { type: "draft", chatId: "design", draftPreview: "Unsent reply" },
    ]);
  });

  it("saveDraft clears the draft when given an empty or blank string", async () => {
    const repository = new DemoTelegramRepository();
    await repository.saveDraft("design", "Something");

    await repository.saveDraft("design", "   ");

    const chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "design")?.draftPreview).toBeNull();
  });

  it("saveDraft rejects for an unknown chat", async () => {
    const repository = new DemoTelegramRepository();
    await expect(repository.saveDraft("missing", "text")).rejects.toThrow(
      "Unknown chat missing",
    );
  });

  it("sendMessage clears the chat's draft", async () => {
    const repository = new DemoTelegramRepository();
    await repository.saveDraft("design", "Draft text");

    await repository.sendMessage("design", "Sent instead");

    const chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "design")?.draftPreview).toBeNull();
  });

  it("setTyping resolves for a known chat and rejects for an unknown one", async () => {
    const repository = new DemoTelegramRepository();
    await expect(repository.setTyping("design", true)).resolves.toBeUndefined();
    await expect(repository.setTyping("missing", true)).rejects.toThrow(
      "Unknown chat missing",
    );
  });

  it("reports presence only for the online direct chat", async () => {
    const chats = await listChats(new DemoTelegramRepository());
    expect(chats.find((chat) => chat.id === "offsite")).toMatchObject({
      kind: "direct",
      presence: "online",
    });
    expect(
      chats.find((chat) => chat.id === "design")?.presence,
    ).toBeUndefined();
  });

  it("searches chats and messages globally over the fixtures", async () => {
    const repository = new DemoTelegramRepository();

    const byTitle = await repository.searchGlobal("product");
    expect(byTitle.chats.map((chat) => chat.id)).toEqual(["product"]);
    expect(byTitle.messages).toEqual([]);

    const byBody = await repository.searchGlobal("retry flow");
    expect(byBody.chats).toEqual([]);
    expect(byBody.messages.map((message) => message.id)).toEqual(["design-4"]);

    const empty = await repository.searchGlobal("no-such-chat");
    expect(empty).toEqual({ chats: [], messages: [] });
  });

  it("returns in-chat matches newest first with a total and cursor paging", async () => {
    const repository = new DemoTelegramRepository();

    // Seven design messages contain "the"; newest first, two per page.
    const first = await repository.searchMessages("design", "the", {
      limit: 2,
    });
    expect(first).toEqual({
      messageIds: ["design-6", "design-5"],
      totalCount: 7,
      nextCursor: "design-5",
    });

    const second = await repository.searchMessages("design", "the", {
      limit: 2,
      beforeMessageId: first.nextCursor,
    });
    expect(second).toEqual({
      messageIds: ["design-4", "design-media-3"],
      totalCount: 7,
      nextCursor: "design-media-3",
    });

    const last = await repository.searchMessages("design", "the", {
      limit: 2,
      beforeMessageId: "design-1",
    });
    expect(last).toEqual({ messageIds: [], totalCount: 7, nextCursor: null });

    await expect(
      repository.searchMessages("missing", "the", {}),
    ).rejects.toThrow("Unknown chat missing");
    await expect(
      repository.searchMessages("design", "the", {
        beforeMessageId: "missing",
      }),
    ).rejects.toThrow("Unknown message cursor");
  });

  it("simulates the recipient typing and then replying after a send", async () => {
    const repository = new DemoTelegramRepository({
      typingDelayMs: 5,
      autoReplyDelayMs: 15,
    });
    const events: unknown[] = [];
    repository.subscribe((event) => events.push(event));

    await repository.sendMessage("design", "Ship it?");
    await new Promise((resolve) => setTimeout(resolve, 30));

    const typingEvents = events.filter(
      (event): event is { type: "typing"; chatId: string; typing: boolean } =>
        (event as { type: string }).type === "typing",
    );
    expect(typingEvents).toEqual([
      { type: "typing", chatId: "design", typing: true },
      { type: "typing", chatId: "design", typing: false },
    ]);
    const messages = await listMessages(repository, "design");
    const reply = messages.at(-1);
    expect(reply?.outgoing).toBe(false);
    expect(reply?.body).toBe("Looks good — shipping it.");
  });

  it("does not schedule an auto-reply for a chat without a demo counterpart", async () => {
    const repository = new DemoTelegramRepository({
      typingDelayMs: 5,
      autoReplyDelayMs: 5,
    });
    const events: unknown[] = [];
    repository.subscribe((event) => events.push(event));

    await repository.sendMessage("saved", "Note to self");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      events.some((event) => (event as { type: string }).type === "typing"),
    ).toBe(false);
  });

  it("stays quiet after a silent send: no typing indicator, no auto-reply", async () => {
    const repository = new DemoTelegramRepository({
      typingDelayMs: 5,
      autoReplyDelayMs: 10,
    });
    const events: unknown[] = [];
    repository.subscribe((event) => events.push(event));

    const sent = await repository.sendMessage(
      "design",
      "Ship it quietly",
      undefined,
      undefined,
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(sent.outgoing).toBe(true);
    expect(
      events.some((event) => (event as { type: string }).type === "typing"),
    ).toBe(false);
    const messages = await listMessages(repository, "design");
    expect(messages.at(-1)?.id).toBe(sent.id);
  });

  it("logout() is a no-op that keeps the demo workspace intact", async () => {
    const repository = new DemoTelegramRepository();

    await repository.logout();

    await expect(listChats(repository)).resolves.toHaveLength(5);
    await expect(repository.getCurrentUser()).resolves.toMatchObject({
      id: "demo-user",
    });
  });

  it("reports progress and delivers an album with a shared groupedId", async () => {
    const repository = new DemoTelegramRepository({ uploadStepMs: 1 });
    const events: unknown[] = [];
    repository.subscribe((event) => events.push(event));

    const sent = await repository.sendMedia(
      "design",
      [photoUpload, videoUpload],
      "release assets",
      undefined,
      "client-9",
      "upload-1",
    );

    expect(sent).toHaveLength(2);
    expect(sent[0]?.groupedId).toBeTruthy();
    expect(sent[0]?.groupedId).toBe(sent[1]?.groupedId);
    expect(sent[0]?.body).toBe("release assets");
    expect(sent[1]?.body).toBe("");
    expect(sent[0]?.clientId).toBe("client-9");
    expect(sent[1]?.clientId).toBeNull();
    expect(sent[0]?.media).toMatchObject({
      kind: "photo",
      fileName: "photo.jpg",
    });
    expect(sent[1]?.media).toMatchObject({
      kind: "video",
      fileName: "clip.mp4",
    });
    const uploads = uploadEvents(events);
    expect(uploads.map((event) => event.state)).toEqual([
      "uploading",
      "uploading",
      "uploading",
      "uploading",
      "ready",
    ]);
    expect(uploads.map((event) => event.progress)).toEqual([
      0, 0.25, 0.5, 0.75, 1,
    ]);
    const messages = await listMessages(repository, "design");
    expect(messages.slice(-2).map((message) => message.id)).toEqual(
      sent.map((message) => message.id),
    );
    const chats = await listChats(repository);
    expect(chats.find((chat) => chat.id === "design")?.preview).toBe(
      "release assets",
    );
  });

  it("sends a single file without a groupedId and maps non-media kinds to file", async () => {
    const repository = new DemoTelegramRepository({ uploadStepMs: 1 });

    const sent = await repository.sendMedia(
      "design",
      [documentUpload],
      "",
      undefined,
      undefined,
      "upload-2",
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.groupedId).toBeNull();
    expect(sent[0]?.media).toMatchObject({
      kind: "file",
      fileName: "notes.pdf",
      mimeType: "application/pdf",
    });
    const chats = await listChats(repository);
    // Without a caption the preview falls back to the file name.
    expect(chats.find((chat) => chat.id === "design")?.preview).toBe(
      "notes.pdf",
    );
  });

  it("cancels an in-flight upload without delivering messages", async () => {
    // The step has to outlast scheduler jitter under a parallel suite run:
    // if all four steps elapse before the cancel lands, the upload delivers.
    const repository = new DemoTelegramRepository({ uploadStepMs: 120 });
    const events: unknown[] = [];
    repository.subscribe((event) => events.push(event));

    const pending = repository.sendMedia(
      "design",
      [photoUpload],
      "",
      undefined,
      undefined,
      "upload-3",
    );
    const assertion = expect(pending).rejects.toThrow(
      "Media upload was cancelled",
    );
    await vi.waitFor(() => {
      expect(uploadEvents(events)).toContainEqual({
        type: "media-upload",
        uploadId: "upload-3",
        state: "uploading",
        progress: 0.25,
        error: null,
      });
    });

    await repository.cancelMediaUpload("upload-3");
    await assertion;

    expect(events.at(-1)).toEqual({
      type: "media-upload",
      uploadId: "upload-3",
      state: "cancelled",
      progress: 0,
      error: null,
    });
    const messages = await listMessages(repository, "design");
    expect(messages.map((message) => message.id)).toEqual([
      "design-1",
      "design-2",
      "design-3",
      "design-media-1",
      "design-media-2",
      "design-media-3",
      "design-media-4",
      "design-media-5",
      "design-4",
      "design-5",
      "design-6",
    ]);
    // Cancelling an unknown or finished upload is a no-op.
    await expect(
      repository.cancelMediaUpload("missing"),
    ).resolves.toBeUndefined();
  });

  it("rejects a second send while an upload id is still active", async () => {
    const repository = new DemoTelegramRepository({ uploadStepMs: 20 });

    const first = repository.sendMedia(
      "design",
      [photoUpload],
      "",
      undefined,
      undefined,
      "upload-4",
    );
    await expect(
      repository.sendMedia(
        "design",
        [photoUpload],
        "",
        undefined,
        undefined,
        "upload-4",
      ),
    ).rejects.toThrow("Upload is already active");

    await expect(first).resolves.toHaveLength(1);
    // The id is free again once the upload settles.
    await expect(
      repository.sendMedia(
        "design",
        [photoUpload],
        "",
        undefined,
        undefined,
        "upload-4",
      ),
    ).resolves.toHaveLength(1);
  });

  it("rejects media sends to an unknown chat", async () => {
    const repository = new DemoTelegramRepository();
    await expect(
      repository.sendMedia(
        "missing",
        [photoUpload],
        "",
        undefined,
        undefined,
        "upload-5",
      ),
    ).rejects.toThrow("Unknown chat missing");
  });

  it("lists one installed sticker set covering every sticker encoding", async () => {
    const repository = new DemoTelegramRepository();

    const sets = await repository.listStickerSets();

    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      shortName: "TeloPack",
      title: "Telo Pack",
      installed: true,
    });
    // The demo serves a stand-in silhouette so the placeholder path renders
    // in the demo workspace exactly as it does behind a real document.
    const outlinePath = "M64,64L448,64L448,448L64,448z";
    expect(sets[0].stickers).toEqual([
      {
        id: "sticker/1",
        emoji: "👋",
        format: "static",
        width: 512,
        height: 512,
        outlinePath,
      },
      {
        id: "sticker/2",
        emoji: "🎉",
        format: "animated",
        width: 512,
        height: 512,
        outlinePath,
      },
      {
        id: "sticker/3",
        emoji: "🔥",
        format: "video",
        width: 512,
        height: 512,
        outlinePath,
      },
    ]);
  });

  it("appends an outgoing sticker message carrying the set entry's media", async () => {
    const repository = new DemoTelegramRepository();
    const events: unknown[] = [];
    repository.subscribe((event) => events.push(event));

    const sent = await repository.sendSticker("design", "sticker/2");

    expect(sent).toMatchObject({
      chatId: "design",
      body: "",
      outgoing: true,
      status: "sent",
      media: {
        id: "sticker/2",
        kind: "sticker",
        mimeType: "application/x-tgsticker",
        sticker: { emoji: "🎉", format: "animated", setName: "TeloPack" },
      },
    });
    expect((await listMessages(repository, "design")).at(-1)).toEqual(sent);
    expect(events).toContainEqual({
      type: "message-upsert",
      cause: "new",
      message: sent,
    });
    // A sticker has no body, so the dialog preview falls back to its emoji.
    const chat = (await listChats(repository)).find(
      (entry) => entry.id === "design",
    );
    expect(chat?.preview).toBe("🎉");
  });

  it("rejects a sticker send to an unknown chat or for an unknown sticker", async () => {
    const repository = new DemoTelegramRepository();

    await expect(
      repository.sendSticker("missing", "sticker/1"),
    ).rejects.toThrow("Unknown chat missing");
    await expect(
      repository.sendSticker("design", "sticker/404"),
    ).rejects.toThrow("Unknown sticker sticker/404");
  });

  it("reads the set a received sticker opens by short name", async () => {
    const repository = new DemoTelegramRepository();

    const set = await repository.getStickerSet("TeloPack");

    expect(set).toMatchObject({
      id: "demo-telopack",
      shortName: "TeloPack",
      title: "Telo Pack",
      installed: true,
    });
    expect(set.stickers.map((sticker) => sticker.id)).toEqual([
      "sticker/1",
      "sticker/2",
      "sticker/3",
    ]);
  });

  it("rejects reading or installing an unknown sticker set", async () => {
    const repository = new DemoTelegramRepository();

    await expect(repository.getStickerSet("NoPack")).rejects.toThrow(
      "Unknown sticker set NoPack",
    );
    await expect(
      repository.setStickerSetInstalled("NoPack", true),
    ).rejects.toThrow("Unknown sticker set NoPack");
  });

  // The set sheet's add/remove button reads the state back, so the install
  // flag has to survive the call the way an account-level install does.
  it("keeps the set's installed state across calls, and out of the picker while removed", async () => {
    const repository = new DemoTelegramRepository();

    await repository.setStickerSetInstalled("TeloPack", false);

    expect(await repository.getStickerSet("TeloPack")).toMatchObject({
      shortName: "TeloPack",
      installed: false,
    });
    // The picker lists installed sets only.
    expect(await repository.listStickerSets()).toEqual([]);

    await repository.setStickerSetInstalled("TeloPack", true);

    expect(await repository.getStickerSet("TeloPack")).toMatchObject({
      installed: true,
    });
    const sets = await repository.listStickerSets();
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ shortName: "TeloPack", installed: true });
  });
});

describe("DemoTelegramRepository bot keyboards", () => {
  it("attaches an inline keyboard covering every button kind to the bot's newest message", async () => {
    const repository = new DemoTelegramRepository();

    const messages = await listMessages(repository, "telobot");

    expect(messages.at(-1)).toMatchObject({
      id: "telobot-2",
      keyboard: {
        rows: [
          [
            { id: "0:0", text: "Approve deploy", kind: "callback" },
            { id: "0:1", text: "Watch builds", kind: "callback" },
          ],
          [
            {
              id: "1:0",
              text: "Open logs",
              kind: "url",
              url: "https://example.com/telo-bot/build/482",
            },
            {
              id: "1:1",
              text: "Copy build id",
              kind: "copy",
              copyText: "build-482",
            },
            { id: "1:2", text: "Play", kind: "unsupported" },
          ],
        ],
      },
    });
  });

  it("answers each callback button with its own deterministic answer", async () => {
    const repository = new DemoTelegramRepository();

    await expect(
      repository.answerBotCallback("telobot", "telobot-2", "0:0"),
    ).resolves.toEqual({
      kind: "message",
      text: "Deploy needs two approvals.",
      alert: true,
    });
    await expect(
      repository.answerBotCallback("telobot", "telobot-2", "0:1"),
    ).resolves.toEqual({
      kind: "message",
      text: "Watching build alerts.",
      alert: false,
    });
    await expect(
      repository.answerBotCallback("telobot", "telobot-1", "0:0"),
    ).resolves.toEqual({
      kind: "url",
      url: "https://example.com/telo-bot/dashboard",
    });
    await expect(
      repository.answerBotCallback("telobot", "telobot-1", "0:1"),
    ).resolves.toEqual({ kind: "none" });
  });

  it("rejects a press that is not a callback button", async () => {
    const repository = new DemoTelegramRepository();

    // The url, copy, and unsupported buttons of telobot-2 have no callback
    // payload; the renderer services the first two itself.
    for (const buttonId of ["1:0", "1:1", "1:2", "9:9"]) {
      await expect(
        repository.answerBotCallback("telobot", "telobot-2", buttonId),
      ).rejects.toThrow(`Unknown callback button ${buttonId}`);
    }
  });

  it("rejects a press against an unknown chat or message", async () => {
    const repository = new DemoTelegramRepository();

    await expect(
      repository.answerBotCallback("nowhere", "telobot-2", "0:0"),
    ).rejects.toThrow("Unknown chat nowhere");
    await expect(
      repository.answerBotCallback("telobot", "telobot-9", "0:0"),
    ).rejects.toThrow("Unknown message telobot-9");
  });
});

describe("DemoTelegramRepository media downloads", () => {
  let cacheDirectory: string;

  async function makeRepository() {
    cacheDirectory = await mkdtemp(path.join(tmpdir(), "telo-demo-media-"));
    const repository = new DemoTelegramRepository({
      mediaCacheDirectory: cacheDirectory,
    });
    const events: unknown[] = [];
    repository.subscribe((event) => events.push(event));
    return { repository, events };
  }

  afterEach(async () => {
    await rm(cacheDirectory, { recursive: true, force: true });
  });

  it("evicts against the configured cache limit after a download", async () => {
    cacheDirectory = await mkdtemp(path.join(tmpdir(), "telo-demo-media-"));
    let limitBytes = 64 * 1024 ** 2;
    const repository = new DemoTelegramRepository({
      mediaCacheDirectory: cacheDirectory,
      mediaCacheLimitBytes: async () => limitBytes,
    });

    await repository.downloadMedia("design/media-1");
    await repository.downloadMedia("design/media-2");
    // Age both cached files so LRU ordering is deterministic; eviction always
    // spares the newest file.
    for (const [index, name] of [
      "design_media-1.png",
      "design_media-2.webm",
    ].entries()) {
      const stale = new Date(Date.UTC(2026, 7, index + 1));
      await utimes(path.join(cacheDirectory, name), stale, stale);
    }

    // Generous limit: both downloads stay cached.
    expect((await readdir(cacheDirectory)).sort()).toEqual([
      "design_media-1.png",
      "design_media-2.webm",
    ]);

    limitBytes = 1;
    await repository.downloadMedia("design/media-3");

    // The lowered preference governs this download, not the 512 MiB const.
    expect(await readdir(cacheDirectory)).toEqual(["design_media-3.png"]);
  });

  it("writes deterministic bytes into the cache and publishes a ready media URL", async () => {
    const { repository, events } = await makeRepository();

    await repository.downloadMedia("design/media-1");

    const ready = events.find(
      (event) =>
        (event as { type: string; state?: string }).type === "media-download" &&
        (event as { state?: string }).state === "ready",
    ) as { url: string; downloadedBytes: number } | undefined;
    expect(ready?.url).toBe("telo-media://cache/design_media-1.png");
    const cached = await readFile(
      path.join(cacheDirectory, "design_media-1.png"),
    );
    expect(cached.subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(cached.length).toBe(ready?.downloadedBytes);
    // Deterministic: a second repository instance generates identical bytes.
    const again = await makeRepository();
    await again.repository.downloadMedia("design/media-1");
    expect(
      await readFile(path.join(cacheDirectory, "design_media-1.png")),
    ).toEqual(cached);
  });

  it("serves video media as a bundled webm clip", async () => {
    const { repository } = await makeRepository();

    await repository.downloadMedia("design/media-2");

    const cached = await readFile(
      path.join(cacheDirectory, "design_media-2.webm"),
    );
    // EBML magic bytes.
    expect(cached.subarray(0, 4)).toEqual(
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    );
  });

  it("dedupes concurrent downloads of the same media", async () => {
    const { repository, events } = await makeRepository();

    await Promise.all([
      repository.downloadMedia("design/media-1"),
      repository.downloadMedia("design/media-1"),
    ]);

    const started = events.filter(
      (event) =>
        (event as { type: string; state?: string }).type === "media-download" &&
        (event as { state?: string }).state === "downloading",
    );
    expect(started).toHaveLength(1);
  });

  it("resolves the cached file path after downloading", async () => {
    const { repository } = await makeRepository();

    const filePath = await repository.resolveMediaFile("design/media-3");

    expect(filePath).toBe(path.join(cacheDirectory, "design_media-3.png"));
    await expect(readFile(filePath)).resolves.toBeInstanceOf(Buffer);
  });

  it("keeps a sent file downloadable with its original bytes", async () => {
    const { repository } = await makeRepository();
    const sourcePath = path.join(cacheDirectory, "source-photo.png");
    const sourceBytes = Buffer.from("original upload bytes");
    await writeFile(sourcePath, sourceBytes);

    const [message] = await repository.sendMedia(
      "design",
      [
        {
          source: sourcePath,
          name: "source-photo.png",
          mimeType: "image/png",
          size: sourceBytes.length,
        },
      ],
      "",
      undefined,
      undefined,
      "upload-cache",
    );
    const media = message?.media;
    if (!media || media.kind === "webpage") {
      throw new Error("expected file media on the sent message");
    }

    const filePath = await repository.resolveMediaFile(media.id);
    expect(await readFile(filePath)).toEqual(sourceBytes);
  });

  it("rejects downloads without a configured cache directory", async () => {
    const repository = new DemoTelegramRepository();
    await expect(repository.downloadMedia("design/media-1")).rejects.toThrow(
      "Demo media cache is unavailable",
    );
  });

  it("rejects downloads for unknown media", async () => {
    const { repository } = await makeRepository();
    await expect(repository.downloadMedia("design/missing")).rejects.toThrow(
      "Unknown demo media design/missing",
    );
  });

  it("downloads a set sticker that hangs off no message", async () => {
    const { repository } = await makeRepository();

    // The Lottie entry: gzip magic bytes, cached under the sticker media id.
    const animated = await repository.resolveMediaFile("sticker/2");
    expect(animated).toBe(path.join(cacheDirectory, "sticker_2.tgs"));
    expect((await readFile(animated)).subarray(0, 2)).toEqual(
      Buffer.from([0x1f, 0x8b]),
    );

    // The video entry: EBML magic bytes.
    const video = await repository.resolveMediaFile("sticker/3");
    expect(video).toBe(path.join(cacheDirectory, "sticker_3.webm"));
    expect((await readFile(video)).subarray(0, 4)).toEqual(
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    );

    // The still entry is synthesized as a PNG, like every other demo still.
    const still = await repository.resolveMediaFile("sticker/1");
    expect(still).toBe(path.join(cacheDirectory, "sticker_1.png"));
    expect((await readFile(still)).subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it("rejects downloads for a sticker outside the installed set", async () => {
    const { repository } = await makeRepository();
    await expect(repository.downloadMedia("sticker/404")).rejects.toThrow(
      "Unknown demo media sticker/404",
    );
  });
});
