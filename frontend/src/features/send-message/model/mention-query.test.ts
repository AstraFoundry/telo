import { describe, expect, it } from "vitest";

import { filterMentionMembers, mentionInsert } from "./mention-query";

describe("filterMentionMembers", () => {
  const members = [
    { id: "1", displayName: "Mina", username: "mina", avatarDataUrl: null },
    { id: "2", displayName: "Aron", username: "aron", avatarDataUrl: "a.png" },
    { id: "3", displayName: "No Handle", username: null, avatarDataUrl: null },
  ];

  it("keeps username matches and drops accounts without a username", () => {
    expect(
      filterMentionMembers(members, "mi").map((item) => item.member),
    ).toEqual([members[0]]);
  });

  it("also matches display names and carries the photo into the row", () => {
    expect(filterMentionMembers(members, "aro")).toEqual([
      {
        id: "2",
        label: "Aron",
        description: "@aron",
        avatarUrl: "a.png",
        avatarPending: undefined,
        member: members[1],
      },
    ]);
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
