import { describe, expect, it } from "vitest";

import {
  isServiceMessage,
  mapMessageMedia,
  messageGroupedId,
} from "./teleproto-message-media";

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
      blurredThumbnail: null,
      sticker: null,
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

  it.each([
    ["image/webp", "static"],
    ["application/x-tgsticker", "animated"],
    ["video/webm", "video"],
  ] as const)("reads a %s sticker as %s", (mimeType, format) => {
    expect(
      mapMessageMedia({
        id: 5,
        sticker: {},
        document: {
          attributes: [
            { alt: "🐱", stickerset: { shortName: "CatPack" } },
            { w: 512, h: 512 },
          ],
        },
        file: { name: "sticker.webp", mimeType },
      }),
    ).toMatchObject({
      kind: "sticker",
      width: 512,
      height: 512,
      sticker: { emoji: "🐱", format, setName: "CatPack" },
    });
  });

  it("keeps a sticker mappable when Telegram sends no attribute", () => {
    // A document can reach the client without its sticker attribute; the
    // emoji placeholder then has nothing to draw, which is not a failure.
    expect(
      mapMessageMedia({
        id: 6,
        sticker: {},
        file: { name: "sticker.webp", mimeType: "image/webp" },
      }),
    ).toMatchObject({
      kind: "sticker",
      sticker: { emoji: null, format: "static", setName: null },
    });
  });

  it("leaves every other document kind without sticker attributes", () => {
    expect(
      mapMessageMedia({ id: 7, document: {}, file: { name: "notes.pdf" } }),
    ).toMatchObject({ kind: "file", sticker: null });
  });

  it("does not treat a service message as downloadable media", () => {
    expect(
      isServiceMessage({
        id: 1,
        className: "MessageService",
        action: { photo: { id: 2 } },
        photo: { id: 2 },
      }),
    ).toBe(true);
    expect(
      mapMessageMedia({
        id: 1,
        className: "MessageService",
        action: { photo: { id: 2 } },
        photo: { id: 2 },
        file: { name: "chat.jpg" },
      }),
    ).toBeNull();
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

  it("maps video metrics from document attributes when File getters throw", () => {
    const throwing = (): number => {
      throw new TypeError("Right-hand side of 'instanceof' is not callable");
    };
    const file = {
      name: "clip.mp4",
      mimeType: "video/mp4",
      size: 4096,
      get width() {
        return throwing();
      },
      get height() {
        return throwing();
      },
      get duration() {
        return throwing();
      },
    };
    expect(
      mapMessageMedia({
        id: 8,
        video: {},
        document: { attributes: [{ w: 1280, h: 720, duration: 12 }] },
        file,
      }),
    ).toEqual({
      id: "8",
      kind: "video",
      fileName: "clip.mp4",
      mimeType: "video/mp4",
      size: 4096,
      width: 1280,
      height: 720,
      duration: 12,
      spoiler: false,
      blurredThumbnail: null,
      sticker: null,
    });
  });

  it("maps a photo's stripped thumbnail into blurredThumbnail", () => {
    const media = mapMessageMedia({
      id: 11,
      photo: {
        sizes: [
          { type: "s", w: 90, h: 90 },
          { type: "i", bytes: Uint8Array.from([0x01, 24, 18, 0x2a]) },
        ],
      },
      file: { mimeType: "image/jpeg" },
    });
    // The mapper's job is to hand the renderer a decodable URL; the byte-level
    // expansion is covered in media-thumbnail.test.ts.
    expect(media).toMatchObject({
      kind: "photo",
      blurredThumbnail: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
  });

  it("leaves blurredThumbnail null when Telegram sent no stripped thumbnail", () => {
    // Channel photos posted by some bots, and every document uploaded without
    // a preview, arrive with no inline thumbnail at all.
    expect(
      mapMessageMedia({ id: 12, document: { thumbs: [] }, file: {} }),
    ).toMatchObject({ kind: "file", blurredThumbnail: null });
  });
});
