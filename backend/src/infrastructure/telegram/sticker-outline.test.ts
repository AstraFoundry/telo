import { describe, expect, it } from "vitest";

import { decodeStickerOutline, stickerOutlineOf } from "./sticker-outline";

describe("decodeStickerOutline", () => {
  it("frames the path with the move and close commands", () => {
    // 192 indexes the first lookup entry, "A".
    expect(decodeStickerOutline(Uint8Array.from([192, 10]))).toBe("MA10z");
  });

  it("reads bytes below 64 as bare coordinates", () => {
    expect(decodeStickerOutline(Uint8Array.from([0, 63]))).toBe("M063z");
  });

  it("takes bit 6 as a leading minus and bit 7 as a leading comma", () => {
    // 64 + 5 is "-5"; 128 + 7 is ",7". Both keep only the low six bits.
    expect(decodeStickerOutline(Uint8Array.from([69, 135]))).toBe("M-5,7z");
  });

  it("maps the whole lookup table, so no command decodes to an empty string", () => {
    const every = Uint8Array.from(
      Array.from({ length: 64 }, (_, index) => 192 + index),
    );
    const path = decodeStickerOutline(every);
    expect(path).not.toBeNull();
    // 64 command characters plus the framing "M" and "z".
    expect(path).toHaveLength(66);
  });

  it("answers null for missing or empty bytes rather than an empty path", () => {
    expect(decodeStickerOutline(null)).toBeNull();
    expect(decodeStickerOutline(undefined)).toBeNull();
    expect(decodeStickerOutline(new Uint8Array())).toBeNull();
  });
});

describe("stickerOutlineOf", () => {
  it("decodes the PhotoPathSize thumbnail", () => {
    expect(
      stickerOutlineOf({
        thumbs: [{ type: "j", bytes: Uint8Array.from([192, 10]) }],
      }),
    ).toBe("MA10z");
  });

  it("skips stripped JPEG thumbnails, which are not paths", () => {
    expect(
      stickerOutlineOf({
        thumbs: [
          { type: "i", bytes: Uint8Array.from([1, 2, 3]) },
          { type: "j", bytes: Uint8Array.from([192, 10]) },
        ],
      }),
    ).toBe("MA10z");
  });

  it("answers null for a document with no vector thumbnail", () => {
    expect(stickerOutlineOf({ thumbs: [{ type: "m", w: 128, h: 128 }] })).toBe(
      null,
    );
    expect(stickerOutlineOf({ thumbs: [] })).toBeNull();
    expect(stickerOutlineOf({})).toBeNull();
    expect(stickerOutlineOf(null)).toBeNull();
  });
});
