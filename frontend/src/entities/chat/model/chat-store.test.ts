import { beforeEach, describe, expect, it } from "vitest";

import type { ChatDto, MessageDto } from "../../../../../contracts/src/ipc";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

import { useChatStore } from "./chat-store";

function chat(id: string): ChatDto {
  return {
    id,
    title: `Chat ${id}`,
    preview: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unreadCount: 0,
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
    sentAt: "2026-01-01T00:00:00.000Z",
    outgoing: false,
    status: "read",
  };
}

describe("chat-store", () => {
  beforeEach(() => {
    useChatStore.setState({
      chats: [],
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

  it("send() removes the optimistic bubble and restores the draft on failure", async () => {
    const telo = installTeloApiMock();
    telo.workspace.sendMessage.mockRejectedValue(new Error("Network down"));
    useChatStore.setState({ activeChatId: "a", messages: [] });

    await expect(useChatStore.getState().send("hello")).rejects.toThrow(
      "Network down",
    );

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().drafts.a).toBe("hello");
    expect(useChatStore.getState().syncError).toBe("Network down");
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

    expect(useChatStore.getState().chats[1]?.unreadCount).toBe(1);
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("receive() patches typing state on the matching chat", () => {
    useChatStore.setState({ chats: [chat("a"), chat("b")] });

    useChatStore
      .getState()
      .receive({ type: "typing", chatId: "b", typing: true });

    expect(useChatStore.getState().chats[0]?.typing).toBe(false);
    expect(useChatStore.getState().chats[1]?.typing).toBe(true);
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
});
