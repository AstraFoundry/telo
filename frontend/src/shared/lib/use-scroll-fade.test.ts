import { describe, expect, it } from "vitest";

import { scrollFadeMask } from "./use-scroll-fade";

describe("scrollFadeMask", () => {
  it("renders no mask when nothing is clipped", () => {
    expect(scrollFadeMask("none")).toBeUndefined();
  });

  it("fades only the edge that hides content", () => {
    expect(scrollFadeMask("end", "horizontal", "1rem")).toBe(
      "linear-gradient(to right, black 0, black calc(100% - 1rem), transparent 100%)",
    );
    expect(scrollFadeMask("start", "horizontal", "1rem")).toBe(
      "linear-gradient(to right, transparent 0, black 1rem, black 100%)",
    );
  });

  it("fades both edges from the middle of the range", () => {
    expect(scrollFadeMask("both", "vertical", "8px")).toBe(
      "linear-gradient(to bottom, transparent 0, black 8px, black calc(100% - 8px), transparent 100%)",
    );
  });
});
