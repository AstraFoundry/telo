import { describe, expect, it } from "vitest";

import type { ChatDto, MessageDto } from "../../../../../contracts/src/ipc";
import { toAttachedMessages } from "./attach-selected";

const chat: ChatDto = {
  id: "design",
  title: "Telo Design",
  preview: "",
  updatedAt: "2026-01-01T10:00:00.000Z",
  unreadCount: 0,
  lastReadMessageId: null,
  muted: false,
  pinned: false,
  kind: "group",
  initials: "TD",
  avatarDataUrl: null,
  draftPreview: null,
  typing: false,
};

function message(id: string, senderName: string, body: string): MessageDto {
  return {
    id,
    chatId: "design",
    senderName,
    senderId: `peer-${senderName}`,
    senderAvatarUrl: null,
    body,
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-01-01T00:00:00.000Z",
    outgoing: false,
    status: "read",
  };
}

describe("toAttachedMessages", () => {
  it("keeps transcript order regardless of selection order", () => {
    const messages = [
      message("m1", "Lev", "First"),
      message("m2", "Mina", "Second"),
      message("m3", "Lev", "Third"),
    ];

    expect(toAttachedMessages(chat, messages, ["m3", "m1"])).toEqual([
      {
        chatId: "design",
        chatTitle: "Telo Design",
        messageId: "m1",
        senderName: "Lev",
        body: "First",
      },
      {
        chatId: "design",
        chatTitle: "Telo Design",
        messageId: "m3",
        senderName: "Lev",
        body: "Third",
      },
    ]);
  });

  it("ignores ids that are not loaded", () => {
    expect(
      toAttachedMessages(chat, [message("m1", "Lev", "First")], ["m9"]),
    ).toEqual([]);
  });
});
