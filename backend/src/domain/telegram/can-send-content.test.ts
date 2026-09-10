import { describe, expect, it } from "vitest";

import { assertCanSendContent, canSendContent } from "./can-send-content";
import type { ChatDto } from "./chat";

function chat(flags: {
  canSendMessages?: boolean;
  canSendStickers?: boolean;
  canSendMedia?: boolean;
}): ChatDto {
  return {
    id: "1",
    title: "Design",
    preview: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "group",
    initials: "D",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    ...flags,
  };
}

describe("canSendContent", () => {
  it("treats omitted flags as writable (demo fixtures, older events)", () => {
    const target = chat({});
    expect(canSendContent(target, "text")).toBe(true);
    expect(canSendContent(target, "stickers")).toBe(true);
    expect(canSendContent(target, "media")).toBe(true);
    expect(canSendContent(target, "any")).toBe(true);
  });

  it("lets omitted sticker and media flags follow the text flag", () => {
    const target = chat({ canSendMessages: false });
    expect(canSendContent(target, "text")).toBe(false);
    expect(canSendContent(target, "stickers")).toBe(false);
    expect(canSendContent(target, "media")).toBe(false);
    expect(canSendContent(target, "any")).toBe(false);
  });

  it("evaluates explicit sticker and media flags independently of text", () => {
    const target = chat({
      canSendMessages: true,
      canSendStickers: false,
      canSendMedia: false,
    });
    expect(canSendContent(target, "text")).toBe(true);
    expect(canSendContent(target, "stickers")).toBe(false);
    expect(canSendContent(target, "media")).toBe(false);
    expect(canSendContent(target, "any")).toBe(true);
  });

  it("allows any when only media is permitted", () => {
    const target = chat({
      canSendMessages: false,
      canSendStickers: false,
      canSendMedia: true,
    });
    expect(canSendContent(target, "any")).toBe(true);
  });
});

describe("assertCanSendContent", () => {
  it("does not throw for a permitted kind", () => {
    expect(() => assertCanSendContent(chat({}), "text")).not.toThrow();
  });

  it("throws the write error for blocked text and any", () => {
    const target = chat({ canSendMessages: false });
    expect(() => assertCanSendContent(target, "text")).toThrow(
      "The current account can't write to this chat",
    );
    expect(() => assertCanSendContent(target, "any")).toThrow(
      "The current account can't write to this chat",
    );
  });

  it("throws the kind-specific error for blocked stickers and media", () => {
    const target = chat({
      canSendMessages: true,
      canSendStickers: false,
      canSendMedia: false,
    });
    expect(() => assertCanSendContent(target, "stickers")).toThrow(
      "The current account can't send stickers to this chat",
    );
    expect(() => assertCanSendContent(target, "media")).toThrow(
      "The current account can't send media to this chat",
    );
  });
});
