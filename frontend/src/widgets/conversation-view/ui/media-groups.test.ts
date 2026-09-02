import { describe, expect, it } from "vitest";

import type {
  MessageDto,
  MessageFileMediaDto,
} from "../../../../../contracts/src/ipc";
import {
  groupTranscript,
  isVisualMedia,
  mediaDownloadKey,
} from "./media-groups";

function message(partial: Partial<MessageDto> & Pick<MessageDto, "id">) {
  return {
    chatId: "chat-1",
    senderName: "Sender",
    senderId: "peer-sender",
    senderAvatarUrl: null,
    body: "",
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-01-01T10:00:00.000Z",
    outgoing: false,
    status: "read",
    ...partial,
  } satisfies MessageDto;
}

function photo(id: string): MessageFileMediaDto {
  return {
    id,
    kind: "photo",
    fileName: `${id}.png`,
    mimeType: "image/png",
    size: null,
    width: 640,
    height: 480,
    duration: null,
    spoiler: false,
  };
}

describe("groupTranscript", () => {
  it("keeps media-free messages as single units", () => {
    const units = groupTranscript([message({ id: "a" }), message({ id: "b" })]);
    expect(units.map((unit) => unit.key)).toEqual(["a", "b"]);
    expect(units.map((unit) => unit.startIndex)).toEqual([0, 1]);
  });

  it("collapses consecutive visual messages with one groupedId into an album", () => {
    const units = groupTranscript([
      message({ id: "before" }),
      message({ id: "a1", media: photo("chat/a1"), groupedId: "g" }),
      message({ id: "a2", media: photo("chat/a2"), groupedId: "g" }),
      message({ id: "a3", media: photo("chat/a3"), groupedId: "g" }),
      message({ id: "after" }),
    ]);
    expect(units).toHaveLength(3);
    const album = units[1];
    expect(album.key).toBe("album-g");
    expect(album.startIndex).toBe(1);
    expect(album.messages.map((entry) => entry.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("does not group a lone groupedId message", () => {
    const units = groupTranscript([
      message({ id: "a1", media: photo("chat/a1"), groupedId: "g" }),
    ]);
    expect(units).toHaveLength(1);
    expect(units[0].key).toBe("a1");
  });

  it("breaks the album when a member is not visual media", () => {
    const units = groupTranscript([
      message({ id: "a1", media: photo("chat/a1"), groupedId: "g" }),
      message({
        id: "a2",
        groupedId: "g",
        media: { ...photo("chat/a2"), kind: "file" },
      }),
      message({ id: "a3", media: photo("chat/a3"), groupedId: "g" }),
    ]);
    expect(units.map((unit) => unit.key)).toEqual(["a1", "a2", "a3"]);
  });
});

describe("isVisualMedia", () => {
  it("accepts photo and video kinds and rejects files and webpages", () => {
    expect(isVisualMedia(photo("chat/1"))).toBe(true);
    expect(isVisualMedia({ ...photo("chat/2"), kind: "video" })).toBe(true);
    expect(isVisualMedia({ ...photo("chat/3"), kind: "file" })).toBe(false);
    expect(isVisualMedia(null)).toBe(false);
  });
});

describe("mediaDownloadKey", () => {
  it("uses the media id for file media and the thumbnail id for webpages", () => {
    expect(mediaDownloadKey(photo("chat/1"))).toBe("chat/1");
    expect(
      mediaDownloadKey({
        id: "chat/9",
        kind: "webpage",
        url: "https://example.com",
        displayUrl: null,
        siteName: null,
        title: null,
        description: null,
        thumbnailMediaId: "chat/9-thumb",
      }),
    ).toBe("chat/9-thumb");
    expect(
      mediaDownloadKey({
        id: "chat/10",
        kind: "webpage",
        url: "https://example.com",
        displayUrl: null,
        siteName: null,
        title: null,
        description: null,
        thumbnailMediaId: null,
      }),
    ).toBeNull();
  });
});
