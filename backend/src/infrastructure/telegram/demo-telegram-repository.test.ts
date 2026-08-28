import { describe, expect, it } from "vitest";

import { DemoTelegramRepository } from "./demo-telegram-repository";

describe("DemoTelegramRepository", () => {
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
    const chats = await new DemoTelegramRepository().listChats();
    expect(chats).toHaveLength(3);
    expect(chats[0]?.pinned).toBe(true);
  });

  it("returns a snapshot that does not leak internal chat state", async () => {
    const repository = new DemoTelegramRepository();
    const chats = await repository.listChats();
    await repository.setChatPinned("saved", false);
    expect(chats[0]?.pinned).toBe(true);
  });

  it("adds a sent message to the selected conversation", async () => {
    const repository = new DemoTelegramRepository();
    const sent = await repository.sendMessage("design", "Hello");
    const messages = await repository.listMessages("design");
    expect(sent).toMatchObject({
      body: "Hello",
      outgoing: true,
      status: "sent",
    });
    expect(messages.at(-1)).toEqual(sent);
  });

  it("pins and unpins a chat persistently", async () => {
    const repository = new DemoTelegramRepository();
    await repository.setChatPinned("product", true);
    let chats = await repository.listChats();
    expect(chats.find((chat) => chat.id === "product")?.pinned).toBe(true);

    await repository.setChatPinned("product", false);
    chats = await repository.listChats();
    expect(chats.find((chat) => chat.id === "product")?.pinned).toBe(false);
  });

  it("mutes and unmutes a chat persistently", async () => {
    const repository = new DemoTelegramRepository();
    await repository.setChatMuted("design", true);
    let chats = await repository.listChats();
    expect(chats.find((chat) => chat.id === "design")?.muted).toBe(true);

    await repository.setChatMuted("design", false);
    chats = await repository.listChats();
    expect(chats.find((chat) => chat.id === "design")?.muted).toBe(false);
  });

  it("clears the unread counter when a chat is marked read", async () => {
    const repository = new DemoTelegramRepository();
    await repository.setChatRead("design", true);
    const chats = await repository.listChats();
    expect(chats.find((chat) => chat.id === "design")?.unreadCount).toBe(0);
  });

  it("flags a chat with one unread when it is marked unread", async () => {
    const repository = new DemoTelegramRepository();
    await repository.setChatRead("saved", false);
    const chats = await repository.listChats();
    expect(chats.find((chat) => chat.id === "saved")?.unreadCount).toBe(1);
  });

  it.each(["setChatPinned", "setChatMuted", "setChatRead"] as const)(
    "rejects %s for an unknown chat",
    async (method) => {
      const repository = new DemoTelegramRepository();
      await expect(repository[method]("missing", true)).rejects.toThrow(
        "Unknown chat missing",
      );
    },
  );

  it("attaches a reply snapshot when sending with a reply target", async () => {
    const repository = new DemoTelegramRepository();
    const sent = await repository.sendMessage("design", "On it", "design-1");
    expect(sent.replyTo).toEqual({
      id: "design-1",
      senderName: "Mina",
      body: "The conversation list should stay compact at desktop widths.",
    });
    const messages = await repository.listMessages("design");
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
    const messages = await repository.listMessages("design");
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
    const messages = await repository.listMessages("design");
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
    const messages = await repository.listMessages("design");
    expect(messages.map((message) => message.id)).toEqual(["design-2"]);
  });

  it.each([
    [{ chatId: "missing", messageId: "design-1" }, "Unknown chat missing"],
    [{ chatId: "design", messageId: "missing" }, "Unknown message missing"],
  ])("rejects deleteMessage for unknown targets %j", async (input, error) => {
    const repository = new DemoTelegramRepository();
    await expect(repository.deleteMessage(input)).rejects.toThrow(error);
  });

  it("forwards a message as a new outgoing message without a reply snapshot", async () => {
    const repository = new DemoTelegramRepository();
    await repository.forwardMessage({
      fromChatId: "design",
      messageId: "design-1",
      toChatId: "saved",
    });

    const target = await repository.listMessages("saved");
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
    const source = await repository.listMessages("design");
    expect(source).toHaveLength(2);
  });

  it("refreshes the target chat preview without touching unread count", async () => {
    const repository = new DemoTelegramRepository();
    await repository.forwardMessage({
      fromChatId: "saved",
      messageId: "saved-1",
      toChatId: "design",
    });
    const chats = await repository.listChats();
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

  it("logout() is a no-op that keeps the demo workspace intact", async () => {
    const repository = new DemoTelegramRepository();

    await repository.logout();

    await expect(repository.listChats()).resolves.toHaveLength(3);
    await expect(repository.getCurrentUser()).resolves.toMatchObject({
      id: "demo-user",
    });
  });
});
