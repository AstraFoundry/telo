import { describe, expect, it } from "vitest";

import type { ChatDto, MessageDto } from "../../../../../contracts/src/ipc";
import { buildMentionTargets } from "./mention-targets";

function chat(overrides: Partial<ChatDto>): ChatDto {
  return {
    id: "design",
    title: "Telo Design",
    preview: "",
    updatedAt: "2026-08-27T14:00:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "group",
    initials: "TD",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    ...overrides,
  } as ChatDto;
}

function message(overrides: Partial<MessageDto>): MessageDto {
  return {
    id: "m-1",
    chatId: "design",
    senderName: "Lev",
    senderId: "peer-lev",
    senderAvatarUrl: null,
    body: "hi",
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-08-27T14:00:00.000Z",
    outgoing: false,
    status: "sent",
    ...overrides,
  } as MessageDto;
}

describe("buildMentionTargets", () => {
  it("collects members, message authors and chats, deduplicated by name", () => {
    const targets = buildMentionTargets({
      chats: [
        chat({ id: "design", title: "Telo Design", avatarDataUrl: "c.png" }),
      ],
      messages: [
        message({ senderName: "Lev", senderId: "peer-lev" }),
        message({ id: "m-2", senderName: "lev ", senderId: "peer-lev" }),
        message({ id: "m-3", senderName: "Priya", senderId: "peer-priya" }),
        message({
          id: "m-4",
          senderName: "Me",
          senderId: "me",
          outgoing: true,
        }),
        message({ id: "m-5", senderName: "Ghost", senderId: "" }),
      ],
      peerAvatars: {},
      members: [
        {
          id: "peer-lev",
          displayName: "Lev",
          username: "lev",
          avatarDataUrl: "lev.png",
        },
      ],
    });

    expect(targets).toEqual([
      {
        kind: "person",
        id: "peer-lev",
        name: "Lev",
        handle: "lev",
        avatarUrl: "lev.png",
        avatarPending: false,
      },
      {
        kind: "person",
        id: "peer-priya",
        name: "Priya",
        handle: null,
        avatarUrl: null,
        avatarPending: false,
      },
      {
        kind: "chat",
        id: "design",
        name: "Telo Design",
        handle: null,
        avatarUrl: "c.png",
        avatarPending: false,
      },
    ]);
  });

  it("prefers a settled peer photo over the snapshot on the message", () => {
    const [target] = buildMentionTargets({
      chats: [],
      messages: [message({ senderAvatarUrl: null, senderAvatarPending: true })],
      peerAvatars: { "peer-lev": "settled.png" },
      members: [],
    });

    expect(target).toMatchObject({
      avatarUrl: "settled.png",
      avatarPending: false,
    });
  });

  it("keeps the pending flag while a photo is still resolving", () => {
    const [target] = buildMentionTargets({
      chats: [],
      messages: [message({ senderAvatarPending: true })],
      peerAvatars: {},
      members: [],
    });

    expect(target).toMatchObject({ avatarUrl: null, avatarPending: true });
  });
});
