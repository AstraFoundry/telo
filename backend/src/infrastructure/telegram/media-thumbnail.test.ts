import { describe, expect, it } from "vitest";

import {
  expandStrippedThumbnail,
  strippedThumbnailOf,
} from "./media-thumbnail";

const DATA_URL_PREFIX = "data:image/jpeg;base64,";

/**
 * Byte length of the shared preamble Telegram strips out. Asserting it keeps
 * a truncated or retyped copy of the header table from silently shipping: the
 * SOF0 patch offsets are absolute, so a header of any other length patches
 * the wrong bytes and every thumbnail decodes as garbage.
 */
const JPEG_HEADER_LENGTH = 623;

function decode(url: string | null): Uint8Array {
  expect(url?.startsWith(DATA_URL_PREFIX)).toBe(true);
  return new Uint8Array(
    Buffer.from((url as string).slice(DATA_URL_PREFIX.length), "base64"),
  );
}

describe("expandStrippedThumbnail", () => {
  it("frames a stripped payload and patches its dimensions into SOF0", () => {
    const payload = [0xaa, 0xbb, 0xcc, 0xdd];
    const bytes = Uint8Array.from([0x01, 40, 30, ...payload]);

    const jpeg = decode(expandStrippedThumbnail(bytes));

    expect(jpeg.length).toBe(JPEG_HEADER_LENGTH + payload.length + 2);
    // SOI and EOI: the payload must sit inside a complete JPEG stream.
    expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...jpeg.subarray(-2)]).toEqual([0xff, 0xd9]);
    // The three preamble bytes are consumed, not copied through.
    expect([
      ...jpeg.subarray(JPEG_HEADER_LENGTH, JPEG_HEADER_LENGTH + payload.length),
    ]).toEqual(payload);
    // Height then width, the order the SOF0 marker declares them in.
    expect(jpeg[164]).toBe(40);
    expect(jpeg[166]).toBe(30);
  });

  it("passes a payload that is already a complete image through unchanged", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x2a, 0xff, 0xd9]);

    expect([...decode(expandStrippedThumbnail(jpeg))]).toEqual([...jpeg]);
  });

  it.each([
    ["missing", null],
    ["absent", undefined],
    ["empty", new Uint8Array()],
    // Marker and dimensions with no entropy-coded data behind them: the
    // rebuilt stream would paint nothing while hiding the skeleton fallback.
    ["dimensions only", Uint8Array.from([0x01, 40, 30])],
  ] as const)("returns null for %s bytes", (_label, bytes) => {
    expect(expandStrippedThumbnail(bytes)).toBeNull();
  });
});

describe("strippedThumbnailOf", () => {
  const stripped = { type: "i", bytes: Uint8Array.from([0x01, 8, 8, 0x2a]) };

  it("reads a photo's thumbnail out of sizes", () => {
    const url = strippedThumbnailOf({
      sizes: [{ type: "s", w: 90, h: 90 }, stripped],
    });

    expect(decode(url)[166]).toBe(8);
  });

  it("reads a document's thumbnail out of thumbs", () => {
    // Teleproto hands some thumbnails over as plain number arrays rather than
    // typed arrays, so both shapes have to expand.
    const url = strippedThumbnailOf({
      thumbs: [{ type: "i", bytes: [0x01, 16, 12, 0x2a] }],
    });

    const jpeg = decode(url);
    expect(jpeg[164]).toBe(16);
    expect(jpeg[166]).toBe(12);
  });

  it("never expands the sticker outline as a JPEG", () => {
    // PhotoPathSize carries `bytes` too, but they are packed SVG path
    // commands; sticker-outline.ts owns that decode.
    expect(
      strippedThumbnailOf({
        thumbs: [{ type: "j", bytes: Uint8Array.from([0xc0, 0x01, 0x02]) }],
      }),
    ).toBeNull();
  });

  it("returns null when there is no thumbnail to read", () => {
    expect(strippedThumbnailOf({ sizes: [{ type: "s", w: 90, h: 90 }] })).toBe(
      null,
    );
    expect(strippedThumbnailOf({ thumbs: [] })).toBeNull();
    expect(strippedThumbnailOf({})).toBeNull();
    expect(strippedThumbnailOf(null)).toBeNull();
    expect(strippedThumbnailOf("photo")).toBeNull();
  });
});
