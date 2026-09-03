import { describe, expect, it } from "vitest";

import { parseReply } from "./reply-segments";

describe("parseReply", () => {
  it("returns a single text segment when nothing is referenced", () => {
    expect(parseReply("Plain answer.")).toEqual({
      segments: [{ kind: "text", text: "Plain answer." }],
      text: "Plain answer.",
      citations: [],
    });
  });

  it("numbers in-app links in order of first appearance and dedupes them", () => {
    const body =
      "Ship it. telo://message/design/design-4 Then wait. telo://message/design/design-5 Again telo://message/design/design-4";

    const parsed = parseReply(body);

    expect(parsed.citations).toEqual([
      { chatId: "design", messageId: "design-4" },
      { chatId: "design", messageId: "design-5" },
    ]);
    expect(parsed.segments).toEqual([
      { kind: "text", text: "Ship it." },
      { kind: "citation", chatId: "design", messageId: "design-4", index: 1 },
      { kind: "text", text: " Then wait." },
      { kind: "citation", chatId: "design", messageId: "design-5", index: 2 },
      { kind: "text", text: " Again" },
      { kind: "citation", chatId: "design", messageId: "design-4", index: 1 },
    ]);
    expect(parsed.text).toBe("Ship it. Then wait. Again");
  });

  it("pulls a link that sits on its own line up to the sentence it cites", () => {
    const parsed = parseReply(
      "Demo summary.\ntelo://message/design/design-4\nNext point.",
    );

    expect(parsed.segments).toEqual([
      { kind: "text", text: "Demo summary." },
      { kind: "citation", chatId: "design", messageId: "design-4", index: 1 },
      { kind: "text", text: "\nNext point." },
    ]);
  });

  it("leaves sentence punctuation and wrappers outside the link", () => {
    const parsed = parseReply(
      "A (telo://message/c/1). B [1](telo://message/c/2), C <telo://message/c/3>.",
    );

    expect(parsed.citations.map((citation) => citation.messageId)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(parsed.text).toBe("A (). B, C.");
  });

  it("ignores links that are not in-app message links", () => {
    const parsed = parseReply("See https://example.com and telo://unknown/x.");

    expect(parsed.citations).toEqual([]);
    expect(parsed.text).toBe("See https://example.com and telo://unknown/x.");
  });

  it("drops legacy citation markers", () => {
    expect(parseReply("Ship it [[telo-cite:m-2]] tomorrow.").text).toBe(
      "Ship it  tomorrow.",
    );
  });

  it("turns @Name into a mention only for known names, longest match first", () => {
    const parsed = parseReply(
      "@Lev Kim agreed with @lev, but @Nobody and mail@Lev did not.",
      ["Lev", "Lev Kim"],
    );

    expect(parsed.segments).toEqual([
      { kind: "mention", name: "Lev Kim" },
      { kind: "text", text: " agreed with " },
      { kind: "mention", name: "Lev" },
      { kind: "text", text: ", but @Nobody and mail@Lev did not." },
    ]);
    expect(parsed.text).toBe(
      "@Lev Kim agreed with @Lev, but @Nobody and mail@Lev did not.",
    );
  });

  it("combines mentions and citations", () => {
    const parsed = parseReply(
      "- @Priya weighed in. telo://message/design/design-5",
      ["Priya"],
    );

    expect(parsed.segments).toEqual([
      { kind: "text", text: "- " },
      { kind: "mention", name: "Priya" },
      { kind: "text", text: " weighed in." },
      { kind: "citation", chatId: "design", messageId: "design-5", index: 1 },
    ]);
  });
});
