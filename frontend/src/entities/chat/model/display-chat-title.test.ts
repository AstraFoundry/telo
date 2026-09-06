import { describe, expect, it } from "vitest";

import type { ChatDto } from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";

import { chatsForPicker, displayChatTitle } from "./display-chat-title";

function chat(
  partial: Partial<ChatDto> & Pick<ChatDto, "id" | "title">,
): ChatDto {
  return {
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
    ...partial,
  };
}

describe("displayChatTitle", () => {
  it("replaces the TDLib self-chat title with Saved Messages", () => {
    expect(displayChatTitle({ kind: "saved", title: "Rafa K93" })).toBe(
      copy.savedMessages,
    );
  });

  it("keeps every other chat title", () => {
    expect(displayChatTitle({ kind: "direct", title: "Ada" })).toBe("Ada");
    expect(displayChatTitle({ kind: "channel", title: "Hacker News" })).toBe(
      "Hacker News",
    );
  });
});

describe("chatsForPicker", () => {
  it("pins Saved Messages first and matches the product title", () => {
    const saved = chat({
      id: "1",
      title: "Rafa K93",
      kind: "saved",
    });
    const notes = chat({ id: "2", title: "Product Notes" });
    expect(chatsForPicker([notes, saved], "").map((entry) => entry.id)).toEqual(
      ["1", "2"],
    );
    expect(
      chatsForPicker([notes, saved], "saved").map((entry) => entry.id),
    ).toEqual(["1"]);
  });
});
