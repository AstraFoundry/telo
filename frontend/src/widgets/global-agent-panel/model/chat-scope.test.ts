import { describe, expect, it } from "vitest";

import type { ChatDto, MessageDto } from "../../../../../contracts/src/ipc";

import { collectChatScope } from "./chat-scope";

function chat(partial: Partial<ChatDto> & Pick<ChatDto, "id" | "title">) {
  return {
    preview: "",
    updatedAt: "2026-01-01T10:00:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "direct",
    initials: "AB",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    ...partial,
  } satisfies ChatDto;
}

function message(id: string, body = `Message ${id}`): MessageDto {
  return {
    id,
    chatId: "design",
    senderName: "Lev",
    body,
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-01-01T00:00:00.000Z",
    outgoing: false,
    status: "read",
  };
}

describe("collectChatScope", () => {
  it("returns null without an active chat", () => {
    expect(collectChatScope(null, [message("m1")])).toBeNull();
  });

  it("scopes to the messages after the read boundary", () => {
    const scope = collectChatScope(
      chat({ id: "design", title: "Telo Design", lastReadMessageId: "m2" }),
      [message("m1"), message("m2"), message("m3"), message("m4")],
    );

    expect(scope?.chatId).toBe("design");
    expect(scope?.chatTitle).toBe("Telo Design");
    expect(scope?.messages.map((entry) => entry.id)).toEqual(["m3", "m4"]);
  });

  it("falls back to the loaded page when the boundary is unknown", () => {
    const scope = collectChatScope(chat({ id: "design", title: "Telo" }), [
      message("m1"),
      message("m2"),
    ]);

    expect(scope?.messages.map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("treats every loaded message as unread when the boundary is above the page", () => {
    const scope = collectChatScope(
      chat({ id: "design", title: "Telo", lastReadMessageId: "m0" }),
      [message("m1"), message("m2")],
    );

    expect(scope?.messages.map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("drops media-only messages without text", () => {
    const scope = collectChatScope(chat({ id: "design", title: "Telo" }), [
      message("m1", "  "),
      message("m2"),
    ]);

    expect(scope?.messages.map((entry) => entry.id)).toEqual(["m2"]);
  });

  it("returns null when nothing unread has text", () => {
    expect(
      collectChatScope(
        chat({ id: "design", title: "Telo", lastReadMessageId: "m2" }),
        [message("m1"), message("m2")],
      ),
    ).toBeNull();
  });
});
