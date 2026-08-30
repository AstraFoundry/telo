import { describe, expect, it } from "vitest";

import { mapMessageMedia, messageGroupedId } from "./teleproto-message-media";

describe("teleproto message media", () => {
  it("maps photo metadata, spoiler state, and album id", () => {
    const message = {
      id: 42,
      groupedId: { toString: () => "9001" },
      photo: {},
      file: {
        mimeType: "image/jpeg",
        size: { toString: () => "2048" },
        width: 800,
        height: 600,
      },
      media: { spoiler: true },
    };
    expect(mapMessageMedia(message)).toEqual({
      id: "42",
      kind: "photo",
      fileName: null,
      mimeType: "image/jpeg",
      size: 2048,
      width: 800,
      height: 600,
      duration: null,
      spoiler: true,
    });
    expect(messageGroupedId(message)).toBe("9001");
  });

  it.each([
    ["videoNote", "video-note"],
    ["voice", "voice"],
    ["gif", "animation"],
    ["sticker", "sticker"],
    ["video", "video"],
    ["audio", "audio"],
    ["document", "file"],
  ] as const)("maps %s as %s", (field, kind) => {
    expect(
      mapMessageMedia({ id: 1, [field]: {}, file: { name: "asset.bin" } }),
    ).toMatchObject({ kind, fileName: "asset.bin" });
  });

  it("returns null for text and rejects unusable numeric metadata", () => {
    expect(mapMessageMedia({ id: 1 })).toBeNull();
    expect(
      mapMessageMedia({
        id: 1,
        document: {},
        file: { size: -1, duration: Number.NaN },
      }),
    ).toMatchObject({ size: null, duration: null });
  });

  it("maps a fully fetched web page preview", () => {
    expect(
      mapMessageMedia(
        {
          id: 7,
          webPreview: {
            url: "https://example.com/launch",
            displayUrl: "example.com/launch",
            siteName: "Example Journal",
            title: "Telo launches",
            description: "A desktop Telegram client.",
            photo: {},
          },
          photo: {},
          file: { mimeType: "image/jpeg" },
        },
        "chat/7",
      ),
    ).toEqual({
      id: "chat/7",
      kind: "webpage",
      url: "https://example.com/launch",
      displayUrl: "example.com/launch",
      siteName: "Example Journal",
      title: "Telo launches",
      description: "A desktop Telegram client.",
      thumbnailMediaId: "chat/7",
    });
  });

  it("degrades a webpage without rich fields to a bare link card", () => {
    expect(
      mapMessageMedia({ id: 8, webPreview: { url: "https://example.com" } }),
    ).toEqual({
      id: "8",
      kind: "webpage",
      url: "https://example.com",
      displayUrl: null,
      siteName: null,
      title: null,
      description: null,
      thumbnailMediaId: null,
    });
  });

  it("keeps pending webpage media as a bare link card instead of dropping it", () => {
    expect(
      mapMessageMedia({
        id: 9,
        media: { webpage: { url: "https://example.com/pending" } },
      }),
    ).toMatchObject({ kind: "webpage", url: "https://example.com/pending" });
  });

  it("returns null for a webpage without a URL", () => {
    expect(mapMessageMedia({ id: 10, webPreview: {} })).toBeNull();
    expect(mapMessageMedia({ id: 10, media: { webpage: {} } })).toBeNull();
  });
});
