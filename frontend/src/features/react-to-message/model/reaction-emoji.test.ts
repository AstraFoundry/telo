import { describe, expect, it } from "vitest";

import { reactionEmojiForDisplay } from "./reaction-emoji";

describe("reactionEmojiForDisplay", () => {
  it("gives the heart emoji presentation so it is not a black dingbat", () => {
    expect(reactionEmojiForDisplay("❤")).toBe("❤️");
    expect(reactionEmojiForDisplay("❤️")).toBe("❤️");
  });

  it("leaves emoji-presentation glyphs alone", () => {
    expect(reactionEmojiForDisplay("👍")).toBe("👍");
    expect(reactionEmojiForDisplay("🔥")).toBe("🔥");
  });

  it("restores VS16 inside a stripped heart ZWJ sequence", () => {
    expect(reactionEmojiForDisplay("❤‍🔥")).toBe("❤️‍🔥");
  });
});
