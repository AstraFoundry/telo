import { describe, expect, it } from "vitest";

import {
  diffEdit,
  insertAt,
  selectionHasFormat,
  shiftEntities,
  toggleFormat,
  trimOutgoingMessage,
} from "./composer-entities";

describe("diffEdit", () => {
  it("locates an insertion in the middle of a UTF-16 string", () => {
    expect(diffEdit("hello", "heXXllo")).toEqual({
      start: 2,
      end: 2,
      inserted: "XX",
    });
  });

  it("locates a replacement after an astral emoji", () => {
    expect(diffEdit("🙂 hi", "🙂 bye")).toEqual({
      start: 3,
      end: 5,
      inserted: "bye",
    });
  });
});

describe("shiftEntities", () => {
  it("slides spans after the replacement and grows a containing span", () => {
    const entities = [
      { type: "bold" as const, offset: 0, length: 5 },
      { type: "italic" as const, offset: 6, length: 4 },
    ];
    expect(shiftEntities(entities, 2, 2, 2)).toEqual([
      { type: "bold", offset: 0, length: 7 },
      { type: "italic", offset: 8, length: 4 },
    ]);
  });

  it("drops partial overlaps instead of splitting them", () => {
    expect(
      shiftEntities([{ type: "bold", offset: 2, length: 4 }], 3, 8, 1),
    ).toEqual([]);
  });
});

describe("insertAt", () => {
  it("inserts text at the caret and attaches extra spans relative to it", () => {
    expect(
      insertAt("hi ", [], 3, 3, "@mina ", [
        { type: "mention", offset: 0, length: 5 },
      ]),
    ).toEqual({
      body: "hi @mina ",
      entities: [{ type: "mention", offset: 3, length: 5 }],
    });
  });
});

describe("toggleFormat", () => {
  it("adds a span over the selection", () => {
    expect(toggleFormat([], "bold", 0, 5)).toEqual([
      { type: "bold", offset: 0, length: 5 },
    ]);
  });

  it("punches a hole when the selection is already bold", () => {
    expect(
      toggleFormat([{ type: "bold", offset: 0, length: 9 }], "bold", 2, 3),
    ).toEqual([
      { type: "bold", offset: 0, length: 2 },
      { type: "bold", offset: 5, length: 4 },
    ]);
  });

  it("removes a span that exactly matches the selection", () => {
    expect(
      toggleFormat([{ type: "italic", offset: 2, length: 3 }], "italic", 2, 3),
    ).toEqual([]);
  });

  it("nests italic inside bold without dropping either", () => {
    expect(
      toggleFormat([{ type: "bold", offset: 0, length: 5 }], "italic", 1, 3),
    ).toEqual([
      { type: "bold", offset: 0, length: 5 },
      { type: "italic", offset: 1, length: 3 },
    ]);
  });
});

describe("selectionHasFormat", () => {
  it("is true only when a span fully covers a non-empty selection", () => {
    const entities = [{ type: "bold" as const, offset: 0, length: 5 }];
    expect(selectionHasFormat(entities, "bold", 1, 3)).toBe(true);
    expect(selectionHasFormat(entities, "bold", 0, 0)).toBe(false);
    expect(selectionHasFormat(entities, "italic", 1, 3)).toBe(false);
  });
});

describe("trimOutgoingMessage", () => {
  it("shifts UTF-16 ranges after dropping surrounding whitespace", () => {
    expect(
      trimOutgoingMessage("  hello  ", [
        { type: "bold", offset: 2, length: 5 },
      ]),
    ).toEqual({
      body: "hello",
      entities: [{ type: "bold", offset: 0, length: 5 }],
    });
  });
});
