import { describe, expect, it } from "vitest";

import { trimOutgoingMessage } from "./outgoing-message";

describe("trimOutgoingMessage", () => {
  it("is a no-op when the body has no surrounding whitespace", () => {
    const entities = [{ type: "bold" as const, offset: 0, length: 5 }];
    expect(trimOutgoingMessage("hello", entities)).toEqual({
      body: "hello",
      entities,
    });
  });

  it("shifts UTF-16 ranges after dropping leading and trailing spaces", () => {
    expect(
      trimOutgoingMessage("  hello  ", [
        { type: "bold", offset: 2, length: 5 },
      ]),
    ).toEqual({
      body: "hello",
      entities: [{ type: "bold", offset: 0, length: 5 }],
    });
  });

  it("keeps a range that starts after an astral emoji using UTF-16 offsets", () => {
    // 🙂 is two UTF-16 code units, matching Telegram and JavaScript lengths.
    expect(
      trimOutgoingMessage("  🙂 bold  ", [
        { type: "bold", offset: 5, length: 4 },
      ]),
    ).toEqual({
      body: "🙂 bold",
      entities: [{ type: "bold", offset: 3, length: 4 }],
    });
  });

  it("drops spans that lived only in the trimmed edges", () => {
    expect(
      trimOutgoingMessage("  hello  ", [
        { type: "italic", offset: 0, length: 2 },
        { type: "bold", offset: 7, length: 2 },
      ]),
    ).toEqual({ body: "hello", entities: undefined });
  });
});
