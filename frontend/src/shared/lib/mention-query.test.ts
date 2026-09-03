import { describe, expect, it } from "vitest";

import { filterMentionItems, mentionQueryAtCaret } from "./mention-query";

describe("mentionQueryAtCaret", () => {
  it("matches an in-progress username after @", () => {
    expect(mentionQueryAtCaret("hi @min", 7)).toEqual({
      start: 3,
      query: "min",
    });
  });

  it("matches a bare @ at the start of the draft", () => {
    expect(mentionQueryAtCaret("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("ignores a completed mention followed by a space", () => {
    expect(mentionQueryAtCaret("@mina hello", 11)).toBeNull();
  });

  it("ignores an @ in the middle of a token", () => {
    expect(mentionQueryAtCaret("mail@min", 8)).toBeNull();
  });

  it("spans words when display names are allowed", () => {
    const options = { allowSpaces: true };
    expect(mentionQueryAtCaret("ask @Lev Ki", 11, options)).toEqual({
      start: 4,
      query: "Lev Ki",
    });
    expect(mentionQueryAtCaret("ask @Lev ", 9, options)).toEqual({
      start: 4,
      query: "Lev ",
    });
    expect(mentionQueryAtCaret("ask @Lev  Kim", 13, options)).toBeNull();
  });
});

describe("filterMentionItems", () => {
  const items = [
    { id: "1", label: "Mina", description: "@mina", avatarUrl: null },
    { id: "2", label: "Aron Lee", description: null, avatarUrl: null },
  ];

  it("matches a handle by prefix with or without the @", () => {
    expect(filterMentionItems(items, "mi")).toEqual([items[0]]);
    expect(filterMentionItems(items, "@mi")).toEqual([items[0]]);
  });

  it("matches anywhere in the label, case-insensitively", () => {
    expect(filterMentionItems(items, "lee")).toEqual([items[1]]);
  });

  it("keeps everything for an empty query", () => {
    expect(filterMentionItems(items, "")).toEqual(items);
  });
});
