import { describe, expect, it } from "vitest";

import { isolatedEmojiCount } from "./isolated-emoji";

describe("isolatedEmojiCount", () => {
  it("counts a run of plain emoji", () => {
    expect(isolatedEmojiCount("👍")).toBe(1);
    expect(isolatedEmojiCount("👍😀")).toBe(2);
    expect(isolatedEmojiCount("👍😀🎉")).toBe(3);
  });

  it("counts a grapheme cluster as one emoji", () => {
    // Skin tone, flag, ZWJ family and keycap are each one emoji to a reader;
    // counting code points would push every one of them past the limit.
    expect(isolatedEmojiCount("👍🏽")).toBe(1);
    expect(isolatedEmojiCount("🇬🇧")).toBe(1);
    expect(isolatedEmojiCount("👨‍👩‍👧‍👦")).toBe(1);
    expect(isolatedEmojiCount("❤️‍🔥")).toBe(1);
    expect(isolatedEmojiCount("1️⃣")).toBe(1);
  });

  it("answers zero past Telegram's three-emoji cap", () => {
    expect(isolatedEmojiCount("👍😀🎉🔥")).toBe(0);
  });

  it("answers zero for text that is not only emoji", () => {
    expect(isolatedEmojiCount("👍!")).toBe(0);
    expect(isolatedEmojiCount("ok 👍")).toBe(0);
    expect(isolatedEmojiCount("👍 👍")).toBe(0);
    expect(isolatedEmojiCount("hello")).toBe(0);
    expect(isolatedEmojiCount("")).toBe(0);
  });

  it("answers zero for the digits and hashes keycaps are built from", () => {
    // These carry the combining keycap mark in a real keycap emoji; alone
    // they are ordinary characters and must not enlarge the message.
    expect(isolatedEmojiCount("1")).toBe(0);
    expect(isolatedEmojiCount("#")).toBe(0);
    expect(isolatedEmojiCount("123")).toBe(0);
  });
});
