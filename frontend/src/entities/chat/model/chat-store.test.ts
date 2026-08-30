import { EventType, type AGUIEvent } from "@ag-ui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  GlobalSearchResultDto,
  MessageDto,
} from "../../../../../contracts/src/ipc";
import {
  ARCHIVE_FOLDER_ID,
  MESSAGE_ACTION_EVENT_NAME,
  MESSAGE_ACTION_THREAD_ID,
} from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

import {
  allChatsUnread,
  chatsForFolder,
  subscribeToWorkspaceEvents,
  useChatStore,
} from "./chat-store";

function chat(id: string): ChatDto {
  return {
    id,
    title: `Chat ${id}`,
    preview: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "direct",
    initials: "C",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
  };
}

function message(id: string, chatId: string): MessageDto {
  return {
    id,
    chatId,
    senderName: "Sender",
    body: `Message ${id}`,
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-01-01T00:00:00.000Z",
    outgoing: false,
    status: "read",
  };
}

describe("chat-store", () => {
  beforeEach(() => {
    useChatStore.setState({
      chats: [],
      folders: [],
      activeFolderId: null,
      messages: [],
      activeChatId: null,
      loading: true,
      loadingMoreChats: false,
      loadingOlderMessages: false,
      chatCursor: null,
      messageCursor: null,
      syncError: null,
      connectionState: "connected",
      composerTarget: null,
      drafts: {},
      scrollPositions: {},
      notificationsEnabled: false,
      mediaDownloads: {},
      mediaUploads: {},
      animateInMessageIds: [],
      animateChatIds: [],
    });
  });

  it("load() selects the first chat and loads its messages by default", async () => {
    const telo = installTeloApiMock();
    const chats = [chat("a"), chat("b")];
    const messages = [message("m1", "a")];
    telo.workspace.listChatPage.mockResolvedValue({
      items: chats,
      nextCursor: null,
    });
    telo.workspace.listMessagePage.mockResolvedValue({
      items: messages,
      nextCursor: null,
    });

    await useChatStore.getState().load();

    const state = useChatStore.getState();
    expect(state.chats).toEqual(chats);
    expect(state.activeChatId).toBe("a");
    expect(state.messages).toEqual(messages);
    expect(state.loading).toBe(false);
    expect(telo.workspace.listMessagePage).toHaveBeenCalledWith("a");
  });

  it("load() hydrates drafts from the server draft preview", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listChatPage.mockResolvedValue({
      items: [{ ...chat("a"), draftPreview: "left off here" }],
      nextCursor: null,
    });
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await useChatStore.getState().load();

    expect(useChatStore.getState().drafts.a).toBe("left off here");
  });

  it("load() leaves no active chat and skips messages when the list is empty", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listChatPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await useChatStore.getState().load();

    const state = useChatStore.getState();
    expect(state.activeChatId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.loading).toBe(false);
    expect(telo.workspace.listMessagePage).not.toHaveBeenCalled();
  });

  it("load() stores the server folder list", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listChatPage.mockResolvedValue({
      items: [chat("a")],
      nextCursor: null,
    });
    telo.workspace.listFolders.mockResolvedValue([
      { id: 2, title: "Work", unreadCount: 3 },
      { id: ARCHIVE_FOLDER_ID, title: "Archive", unreadCount: 1 },
    ]);

    await useChatStore.getState().load();

    await vi.waitFor(() => {
      expect(useChatStore.getState().folders).toEqual([
        { id: 2, title: "Work", unreadCount: 3 },
        { id: ARCHIVE_FOLDER_ID, title: "Archive", unreadCount: 1 },
      ]);
    });
  });

  it("load() lands on the first non-archived chat, never an archived one", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listChatPage.mockResolvedValue({
      items: [
        { ...chat("archived"), folderId: ARCHIVE_FOLDER_ID },
        { ...chat("main"), folderId: null },
      ],
      nextCursor: null,
    });
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await useChatStore.getState().load();

    expect(useChatStore.getState().activeChatId).toBe("main");
  });

  it("selectFolder() switches the active folder tab", () => {
    const store = useChatStore.getState();

    store.selectFolder(2);
    expect(useChatStore.getState().activeFolderId).toBe(2);
    store.selectFolder(ARCHIVE_FOLDER_ID);
    expect(useChatStore.getState().activeFolderId).toBe(ARCHIVE_FOLDER_ID);
    store.selectFolder(null);
    expect(useChatStore.getState().activeFolderId).toBeNull();
  });

  it("receive() replaces the folder list on a folders event", () => {
    useChatStore.getState().receive({
      type: "folders",
      folders: [{ id: 2, title: "Work", unreadCount: 0 }],
    });

    expect(useChatStore.getState().folders).toEqual([
      { id: 2, title: "Work", unreadCount: 0 },
    ]);
  });

  it("loadMoreChats() appends a page once and advances the cursor", async () => {
    const telo = installTeloApiMock();
    const cursor = {
      chatId: "a",
      topMessageId: "1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    telo.workspace.listChatPage.mockResolvedValue({
      items: [chat("b")],
      nextCursor: null,
    });
    useChatStore.setState({ chats: [chat("a")], chatCursor: cursor });

    await useChatStore.getState().loadMoreChats();
    await useChatStore.getState().loadMoreChats();

    expect(telo.workspace.listChatPage).toHaveBeenCalledWith({ cursor });
    expect(telo.workspace.listChatPage).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().chats.map((entry) => entry.id)).toEqual([
      "a",
      "b",
    ]);
    expect(useChatStore.getState().chatCursor).toBeNull();
  });

  it("select() returns early when the chat is already active", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({ activeChatId: "a", loading: false });

    await useChatStore.getState().select("a");

    expect(telo.workspace.listMessagePage).not.toHaveBeenCalled();
    expect(useChatStore.getState().loading).toBe(false);
  });

  it("select() switches the active chat and loads its messages", async () => {
    const telo = installTeloApiMock();
    const messages = [message("m2", "b")];
    telo.workspace.listMessagePage.mockResolvedValue({
      items: messages,
      nextCursor: null,
    });
    useChatStore.setState({ activeChatId: "a", loading: false });

    await useChatStore.getState().select("b");

    const state = useChatStore.getState();
    expect(state.activeChatId).toBe("b");
    expect(state.messages).toEqual(messages);
    expect(state.loading).toBe(false);
  });

  it("select() clears stale messages immediately and ignores a slower previous request", async () => {
    const telo = installTeloApiMock();
    let resolveB:
      ((page: { items: MessageDto[]; nextCursor: null }) => void) | undefined;
    telo.workspace.listMessagePage.mockImplementation((chatId) =>
      chatId === "b"
        ? new Promise((resolve) => {
            resolveB = resolve;
          })
        : Promise.resolve({
            items: [message("m3", "c")],
            nextCursor: null,
          }),
    );
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
      loading: false,
    });

    const first = useChatStore.getState().select("b");
    expect(useChatStore.getState().messages).toEqual([]);
    const second = useChatStore.getState().select("c");
    await second;
    resolveB?.({ items: [message("m2", "b")], nextCursor: null });
    await first;

    expect(useChatStore.getState().activeChatId).toBe("c");
    expect(useChatStore.getState().messages).toEqual([message("m3", "c")]);
  });

  it("loadOlderMessages() prepends an exclusive page and advances its cursor", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [message("1", "a")],
      nextCursor: null,
    });
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("2", "a")],
      messageCursor: "2",
    });

    await useChatStore.getState().loadOlderMessages();
    await useChatStore.getState().loadOlderMessages();

    expect(telo.workspace.listMessagePage).toHaveBeenCalledWith("a", {
      beforeMessageId: "2",
    });
    expect(telo.workspace.listMessagePage).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().messages.map((entry) => entry.id)).toEqual([
      "1",
      "2",
    ]);
    expect(useChatStore.getState().messageCursor).toBeNull();
  });

  it("receive() exposes connection state transitions", () => {
    useChatStore.getState().receive({
      type: "connection-state",
      state: "offline",
    });
    expect(useChatStore.getState().connectionState).toBe("offline");

    useChatStore.getState().receive({
      type: "connection-state",
      state: "connected",
    });
    expect(useChatStore.getState().connectionState).toBe("connected");
  });

  it("receive() ignores language-level sync failures", () => {
    useChatStore.getState().receive({
      type: "sync-error",
      message: "Right-hand side of 'instanceof' is not callable",
    });
    expect(useChatStore.getState().syncError).toBeNull();
  });

  it("receive() keeps user-facing sync failures", () => {
    useChatStore.getState().receive({
      type: "sync-error",
      message: "FLOOD_WAIT_30",
    });
    expect(useChatStore.getState().syncError).toBe("FLOOD_WAIT_30");
  });

  it("receive() replaces the chat list after a live GetDialogs refresh", () => {
    useChatStore.setState({
      chats: [chat("cached")],
      chatCursor: {
        chatId: "cached",
        topMessageId: "1",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    useChatStore.getState().receive({
      type: "chats",
      chats: [chat("1")],
      nextCursor: null,
    });
    expect(useChatStore.getState().chats.map((entry) => entry.id)).toEqual(["1"]);
    expect(useChatStore.getState().chatCursor).toBeNull();
  });

  it("load() maps language-level failures to the generic sync copy", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listChatPage.mockRejectedValue(
      new TypeError("Right-hand side of 'instanceof' is not callable"),
    );

    await useChatStore.getState().load();

    expect(useChatStore.getState().syncError).toBe(copy.syncError);
  });

  it("send() returns early when no chat is active", async () => {
    const telo = installTeloApiMock();

    await useChatStore.getState().send("hello");

    expect(telo.workspace.sendMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("send() appends the delivered message to the active chat", async () => {
    const telo = installTeloApiMock();
    const sent = message("m3", "a");
    telo.workspace.sendMessage.mockResolvedValue(sent);
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });

    await useChatStore.getState().send("hello");

    expect(telo.workspace.sendMessage).toHaveBeenCalledWith("a", "hello", {
      clientId: expect.any(String),
    });
    expect(useChatStore.getState().messages).toEqual([
      message("m1", "a"),
      sent,
    ]);
  });

  it("send() forwards composer entities to the workspace", async () => {
    const telo = installTeloApiMock();
    const sent = message("m4", "a");
    telo.workspace.sendMessage.mockResolvedValue(sent);
    useChatStore.setState({
      activeChatId: "a",
      messages: [],
    });
    const entities = [{ type: "bold" as const, offset: 0, length: 5 }];

    await useChatStore.getState().send("hello", { entities });

    expect(telo.workspace.sendMessage).toHaveBeenCalledWith("a", "hello", {
      clientId: expect.any(String),
      entities,
    });
  });

  it("send() inserts an optimistic bubble immediately and clears the draft", async () => {
    const telo = installTeloApiMock();
    let resolveSend: ((message: MessageDto) => void) | undefined;
    telo.workspace.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    useChatStore.setState({
      activeChatId: "a",
      messages: [],
      drafts: { a: "hello" },
    });

    const pending = useChatStore.getState().send("hello");

    const optimistic = useChatStore
      .getState()
      .messages.find((entry) => entry.chatId === "a");
    expect(optimistic?.status).toBe("sending");
    expect(optimistic?.outgoing).toBe(true);
    expect(useChatStore.getState().drafts.a).toBe("");

    resolveSend?.(message("m3", "a"));
    await pending;

    expect(useChatStore.getState().messages).toEqual([message("m3", "a")]);
  });

  it("send() keeps the optimistic bubble as failed when delivery fails", async () => {
    const telo = installTeloApiMock();
    telo.workspace.sendMessage.mockRejectedValue(new Error("Network down"));
    useChatStore.setState({
      activeChatId: "a",
      messages: [],
      drafts: { a: "hello" },
    });

    // Native semantics: the bubble stays in the transcript as `failed` and
    // the body is not bounced back into the composer draft.
    await useChatStore.getState().send("hello");

    const failed = useChatStore.getState().messages;
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      chatId: "a",
      body: "hello",
      outgoing: true,
      status: "failed",
    });
    expect(failed[0]?.clientId).toBe(failed[0]?.id);
    expect(useChatStore.getState().drafts.a).toBe("");
  });

  it("resendMessage() retries the failed body and reconciles with the ack", async () => {
    const telo = installTeloApiMock();
    telo.workspace.sendMessage.mockRejectedValueOnce(new Error("Network down"));
    const sent = {
      ...message("m9", "a"),
      outgoing: true,
      status: "sent" as const,
    };
    telo.workspace.sendMessage.mockResolvedValueOnce(sent);
    useChatStore.setState({ activeChatId: "a", messages: [] });

    await useChatStore.getState().send("hello");
    const failed = useChatStore.getState().messages[0];
    expect(failed?.status).toBe("failed");

    await useChatStore.getState().resendMessage(failed!.id);

    expect(telo.workspace.sendMessage).toHaveBeenLastCalledWith("a", "hello", {
      replyToId: undefined,
      clientId: failed!.clientId,
    });
    expect(useChatStore.getState().messages).toEqual([sent]);
  });

  it("resendMessage() keeps the bubble failed when the retry fails again", async () => {
    const telo = installTeloApiMock();
    telo.workspace.sendMessage.mockRejectedValue(new Error("Network down"));
    useChatStore.setState({ activeChatId: "a", messages: [] });

    await useChatStore.getState().send("hello");
    const failed = useChatStore.getState().messages[0];
    await useChatStore.getState().resendMessage(failed!.id);

    const retried = useChatStore.getState().messages;
    expect(retried).toHaveLength(1);
    expect(retried[0]).toMatchObject({ id: failed!.id, status: "failed" });
  });

  it("resendMessage() ignores a message that is not failed", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });

    await useChatStore.getState().resendMessage("m1");

    expect(telo.workspace.sendMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toEqual([message("m1", "a")]);
  });

  it("receive() upserts live messages without duplicating an IPC response", () => {
    const live = message("m2", "a");
    useChatStore.setState({
      chats: [chat("a")],
      activeChatId: "a",
      messages: [message("m1", "a")],
    });

    useChatStore.getState().receive({
      type: "message-upsert",
      cause: "new",
      message: live,
    });
    useChatStore.getState().receive({
      type: "message-upsert",
      cause: "new",
      message: { ...live, status: "sent" },
    });

    expect(useChatStore.getState().messages).toHaveLength(2);
    expect(useChatStore.getState().chats[0]?.preview).toBe("Message m2");
  });

  it("receive() increments unread state only for an inactive incoming chat", () => {
    useChatStore.setState({
      chats: [chat("a"), chat("b")],
      activeChatId: "a",
    });

    useChatStore.getState().receive({
      type: "message-upsert",
      cause: "new",
      message: message("m2", "b"),
    });

    const chats = useChatStore.getState().chats;
    expect(chats.find((entry) => entry.id === "b")?.unreadCount).toBe(1);
    expect(chats[0]?.id).toBe("b");
    expect(useChatStore.getState().animateChatIds).toEqual(["b"]);
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("flags a newly arrived active-chat message for animateIn, not an edit", () => {
    useChatStore.setState({
      chats: [chat("a")],
      activeChatId: "a",
      messages: [message("m1", "a")],
      animateInMessageIds: [],
    });

    useChatStore.getState().receive({
      type: "message-upsert",
      cause: "new",
      message: message("m2", "a"),
    });
    expect(useChatStore.getState().animateInMessageIds).toEqual(["m2"]);

    useChatStore.getState().receive({
      type: "message-upsert",
      cause: "edited",
      message: { ...message("m2", "a"), body: "edited" },
    });
    expect(useChatStore.getState().animateInMessageIds).toEqual(["m2"]);
  });

  it("send() flags the optimistic bubble for animateIn", async () => {
    const telo = installTeloApiMock();
    let resolveSend: ((message: MessageDto) => void) | undefined;
    telo.workspace.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    useChatStore.setState({
      activeChatId: "a",
      messages: [],
      animateInMessageIds: [],
    });

    const pending = useChatStore.getState().send("hello");
    const optimistic = useChatStore.getState().messages[0];
    expect(optimistic?.status).toBe("sending");
    expect(useChatStore.getState().animateInMessageIds).toEqual([
      optimistic?.id,
    ]);

    resolveSend?.(message("m3", "a"));
    await pending;
    expect(useChatStore.getState().animateInMessageIds).toEqual([
      optimistic?.id,
    ]);
    expect(useChatStore.getState().animateInMessageIds).not.toContain("m3");
  });

  it("loadOlderMessages() does not flag prepended history for animateIn", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [message("m0", "a")],
      nextCursor: null,
    });
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
      messageCursor: "m1",
      animateInMessageIds: [],
    });

    await useChatStore.getState().loadOlderMessages();

    expect(useChatStore.getState().messages.map((entry) => entry.id)).toEqual([
      "m0",
      "m1",
    ]);
    expect(useChatStore.getState().animateInMessageIds).toEqual([]);
  });

  it("togglePin() moves the chat to the pinned slot and flags it for a fade", async () => {
    installTeloApiMock();
    useChatStore.setState({
      chats: [chat("a"), chat("b")],
      animateChatIds: [],
    });

    await useChatStore.getState().togglePin("b");

    expect(useChatStore.getState().chats.map((entry) => entry.id)).toEqual([
      "b",
      "a",
    ]);
    expect(useChatStore.getState().chats[0]?.pinned).toBe(true);
    expect(useChatStore.getState().animateChatIds).toEqual(["b"]);
  });

  it("receive() patches typing state on the matching chat", () => {
    useChatStore.setState({ chats: [chat("a"), chat("b")] });

    useChatStore
      .getState()
      .receive({ type: "typing", chatId: "b", typing: true });

    expect(useChatStore.getState().chats[0]?.typing).toBe(false);
    expect(useChatStore.getState().chats[1]?.typing).toBe(true);
  });

  it("receive() patches a lazily loaded avatar without replacing chat state", () => {
    useChatStore.setState({
      chats: [{ ...chat("a"), preview: "newest", unreadCount: 4 }],
    });

    useChatStore.getState().receive({
      type: "chat-avatar",
      chatId: "a",
      avatarDataUrl: "data:image/jpeg;base64,cGhvdG8=",
    });

    expect(useChatStore.getState().chats[0]).toMatchObject({
      preview: "newest",
      unreadCount: 4,
      avatarDataUrl: "data:image/jpeg;base64,cGhvdG8=",
    });
  });

  it("receive() patches mute and pin state from another Telegram client", () => {
    useChatStore.setState({ chats: [chat("a"), chat("b")] });

    useChatStore
      .getState()
      .receive({ type: "chat-mute", chatId: "a", muted: true });
    useChatStore
      .getState()
      .receive({ type: "chat-pin", chatId: "a", pinned: true });

    expect(useChatStore.getState().chats[0]?.muted).toBe(true);
    expect(useChatStore.getState().chats[0]?.pinned).toBe(true);
    expect(useChatStore.getState().chats[1]?.muted).toBe(false);
    expect(useChatStore.getState().chats[1]?.pinned).toBe(false);
  });

  it("receive() applies a remote draft to an inactive chat but not the active one", () => {
    useChatStore.setState({
      chats: [chat("a"), chat("b")],
      activeChatId: "a",
      drafts: { a: "typing locally" },
    });

    useChatStore.getState().receive({
      type: "draft",
      chatId: "a",
      draftPreview: "from another device",
    });
    useChatStore.getState().receive({
      type: "draft",
      chatId: "b",
      draftPreview: "from another device",
    });

    expect(useChatStore.getState().chats[0]?.draftPreview).toBe(
      "from another device",
    );
    expect(useChatStore.getState().drafts.a).toBe("typing locally");
    expect(useChatStore.getState().drafts.b).toBe("from another device");
  });

  it("receive() notifies for an inactive, unmuted chat while the window is hidden", () => {
    const telo = installTeloApiMock();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    useChatStore.setState({
      chats: [chat("a"), chat("b")],
      activeChatId: "a",
      notificationsEnabled: true,
    });

    useChatStore.getState().receive({
      type: "message-upsert",
      cause: "new",
      message: message("m2", "b"),
    });

    expect(telo.shell.notify).toHaveBeenCalledWith("Chat b", "Message m2", "b");
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  it("receive() does not notify for a muted chat", () => {
    const telo = installTeloApiMock();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    useChatStore.setState({
      chats: [chat("a"), { ...chat("b"), muted: true }],
      activeChatId: "a",
      notificationsEnabled: true,
    });

    useChatStore.getState().receive({
      type: "message-upsert",
      cause: "new",
      message: message("m2", "b"),
    });

    expect(telo.shell.notify).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  it("receive() applies deletion and outbox read events", () => {
    useChatStore.setState({
      chats: [chat("a")],
      activeChatId: "a",
      messages: [
        { ...message("1", "a"), outgoing: true, status: "sent" },
        { ...message("2", "a"), outgoing: true, status: "sent" },
      ],
    });

    useChatStore.getState().receive({
      type: "message-read",
      chatId: "a",
      maxMessageId: "1",
      direction: "outbox",
    });
    useChatStore.getState().receive({
      type: "message-delete",
      chatId: "a",
      messageIds: ["2"],
    });

    expect(useChatStore.getState().messages).toEqual([
      { ...message("1", "a"), outgoing: true, status: "read" },
    ]);
  });

  it("togglePin() inverts the pinned flag through the API and patches the chat", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({ chats: [chat("a"), chat("b")] });

    await useChatStore.getState().togglePin("b");

    expect(telo.workspace.setChatPinned).toHaveBeenCalledWith("b", true);
    const state = useChatStore.getState();
    expect(state.chats.find((entry) => entry.id === "b")?.pinned).toBe(true);
    expect(state.chats.find((entry) => entry.id === "a")?.pinned).toBe(false);
  });

  it("toggleMute() inverts the muted flag through the API and patches the chat", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({
      chats: [{ ...chat("a"), muted: true }],
    });

    await useChatStore.getState().toggleMute("a");

    expect(telo.workspace.setChatMuted).toHaveBeenCalledWith("a", false);
    expect(useChatStore.getState().chats[0]?.muted).toBe(false);
  });

  it("toggleRead() marks a chat with unread messages as read", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({
      chats: [{ ...chat("a"), unreadCount: 3 }],
    });

    await useChatStore.getState().toggleRead("a");

    expect(telo.workspace.setChatRead).toHaveBeenCalledWith("a", true);
    expect(useChatStore.getState().chats[0]?.unreadCount).toBe(0);
  });

  it("toggleRead() flags a fully read chat as unread", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({ chats: [chat("a")] });

    await useChatStore.getState().toggleRead("a");

    expect(telo.workspace.setChatRead).toHaveBeenCalledWith("a", false);
    expect(useChatStore.getState().chats[0]?.unreadCount).toBe(1);
  });

  it.each(["togglePin", "toggleMute", "toggleRead"] as const)(
    "%s() returns early for an unknown chat",
    async (action) => {
      const telo = installTeloApiMock();
      useChatStore.setState({ chats: [chat("a")] });

      await useChatStore.getState()[action]("missing");

      expect(telo.workspace.setChatPinned).not.toHaveBeenCalled();
      expect(telo.workspace.setChatMuted).not.toHaveBeenCalled();
      expect(telo.workspace.setChatRead).not.toHaveBeenCalled();
    },
  );

  it("keeps the stored chats when a toggle fails", async () => {
    const telo = installTeloApiMock();
    telo.workspace.setChatPinned.mockRejectedValue(new Error("IPC down"));
    useChatStore.setState({ chats: [chat("a")] });

    await expect(useChatStore.getState().togglePin("a")).rejects.toThrow(
      "IPC down",
    );
    expect(useChatStore.getState().chats[0]?.pinned).toBe(false);
  });

  it("startReply() and startEdit() set the composer target with a preview", () => {
    const target = message("m1", "a");

    useChatStore.getState().startReply(target);
    expect(useChatStore.getState().composerTarget).toEqual({
      mode: "reply",
      messageId: "m1",
      preview: "Message m1",
    });

    useChatStore.getState().startEdit(target);
    expect(useChatStore.getState().composerTarget).toEqual({
      mode: "edit",
      messageId: "m1",
      preview: "Message m1",
    });
  });

  it("cancelComposerTarget() clears the composer target", () => {
    useChatStore.getState().startReply(message("m1", "a"));

    useChatStore.getState().cancelComposerTarget();

    expect(useChatStore.getState().composerTarget).toBeNull();
  });

  it("select() clears a pending composer target from the previous chat", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    useChatStore.setState({ activeChatId: "a", loading: false });
    useChatStore.getState().startReply(message("m1", "a"));

    await useChatStore.getState().select("b");

    expect(useChatStore.getState().composerTarget).toBeNull();
  });

  it("send() in reply mode passes the replyToId and clears the target", async () => {
    const telo = installTeloApiMock();
    const sent = message("m3", "a");
    telo.workspace.sendMessage.mockResolvedValue(sent);
    useChatStore.setState({ activeChatId: "a", messages: [] });
    useChatStore.getState().startReply(message("m1", "a"));

    await useChatStore.getState().send("hello");

    expect(telo.workspace.sendMessage).toHaveBeenCalledWith("a", "hello", {
      replyToId: "m1",
      clientId: expect.any(String),
    });
    expect(useChatStore.getState().messages).toEqual([sent]);
    expect(useChatStore.getState().composerTarget).toBeNull();
  });

  it("send() in edit mode edits the message in place and clears the target", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a"), message("m2", "a")],
    });
    useChatStore.getState().startEdit(message("m1", "a"));

    await useChatStore.getState().send("rewritten");

    expect(telo.workspace.editMessage).toHaveBeenCalledWith({
      chatId: "a",
      messageId: "m1",
      body: "rewritten",
    });
    expect(telo.workspace.sendMessage).not.toHaveBeenCalled();
    const state = useChatStore.getState();
    const edited = state.messages.find((entry) => entry.id === "m1");
    expect(edited?.body).toBe("rewritten");
    expect(typeof edited?.editedAt).toBe("string");
    expect(state.messages.find((entry) => entry.id === "m2")?.body).toBe(
      "Message m2",
    );
    expect(state.composerTarget).toBeNull();
  });

  it("deleteMessage() removes the message and syncs the preview of the last message", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({
      chats: [{ ...chat("a"), preview: "Message m2" }],
      activeChatId: "a",
      messages: [message("m1", "a"), message("m2", "a")],
    });

    await useChatStore.getState().deleteMessage("m2");

    expect(telo.workspace.deleteMessage).toHaveBeenCalledWith({
      chatId: "a",
      messageId: "m2",
    });
    const state = useChatStore.getState();
    expect(state.messages.map((entry) => entry.id)).toEqual(["m1"]);
    expect(state.chats[0]?.preview).toBe("Message m1");
  });

  it("deleteMessage() keeps the preview when an older message is removed", async () => {
    installTeloApiMock();
    useChatStore.setState({
      chats: [{ ...chat("a"), preview: "Message m2" }],
      activeChatId: "a",
      messages: [message("m1", "a"), message("m2", "a")],
    });

    await useChatStore.getState().deleteMessage("m1");

    const state = useChatStore.getState();
    expect(state.messages.map((entry) => entry.id)).toEqual(["m2"]);
    expect(state.chats[0]?.preview).toBe("Message m2");
  });

  it("deleteMessage() drops a composer target that references the message", async () => {
    installTeloApiMock();
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });
    useChatStore.getState().startReply(message("m1", "a"));

    await useChatStore.getState().deleteMessage("m1");

    expect(useChatStore.getState().composerTarget).toBeNull();
  });

  it("deleteMessage() forwards the scope to the API", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });

    await useChatStore.getState().deleteMessage("m1", "me");

    expect(telo.workspace.deleteMessage).toHaveBeenCalledWith({
      chatId: "a",
      messageId: "m1",
      scope: "me",
    });
  });

  it("selection toggles ids and empties back out of selection mode", () => {
    useChatStore.setState({ messages: [message("m1", "a")] });

    useChatStore.getState().startSelection("m1");
    expect(useChatStore.getState().selectedMessageIds).toEqual(["m1"]);

    useChatStore.getState().toggleSelection("m2");
    expect(useChatStore.getState().selectedMessageIds).toEqual(["m1", "m2"]);

    useChatStore.getState().toggleSelection("m1");
    expect(useChatStore.getState().selectedMessageIds).toEqual(["m2"]);

    useChatStore.getState().toggleSelection("m2");
    expect(useChatStore.getState().selectedMessageIds).toEqual([]);

    useChatStore.getState().startSelection("m1");
    useChatStore.getState().exitSelection();
    expect(useChatStore.getState().selectedMessageIds).toEqual([]);
  });

  it("select() clears a pending selection from the previous chat", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [message("n1", "b")],
      nextCursor: null,
    });
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
      selectedMessageIds: ["m1"],
    });

    await useChatStore.getState().select("b");

    expect(useChatStore.getState().selectedMessageIds).toEqual([]);
  });

  it("a delete event prunes the selection", () => {
    installTeloApiMock();
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a"), message("m2", "a")],
      selectedMessageIds: ["m1", "m2"],
    });

    useChatStore.getState().receive({
      type: "message-delete",
      chatId: "a",
      messageIds: ["m1"],
    });

    expect(useChatStore.getState().selectedMessageIds).toEqual(["m2"]);
  });

  it("deleteSelectedMessages() deletes each id with the scope and exits selection", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({
      chats: [{ ...chat("a"), preview: "Message m3" }],
      activeChatId: "a",
      messages: [message("m1", "a"), message("m2", "a"), message("m3", "a")],
      selectedMessageIds: ["m2", "m3"],
    });

    await useChatStore.getState().deleteSelectedMessages("everyone");

    expect(telo.workspace.deleteMessage.mock.calls).toEqual([
      [{ chatId: "a", messageId: "m2", scope: "everyone" }],
      [{ chatId: "a", messageId: "m3", scope: "everyone" }],
    ]);
    const state = useChatStore.getState();
    expect(state.messages.map((entry) => entry.id)).toEqual(["m1"]);
    expect(state.chats[0]?.preview).toBe("Message m1");
    expect(state.selectedMessageIds).toEqual([]);
  });

  it("forwardSelectedMessages() forwards each id in order, reloads once, and exits", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listChatPage.mockResolvedValue({
      items: [chat("a"), chat("b")],
      nextCursor: null,
    });
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a"), message("m2", "a")],
      selectedMessageIds: ["m1", "m2"],
    });

    await useChatStore.getState().forwardSelectedMessages("b");

    expect(telo.workspace.forwardMessage.mock.calls).toEqual([
      [{ fromChatId: "a", messageId: "m1", toChatId: "b" }],
      [{ fromChatId: "a", messageId: "m2", toChatId: "b" }],
    ]);
    expect(telo.workspace.listChatPage).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().selectedMessageIds).toEqual([]);
  });

  it("forwardMessage() forwards through the API and reloads the chat list", async () => {
    const telo = installTeloApiMock();
    const chats = [chat("a"), chat("b")];
    telo.workspace.listChatPage.mockResolvedValue({
      items: chats,
      nextCursor: null,
    });
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });

    await useChatStore.getState().forwardMessage("m1", "b");

    expect(telo.workspace.forwardMessage).toHaveBeenCalledWith({
      fromChatId: "a",
      messageId: "m1",
      toChatId: "b",
    });
    expect(useChatStore.getState().chats).toEqual(chats);
    expect(telo.workspace.listMessagePage).not.toHaveBeenCalled();
  });

  it("forwardMessage() passes the hide-sender flag through to the API", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listChatPage.mockResolvedValue({
      items: [chat("a"), chat("b")],
      nextCursor: null,
    });
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });

    await useChatStore.getState().forwardMessage("m1", "b", {
      hideSender: true,
    });

    expect(telo.workspace.forwardMessage).toHaveBeenCalledWith({
      fromChatId: "a",
      messageId: "m1",
      toChatId: "b",
      hideSender: true,
    });
  });

  it("forwardMessage() reloads messages when forwarding into the active chat", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listChatPage.mockResolvedValue({
      items: [chat("a")],
      nextCursor: null,
    });
    const messages = [message("m1", "a"), message("m2", "a")];
    telo.workspace.listMessagePage.mockResolvedValue({
      items: messages,
      nextCursor: null,
    });
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });

    await useChatStore.getState().forwardMessage("m1", "a");

    expect(telo.workspace.listMessagePage).toHaveBeenCalledWith("a");
    expect(useChatStore.getState().messages).toEqual(messages);
  });

  it("sendMedia() inserts optimistic album bubbles and reconciles them with the ack", async () => {
    const telo = installTeloApiMock();
    let resolveSend: ((messages: MessageDto[]) => void) | undefined;
    telo.workspace.sendMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    useChatStore.setState({
      activeChatId: "a",
      messages: [],
      drafts: { a: "caption" },
    });
    const files = [
      new File(["a"], "photo.png", { type: "image/png" }),
      new File(["b"], "notes.txt", { type: "text/plain" }),
    ];

    const pending = useChatStore
      .getState()
      .sendMedia(files, "caption", "upload-1");

    const optimistic = useChatStore.getState().messages;
    expect(optimistic).toHaveLength(2);
    expect(optimistic[0]?.status).toBe("sending");
    expect(optimistic[0]?.outgoing).toBe(true);
    expect(optimistic[0]?.body).toBe("caption");
    expect(optimistic[0]?.media).toMatchObject({
      kind: "photo",
      fileName: "photo.png",
    });
    expect(optimistic[1]?.body).toBe("");
    expect(optimistic[1]?.media).toMatchObject({
      kind: "file",
      fileName: "notes.txt",
    });
    // One album action: both bubbles share a groupedId and one sendMedia call.
    expect(optimistic[0]?.groupedId).not.toBeNull();
    expect(optimistic[0]?.groupedId).toBe(optimistic[1]?.groupedId);
    expect(useChatStore.getState().drafts.a).toBe("");

    const ack = [
      { ...message("m9", "a"), outgoing: true, status: "sent" as const },
      { ...message("m10", "a"), outgoing: true, status: "sent" as const },
    ];
    resolveSend?.(ack);
    await pending;

    expect(telo.workspace.sendMedia).toHaveBeenCalledTimes(1);
    expect(telo.workspace.sendMedia).toHaveBeenCalledWith("a", files, {
      uploadId: "upload-1",
      caption: "caption",
      replyToId: undefined,
      clientId: expect.any(String),
    });
    expect(useChatStore.getState().messages).toEqual(ack);
  });

  it("sendMedia() in reply mode passes the replyToId and clears the target", async () => {
    const telo = installTeloApiMock();
    telo.workspace.sendMedia.mockResolvedValue([message("m9", "a")]);
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });
    useChatStore.getState().startReply(message("m1", "a"));
    const files = [new File(["a"], "photo.png", { type: "image/png" })];

    await useChatStore.getState().sendMedia(files, "", "upload-2");

    expect(telo.workspace.sendMedia).toHaveBeenCalledWith("a", files, {
      uploadId: "upload-2",
      caption: "",
      replyToId: "m1",
      clientId: expect.any(String),
    });
    expect(useChatStore.getState().composerTarget).toBeNull();
  });

  it("sendMedia() drops the optimistic bubbles and rethrows on failure", async () => {
    const telo = installTeloApiMock();
    telo.workspace.sendMedia.mockRejectedValue(new Error("Upload failed"));
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });
    const files = [new File(["a"], "photo.png", { type: "image/png" })];

    await expect(
      useChatStore.getState().sendMedia(files, "", "upload-3"),
    ).rejects.toThrow("Upload failed");

    expect(useChatStore.getState().messages).toEqual([message("m1", "a")]);
    expect(useChatStore.getState().syncError).toBe("Upload failed");
  });

  it("sendMedia() does not raise syncError for a user-cancelled upload", async () => {
    const telo = installTeloApiMock();
    telo.workspace.sendMedia.mockRejectedValue(
      new Error("Media upload was cancelled"),
    );
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
      // The backend emits the `cancelled` event before the send rejects.
      mediaUploads: {
        "upload-cancel": { state: "cancelled", progress: 0.4, error: null },
      },
    });
    const files = [new File(["a"], "photo.png", { type: "image/png" })];

    await expect(
      useChatStore.getState().sendMedia(files, "", "upload-cancel"),
    ).rejects.toThrow("Media upload was cancelled");

    expect(useChatStore.getState().messages).toEqual([message("m1", "a")]);
    expect(useChatStore.getState().syncError).toBeNull();
  });

  it("sendMedia() refuses to send while an edit is pending", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });
    useChatStore.getState().startEdit(message("m1", "a"));

    await expect(
      useChatStore
        .getState()
        .sendMedia(
          [new File(["a"], "photo.png", { type: "image/png" })],
          "",
          "upload-4",
        ),
    ).rejects.toThrow(copy.attachmentsInEdit);

    expect(telo.workspace.sendMedia).not.toHaveBeenCalled();
    expect(useChatStore.getState().composerTarget?.mode).toBe("edit");
  });

  it("cancelMediaUpload() delegates the cancellation to the preload API", async () => {
    const telo = installTeloApiMock();

    await useChatStore.getState().cancelMediaUpload("upload-5");

    expect(telo.workspace.cancelMediaUpload).toHaveBeenCalledWith("upload-5");
  });

  it("receive() tracks media-upload progress by upload id", () => {
    useChatStore.getState().receive({
      type: "media-upload",
      uploadId: "upload-6",
      state: "uploading",
      progress: 0.4,
      error: null,
    });
    useChatStore.getState().receive({
      type: "media-upload",
      uploadId: "upload-6",
      state: "failed",
      progress: 0.4,
      error: "Connection lost",
    });

    expect(useChatStore.getState().mediaUploads["upload-6"]).toEqual({
      state: "failed",
      progress: 0.4,
      error: "Connection lost",
    });
  });

  it("sendMedia() surfaces the upload events the default mock emits", async () => {
    installTeloApiMock();
    const unsubscribe = subscribeToWorkspaceEvents();
    useChatStore.setState({ activeChatId: "a", messages: [] });

    await useChatStore
      .getState()
      .sendMedia(
        [new File(["a"], "photo.png", { type: "image/png" })],
        "",
        "upload-7",
      );

    expect(useChatStore.getState().mediaUploads["upload-7"]).toEqual({
      state: "ready",
      progress: 1,
      error: null,
    });
    unsubscribe();
  });
});

describe("folder views", () => {
  const chats = [
    { ...chat("main"), folderId: null },
    { ...chat("work"), folderId: 2 },
    { ...chat("archived"), folderId: ARCHIVE_FOLDER_ID, unreadCount: 2 },
    { ...chat("work-unread"), folderId: 2, unreadCount: 3 },
  ];

  it("All shows every chat that is not archived", () => {
    expect(chatsForFolder(chats, null).map((entry) => entry.id)).toEqual([
      "main",
      "work",
      "work-unread",
    ]);
  });

  it("a folder shows exactly its member chats", () => {
    expect(chatsForFolder(chats, 2).map((entry) => entry.id)).toEqual([
      "work",
      "work-unread",
    ]);
    expect(
      chatsForFolder(chats, ARCHIVE_FOLDER_ID).map((entry) => entry.id),
    ).toEqual(["archived"]);
  });

  it("a keyword folder shows chats by virtual membership, including archived", () => {
    const withKeyword = [
      { ...chat("main"), folderId: null },
      {
        ...chat("design"),
        folderId: 2,
        unreadCount: 3,
        keywordFolderIds: [-1],
      },
      {
        ...chat("archived"),
        folderId: ARCHIVE_FOLDER_ID,
        unreadCount: 2,
        keywordFolderIds: [-1],
      },
    ];
    expect(chatsForFolder(withKeyword, -1).map((entry) => entry.id)).toEqual([
      "design",
      "archived",
    ]);
  });

  it("collects a chat into a keyword folder when a matching body arrives", () => {
    useChatStore.setState({
      chats: [{ ...chat("design"), folderId: 2, unreadCount: 1 }],
      folders: [
        {
          id: -1,
          title: "Spacing",
          unreadCount: 0,
          kind: "keyword",
          query: "spacing",
        },
      ],
    });
    useChatStore.getState().receive({
      type: "message-upsert",
      cause: "new",
      message: {
        ...message("design-new", "design"),
        body: "The spacing pass landed.",
        outgoing: false,
      },
    });
    const state = useChatStore.getState();
    expect(state.chats[0]?.keywordFolderIds).toEqual([-1]);
    expect(state.folders[0]?.unreadCount).toBe(2);
  });

  it("sums the All badge over its visible chats only", () => {
    expect(allChatsUnread(chats)).toBe(3);
  });
});

describe("chat-store search", () => {
  const closedChatSearch = {
    open: false,
    query: "",
    matches: [],
    totalCount: 0,
    index: 0,
    cursor: null,
    loading: false,
  } as const;

  beforeEach(() => {
    vi.useFakeTimers();
    useChatStore.setState({
      chats: [],
      messages: [],
      activeChatId: null,
      syncError: null,
      searchQuery: "",
      globalSearchResults: null,
      globalSearching: false,
      jumpTarget: null,
      highlightedMessageId: null,
      chatSearch: closedChatSearch,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces the sidebar query into one server global search", async () => {
    const telo = installTeloApiMock();
    const results: GlobalSearchResultDto = {
      chats: [chat("a")],
      messages: [message("m1", "a")],
    };
    telo.workspace.searchGlobal.mockResolvedValue(results);

    useChatStore.getState().setSearchQuery("rep");
    useChatStore.getState().setSearchQuery("repo");
    expect(telo.workspace.searchGlobal).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);

    expect(telo.workspace.searchGlobal).toHaveBeenCalledTimes(1);
    expect(telo.workspace.searchGlobal).toHaveBeenCalledWith("repo");
    expect(useChatStore.getState().globalSearchResults).toEqual(results);
    expect(useChatStore.getState().globalSearching).toBe(false);
  });

  it("clears results without a server call and drops a stale response", async () => {
    const telo = installTeloApiMock();
    let resolveSearch!: (value: GlobalSearchResultDto) => void;
    telo.workspace.searchGlobal.mockImplementation(
      () =>
        new Promise<GlobalSearchResultDto>((resolve) => {
          resolveSearch = resolve;
        }),
    );

    useChatStore.getState().setSearchQuery("abc");
    await vi.advanceTimersByTimeAsync(300);
    useChatStore.getState().setSearchQuery("");
    resolveSearch({ chats: [chat("a")], messages: [] });
    await vi.advanceTimersByTimeAsync(0);

    const state = useChatStore.getState();
    expect(state.globalSearchResults).toBeNull();
    expect(state.globalSearching).toBe(false);
    expect(telo.workspace.searchGlobal).toHaveBeenCalledTimes(1);
  });

  it("stores in-chat matches newest first and jumps to the latest", async () => {
    const telo = installTeloApiMock();
    telo.workspace.searchMessages.mockResolvedValue({
      messageIds: ["m3", "m2"],
      totalCount: 2,
      nextCursor: "m2",
    });
    useChatStore.setState({ activeChatId: "a" });

    useChatStore.getState().openChatSearch();
    useChatStore.getState().setChatSearchQuery("rep");
    await vi.advanceTimersByTimeAsync(300);

    const state = useChatStore.getState();
    expect(state.chatSearch.matches).toEqual(["m3", "m2"]);
    expect(state.chatSearch.totalCount).toBe(2);
    expect(state.chatSearch.index).toBe(0);
    expect(state.chatSearch.cursor).toBe("m2");
    expect(state.jumpTarget).toMatchObject({ chatId: "a", messageId: "m3" });
    expect(telo.workspace.searchMessages).toHaveBeenCalledWith("a", "rep");
  });

  it("advances through matches and pages the server when they run out", async () => {
    const telo = installTeloApiMock();
    telo.workspace.searchMessages
      .mockResolvedValueOnce({
        messageIds: ["m3", "m2"],
        totalCount: 3,
        nextCursor: "m2",
      })
      .mockResolvedValueOnce({
        messageIds: ["m1"],
        totalCount: 3,
        nextCursor: null,
      });
    useChatStore.setState({ activeChatId: "a" });
    useChatStore.getState().openChatSearch();
    useChatStore.getState().setChatSearchQuery("rep");
    await vi.advanceTimersByTimeAsync(300);

    await useChatStore.getState().chatSearchOlder();
    expect(useChatStore.getState().chatSearch.index).toBe(1);
    expect(useChatStore.getState().jumpTarget).toMatchObject({
      messageId: "m2",
    });
    expect(telo.workspace.searchMessages).toHaveBeenCalledTimes(1);

    await useChatStore.getState().chatSearchOlder();
    expect(telo.workspace.searchMessages).toHaveBeenLastCalledWith("a", "rep", {
      beforeMessageId: "m2",
    });
    expect(useChatStore.getState().chatSearch.matches).toEqual([
      "m3",
      "m2",
      "m1",
    ]);
    expect(useChatStore.getState().chatSearch.index).toBe(2);
    expect(useChatStore.getState().jumpTarget).toMatchObject({
      messageId: "m1",
    });

    // No cursor left: the oldest match is the end.
    await useChatStore.getState().chatSearchOlder();
    expect(useChatStore.getState().chatSearch.index).toBe(2);

    useChatStore.getState().chatSearchNewer();
    expect(useChatStore.getState().chatSearch.index).toBe(1);
    useChatStore.getState().chatSearchNewer();
    useChatStore.getState().chatSearchNewer();
    expect(useChatStore.getState().chatSearch.index).toBe(0);
  });

  it("clears matches, query, and highlight when the search bar closes", async () => {
    const telo = installTeloApiMock();
    telo.workspace.searchMessages.mockResolvedValue({
      messageIds: ["m3"],
      totalCount: 1,
      nextCursor: null,
    });
    useChatStore.setState({
      activeChatId: "a",
      highlightedMessageId: "m3",
    });
    useChatStore.getState().openChatSearch();
    useChatStore.getState().setChatSearchQuery("rep");
    await vi.advanceTimersByTimeAsync(300);
    expect(useChatStore.getState().chatSearch.matches).toHaveLength(1);

    useChatStore.getState().closeChatSearch();

    const state = useChatStore.getState();
    expect(state.chatSearch).toEqual(closedChatSearch);
    expect(state.highlightedMessageId).toBeNull();
  });

  it("resets the in-chat search and highlight when the chat changes", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    useChatStore.setState({
      chats: [chat("a"), chat("b")],
      activeChatId: "a",
      highlightedMessageId: "m1",
      chatSearch: { ...closedChatSearch, open: true, matches: ["m1"] },
    });

    await useChatStore.getState().select("b");

    const state = useChatStore.getState();
    expect(state.chatSearch).toEqual(closedChatSearch);
    expect(state.highlightedMessageId).toBeNull();
    expect(state.jumpTarget).toBeNull();
  });

  it("selects the chat before targeting a global search jump", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    useChatStore.setState({
      chats: [chat("a"), chat("b")],
      activeChatId: "a",
    });

    await useChatStore.getState().requestJumpToMessage("b", "m9");

    const state = useChatStore.getState();
    expect(state.activeChatId).toBe("b");
    expect(state.jumpTarget).toMatchObject({ chatId: "b", messageId: "m9" });
    expect(telo.workspace.listMessagePage).toHaveBeenCalledWith("b");
  });

  it("patches presence from chat-presence events", () => {
    useChatStore.setState({ chats: [chat("a")] });

    useChatStore
      .getState()
      .receive({ type: "chat-presence", chatId: "a", online: true });
    expect(useChatStore.getState().chats[0]?.presence).toBe("online");

    useChatStore
      .getState()
      .receive({ type: "chat-presence", chatId: "a", online: false });
    expect(useChatStore.getState().chats[0]?.presence).toBeNull();
  });
});

describe("chat-store runMessageAction", () => {
  beforeEach(() => {
    useChatStore.setState({
      chats: [chat("a")],
      messages: [message("m1", "a")],
      activeChatId: "a",
      drafts: {},
      messageAction: null,
      messageActionError: null,
    });
  });

  function emitText(
    telo: ReturnType<typeof installTeloApiMock>,
    delta: string,
  ) {
    telo.emitAgentEvent({
      type: EventType.CUSTOM,
      name: MESSAGE_ACTION_EVENT_NAME,
      value: { type: "text", delta },
    } as AGUIEvent);
  }

  function emitDone(telo: ReturnType<typeof installTeloApiMock>) {
    telo.emitAgentEvent({
      type: EventType.CUSTOM,
      name: MESSAGE_ACTION_EVENT_NAME,
      value: { type: "done" },
    } as AGUIEvent);
  }

  it("streams the agent output into the active chat's draft", async () => {
    const telo = installTeloApiMock();
    telo.agent.run.mockImplementation(async () => {
      emitText(telo, "Demo translation: ");
      emitText(telo, "Message m1");
      emitDone(telo);
    });

    await useChatStore
      .getState()
      .runMessageAction(message("m1", "a"), "translate");

    expect(useChatStore.getState().drafts.a).toBe(
      "Demo translation: Message m1",
    );
    expect(useChatStore.getState().messageAction).toBeNull();
    expect(telo.agent.run).toHaveBeenCalledTimes(1);
    expect(telo.agent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: MESSAGE_ACTION_THREAD_ID,
        prompt: "Message m1",
        action: { kind: "translate" },
      }),
    );
  });

  it("replaces an existing draft for translate and rewrite", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({ drafts: { a: "typed earlier" } });
    telo.agent.run.mockImplementation(async () => {
      emitText(telo, "Demo rewrite: Message m1");
      emitDone(telo);
    });

    await useChatStore
      .getState()
      .runMessageAction(message("m1", "a"), "rewrite");

    expect(useChatStore.getState().drafts.a).toBe("Demo rewrite: Message m1");
  });

  it("appends a draft reply below the text the user already typed", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({ drafts: { a: "typed earlier" } });
    telo.agent.run.mockImplementation(async () => {
      emitText(telo, "Demo friendly reply: Message m1");
      emitDone(telo);
    });

    await useChatStore
      .getState()
      .runMessageAction(message("m1", "a"), "draft-reply", "friendly");

    expect(useChatStore.getState().drafts.a).toBe(
      "typed earlier\nDemo friendly reply: Message m1",
    );
    expect(telo.agent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        action: { kind: "draft-reply", tone: "friendly" },
      }),
    );
  });

  it("ignores a second invocation while an action streams", async () => {
    const telo = installTeloApiMock();
    let finish!: () => void;
    telo.agent.run.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    const first = useChatStore
      .getState()
      .runMessageAction(message("m1", "a"), "translate");
    await useChatStore
      .getState()
      .runMessageAction(message("m1", "a"), "rewrite");
    emitDone(telo);
    finish();
    await first;

    expect(telo.agent.run).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().messageAction).toBeNull();
  });

  it("surfaces a gateway error inline and keeps the streamed text", async () => {
    const telo = installTeloApiMock();
    telo.agent.run.mockImplementation(async () => {
      emitText(telo, "partial");
      telo.emitAgentEvent({
        type: EventType.CUSTOM,
        name: MESSAGE_ACTION_EVENT_NAME,
        value: { type: "error", message: "The agent request failed." },
      } as AGUIEvent);
      emitDone(telo);
    });

    await useChatStore
      .getState()
      .runMessageAction(message("m1", "a"), "translate");

    expect(useChatStore.getState().messageActionError).toBe(
      "The agent request failed.",
    );
    expect(useChatStore.getState().drafts.a).toBe("partial");
    expect(useChatStore.getState().messageAction).toBeNull();
  });

  it("surfaces a rejected run inline instead of swallowing it", async () => {
    const telo = installTeloApiMock();
    telo.agent.run.mockRejectedValue(new Error("ipc down"));

    await useChatStore
      .getState()
      .runMessageAction(message("m1", "a"), "translate");

    expect(useChatStore.getState().messageActionError).toBe("ipc down");
    expect(useChatStore.getState().messageAction).toBeNull();
  });

  it("ignores panel transcript events while streaming", async () => {
    const telo = installTeloApiMock();
    telo.agent.run.mockImplementation(async () => {
      telo.emitAgentEvent({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "panel-message",
        delta: "panel text",
      } as AGUIEvent);
      telo.emitAgentEvent({
        type: EventType.CUSTOM,
        name: "activity",
        value: { type: "activity", label: "Reading workspace" },
      } as AGUIEvent);
      emitDone(telo);
    });

    await useChatStore
      .getState()
      .runMessageAction(message("m1", "a"), "translate");

    expect(useChatStore.getState().drafts.a).toBeUndefined();
  });
});
