import { Api } from "teleproto";
import { describe, expect, it } from "vitest";

import {
  mapMessageEntities,
  mapMessageEntitiesForSend,
} from "./teleproto-message-entities";

describe("mapMessageEntities", () => {
  it("maps every metadata-free Telegram entity kind", () => {
    const constructors = [
      [Api.MessageEntityMention, "mention"],
      [Api.MessageEntityHashtag, "hashtag"],
      [Api.MessageEntityBotCommand, "bot-command"],
      [Api.MessageEntityUrl, "url"],
      [Api.MessageEntityEmail, "email"],
      [Api.MessageEntityBold, "bold"],
      [Api.MessageEntityItalic, "italic"],
      [Api.MessageEntityCode, "code"],
      [Api.MessageEntityPhone, "phone"],
      [Api.MessageEntityCashtag, "cashtag"],
      [Api.MessageEntityUnderline, "underline"],
      [Api.MessageEntityStrike, "strikethrough"],
      [Api.MessageEntityBankCard, "bank-card"],
      [Api.MessageEntitySpoiler, "spoiler"],
      [Api.MessageEntityDiffInsert, "diff-insert"],
      [Api.MessageEntityDiffDelete, "diff-delete"],
    ] as const;

    for (const [Entity, type] of constructors) {
      expect(
        mapMessageEntities("text", [new Entity({ offset: 0, length: 4 })]),
      ).toEqual([{ type, offset: 0, length: 4 }]);
    }
  });

  it("preserves entity-specific metadata", () => {
    expect(
      mapMessageEntities("abcdefg", [
        new Api.MessageEntityPre({ offset: 0, length: 1, language: "ts" }),
        new Api.MessageEntityTextUrl({
          offset: 1,
          length: 1,
          url: "https://example.com",
        }),
        new Api.MessageEntityMentionName({
          offset: 2,
          length: 1,
          userId: 42n as never,
        }),
        new Api.MessageEntityCustomEmoji({
          offset: 3,
          length: 1,
          documentId: 99n as never,
        }),
        new Api.MessageEntityBlockquote({
          offset: 4,
          length: 1,
          collapsed: true,
        }),
        new Api.MessageEntityFormattedDate({
          offset: 5,
          length: 1,
          date: 1,
          relative: true,
        }),
        new Api.MessageEntityDiffReplace({
          offset: 6,
          length: 1,
          oldText: "before",
        }),
      ]),
    ).toEqual([
      { type: "pre", offset: 0, length: 1, language: "ts" },
      {
        type: "text-link",
        offset: 1,
        length: 1,
        url: "https://example.com",
      },
      { type: "text-mention", offset: 2, length: 1, userId: "42" },
      { type: "custom-emoji", offset: 3, length: 1, documentId: "99" },
      { type: "blockquote", offset: 4, length: 1, collapsed: true },
      {
        type: "formatted-date",
        offset: 5,
        length: 1,
        date: "1970-01-01T00:00:01.000Z",
        relative: true,
        shortTime: false,
        longTime: false,
        shortDate: false,
        longDate: false,
        dayOfWeek: false,
      },
      {
        type: "diff-replace",
        offset: 6,
        length: 1,
        oldText: "before",
      },
    ]);
  });

  it("drops unknown and malformed ranges without changing the body", () => {
    expect(
      mapMessageEntities("text", [
        new Api.MessageEntityUnknown({ offset: 0, length: 4 }),
        new Api.MessageEntityBold({ offset: -1, length: 2 }),
        new Api.MessageEntityItalic({ offset: 3, length: 2 }),
        new Api.MessageEntityCode({ offset: 0, length: 0 }),
      ]),
    ).toEqual([]);
  });
});

describe("mapMessageEntitiesForSend", () => {
  it("maps composer formatting and mention spans onto Teleproto entities", () => {
    const mapped = mapMessageEntitiesForSend("hi @mina", [
      { type: "bold", offset: 0, length: 2 },
      { type: "mention", offset: 3, length: 5 },
    ]);
    expect(mapped).toHaveLength(2);
    expect(mapped?.[0]).toBeInstanceOf(Api.MessageEntityBold);
    expect(mapped?.[0]).toMatchObject({ offset: 0, length: 2 });
    expect(mapped?.[1]).toBeInstanceOf(Api.MessageEntityMention);
    expect(mapped?.[1]).toMatchObject({ offset: 3, length: 5 });
  });

  it("drops out-of-range and receive-only kinds instead of sending them", () => {
    expect(
      mapMessageEntitiesForSend("hello", [
        { type: "bold", offset: 0, length: 9 },
        { type: "url", offset: 0, length: 5 },
      ]),
    ).toBeUndefined();
  });

  it("returns undefined when there is nothing to send", () => {
    expect(mapMessageEntitiesForSend("hello", [])).toBeUndefined();
    expect(mapMessageEntitiesForSend("hello", undefined)).toBeUndefined();
  });
});
