import { describe, expect, it } from "vitest";

import {
  filterMentionMembers,
  mentionInsert,
  mentionQueryAtCaret,
} from "./mention-query";

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
});

describe("filterMentionMembers", () => {
  const members = [
    { id: "1", displayName: "Mina", username: "mina" },
    { id: "2", displayName: "Aron", username: "aron" },
    { id: "3", displayName: "No Handle", username: null },
  ];

  it("keeps username matches and drops accounts without a username", () => {
    expect(filterMentionMembers(members, "mi")).toEqual([members[0]]);
  });

  it("also matches display names", () => {
    expect(filterMentionMembers(members, "aro")).toEqual([members[1]]);
  });
});

describe("mentionInsert", () => {
  it("covers only the @username token, leaving the trailing space plain", () => {
    expect(mentionInsert("mina")).toEqual({
      text: "@mina ",
      entity: { type: "mention", offset: 0, length: 5 },
    });
  });
});
