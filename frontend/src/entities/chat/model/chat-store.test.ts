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
      composerTarget: null,
    });
  });

  it("load() selects the first chat and loads its messages by default", async () => {
    const telo = installTeloApiMock();
    const chats = [chat("a"), chat("b")];
    const messages = [message("m1", "a")];
    telo.workspace.listChats.mockResolvedValue(chats);
    telo.workspace.listMessages.mockResolvedValue(messages);

    await useChatStore.getState().load();

    const state = useChatStore.getState();
    expect(state.chats).toEqual(chats);
    expect(state.activeChatId).toBe("a");
    expect(state.messages).toEqual(messages);
    expect(state.loading).toBe(false);
    expect(telo.workspace.listMessages).toHaveBeenCalledWith("a");
  });

  it("load() leaves no active chat and skips messages when the list is empty", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listChats.mockResolvedValue([]);

    await useChatStore.getState().load();

    const state = useChatStore.getState();
    expect(state.activeChatId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.loading).toBe(false);
    expect(telo.workspace.listMessages).not.toHaveBeenCalled();
  });

  it("select() returns early when the chat is already active", async () => {
    const telo = installTeloApiMock();
    useChatStore.setState({ activeChatId: "a", loading: false });

    await useChatStore.getState().select("a");

    expect(telo.workspace.listMessages).not.toHaveBeenCalled();
    expect(useChatStore.getState().loading).toBe(false);
  });

  it("select() switches the active chat and loads its messages", async () => {
    const telo = installTeloApiMock();
    const messages = [message("m2", "b")];
    telo.workspace.listMessages.mockResolvedValue(messages);
    useChatStore.setState({ activeChatId: "a", loading: false });

    await useChatStore.getState().select("b");

    const state = useChatStore.getState();
    expect(state.activeChatId).toBe("b");
    expect(state.messages).toEqual(messages);
    expect(state.loading).toBe(false);
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

    expect(telo.workspace.sendMessage).toHaveBeenCalledWith("a", "hello");
    expect(useChatStore.getState().messages).toEqual([
      message("m1", "a"),
      sent,
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
    telo.workspace.listMessages.mockResolvedValue([]);
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
    telo.workspace.listChats.mockResolvedValue(chats);
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
    expect(telo.workspace.listMessages).not.toHaveBeenCalled();
  });

  it("forwardMessage() reloads messages when forwarding into the active chat", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listChats.mockResolvedValue([chat("a")]);
    const messages = [message("m1", "a"), message("m2", "a")];
    telo.workspace.listMessages.mockResolvedValue(messages);
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });

    await useChatStore.getState().forwardMessage("m1", "a");

    expect(telo.workspace.listMessages).toHaveBeenCalledWith("a");
    expect(useChatStore.getState().messages).toEqual(messages);
  });
});
