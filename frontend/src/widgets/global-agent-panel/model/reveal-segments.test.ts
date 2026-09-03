import { describe, expect, it } from "vitest";

import type { ReplySegment } from "entities/agent";

import { revealSegments, withoutTrailingLink } from "./reveal-segments";

const segments: ReadonlyArray<ReplySegment> = [
  { kind: "text", text: "Hi " },
  { kind: "mention", name: "Lev" },
  { kind: "text", text: " shipped." },
  { kind: "citation", chatId: "c", messageId: "1", index: 1 },
  { kind: "text", text: " Next" },
];

describe("revealSegments", () => {
  it("cuts text mid-segment", () => {
    expect(revealSegments(segments, 2)).toEqual([{ kind: "text", text: "Hi" }]);
  });

  it("holds a mention back until its whole token is typed", () => {
    expect(revealSegments(segments, 5)).toEqual([
      { kind: "text", text: "Hi " },
    ]);
    expect(revealSegments(segments, 7)).toEqual([
      { kind: "text", text: "Hi " },
      { kind: "mention", name: "Lev" },
    ]);
  });

  it("shows a citation together with the end of its sentence", () => {
    expect(revealSegments(segments, 16)).toEqual([
      { kind: "text", text: "Hi " },
      { kind: "mention", name: "Lev" },
      { kind: "text", text: " shipped." },
      { kind: "citation", chatId: "c", messageId: "1", index: 1 },
    ]);
  });

  it("returns everything once the count covers the reply", () => {
    expect(revealSegments(segments, 99)).toEqual(segments);
  });
});

describe("withoutTrailingLink", () => {
  it("drops a link that is still arriving while streaming", () => {
    expect(withoutTrailingLink("Done. telo://message/c/12", true)).toBe(
      "Done.",
    );
  });

  it("keeps a closed link and settled text", () => {
    expect(withoutTrailingLink("Done. telo://message/c/12 Next", true)).toBe(
      "Done. telo://message/c/12 Next",
    );
    expect(withoutTrailingLink("Done. telo://message/c/12", false)).toBe(
      "Done. telo://message/c/12",
    );
  });
});
