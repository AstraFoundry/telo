import { describe, expect, it } from "vitest";

import {
  KeywordFolder,
  KEYWORD_FOLDER_QUERY_MAX,
  KEYWORD_FOLDER_TITLE_MAX,
  messageBodyMatchesKeyword,
  nextKeywordFolderId,
} from "./keyword-folder";

describe("messageBodyMatchesKeyword", () => {
  it("matches a case-insensitive substring of the message body", () => {
    expect(messageBodyMatchesKeyword("Spacing rules", "spacing")).toBe(true);
    expect(messageBodyMatchesKeyword("SPACING rules", "Spacing")).toBe(true);
    expect(
      messageBodyMatchesKeyword("The spacing-craft write-up", "spacing"),
    ).toBe(true);
  });

  it("does not match titles or unrelated bodies", () => {
    expect(
      messageBodyMatchesKeyword("Ship both with the next build.", "venue"),
    ).toBe(false);
    expect(messageBodyMatchesKeyword("", "spacing")).toBe(false);
  });

  it("trims the query and rejects an empty term", () => {
    expect(messageBodyMatchesKeyword("spacing", "  spacing  ")).toBe(true);
    expect(messageBodyMatchesKeyword("spacing", "   ")).toBe(false);
  });
});

describe("KeywordFolder", () => {
  it("trims title and query", () => {
    const folder = KeywordFolder.create({
      id: -1,
      title: "  Spacing  ",
      query: "  spacing  ",
    });
    expect(folder.snapshot()).toEqual({
      id: -1,
      title: "Spacing",
      query: "spacing",
    });
  });

  it("rejects non-negative ids, empty fields, and oversized values", () => {
    expect(() =>
      KeywordFolder.create({ id: 1, title: "Work", query: "work" }),
    ).toThrow(/negative integer/);
    expect(() =>
      KeywordFolder.create({ id: -1, title: "  ", query: "work" }),
    ).toThrow(/title is required/);
    expect(() =>
      KeywordFolder.create({ id: -1, title: "Work", query: "  " }),
    ).toThrow(/query is required/);
    expect(() =>
      KeywordFolder.create({
        id: -1,
        title: "a".repeat(KEYWORD_FOLDER_TITLE_MAX + 1),
        query: "work",
      }),
    ).toThrow(/title must be at most/);
    expect(() =>
      KeywordFolder.create({
        id: -1,
        title: "Work",
        query: "a".repeat(KEYWORD_FOLDER_QUERY_MAX + 1),
      }),
    ).toThrow(/query must be at most/);
  });

  it("updates title and query without changing the id", () => {
    const folder = KeywordFolder.create({
      id: -2,
      title: "Spacing",
      query: "spacing",
    }).update({ title: "Retry", query: "retry" });
    expect(folder.snapshot()).toEqual({
      id: -2,
      title: "Retry",
      query: "retry",
    });
  });
});

describe("nextKeywordFolderId", () => {
  it("starts at -1 and decrements past the lowest existing id", () => {
    expect(nextKeywordFolderId([])).toBe(-1);
    expect(
      nextKeywordFolderId([
        KeywordFolder.create({ id: -1, title: "A", query: "a" }),
        KeywordFolder.create({ id: -3, title: "B", query: "b" }),
      ]),
    ).toBe(-4);
  });
});
