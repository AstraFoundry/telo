import { describe, expect, it } from "vitest";

import { deliveryGlyphKind } from "./delivery-status";

describe("deliveryGlyphKind", () => {
  it("gives every delivery state its own glyph", () => {
    expect(deliveryGlyphKind("sending")).toBe("clock");
    expect(deliveryGlyphKind("sent")).toBe("check");
    expect(deliveryGlyphKind("read")).toBe("double-check");
    expect(deliveryGlyphKind("failed")).toBe("error");
  });

  it("never draws the read glyph for a message that was only sent", () => {
    expect(deliveryGlyphKind("sent")).not.toBe(deliveryGlyphKind("read"));
  });
});
