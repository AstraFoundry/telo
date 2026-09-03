import { describe, expect, it } from "vitest";

import { buildScopeInput } from "./scope-input";

const card = (messageId: string) => ({
  chatId: "design",
  chatTitle: "Telo Design",
  messageId,
  senderName: "Lev",
  body: "Ship it.",
});

describe("buildScopeInput", () => {
  it("sends attached messages as the selected scope of their chat", () => {
    expect(
      buildScopeInput({
        attachments: [card("m1"), card("m2")],
        activeChatId: "other",
        activeFolderId: null,
      }),
    ).toEqual({
      scope: "selected",
      chatId: "design",
      messageIds: ["m1", "m2"],
    });
  });

  it("reads the open chat's unread tail without cards", () => {
    expect(
      buildScopeInput({
        attachments: [],
        activeChatId: "design",
        activeFolderId: 2,
      }),
    ).toEqual({ scope: "unread", chatId: "design" });
  });

  it("widens to the active folder when no chat is open", () => {
    expect(
      buildScopeInput({
        attachments: [],
        activeChatId: null,
        activeFolderId: 2,
      }),
    ).toEqual({ scope: "folder", folderId: 2 });
    expect(
      buildScopeInput({
        attachments: [],
        activeChatId: null,
        activeFolderId: null,
      }),
    ).toEqual({ scope: "folder", folderId: null });
  });
});
