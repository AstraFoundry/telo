import type {
  MessageMediaDto,
  MessageStickerDto,
  StickerFormat,
} from "../../../../contracts/src/ipc";
import { strippedThumbnailOf } from "./media-thumbnail";
import { stickerOutlineOf } from "./sticker-outline";

interface TeleprotoFileView {
  readonly name?: unknown;
  readonly mimeType?: unknown;
  readonly size?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly duration?: unknown;
}

interface TeleprotoWebPageView {
  readonly url?: unknown;
  readonly displayUrl?: unknown;
  readonly siteName?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly photo?: unknown;
}

interface TeleprotoMediaMessage {
  readonly id: { toString(): string } | number;
  readonly groupedId?: { toString(): string };
  readonly className?: unknown;
  readonly action?: unknown;
  readonly file?: TeleprotoFileView;
  readonly photo?: unknown;
  readonly video?: unknown;
  readonly document?: unknown;
  readonly audio?: unknown;
  readonly voice?: unknown;
  readonly videoNote?: unknown;
  readonly gif?: unknown;
  readonly sticker?: unknown;
  readonly webPreview?: TeleprotoWebPageView;
  readonly media?: unknown;
}

export function isServiceMessage(message: TeleprotoMediaMessage): boolean {
  return message.className === "MessageService" || message.action != null;
}

export function mapMessageMedia(
  message: TeleprotoMediaMessage,
  mediaId = message.id.toString(),
): MessageMediaDto | null {
  // MessageActionChatEditPhoto exposes `photo` on the wrapper, but that is
  // a ChatPhoto bound to the service action — not downloadable message media.
  if (isServiceMessage(message)) return null;
  const webPage = webPageOf(message);
  if (webPage) {
    // A WebPageEmpty carries no URL and renders as plain text in Telegram, so
    // there is no card to build; anything else keeps at least its link.
    const url = stringValue(webPage.url);
    if (!url) return null;
    return {
      id: mediaId,
      kind: "webpage",
      url,
      displayUrl: stringValue(webPage.displayUrl),
      siteName: stringValue(webPage.siteName),
      title: stringValue(webPage.title),
      description: stringValue(webPage.description),
      thumbnailMediaId: webPage.photo ? mediaId : null,
    };
  }
  const kind = message.photo
    ? "photo"
    : message.videoNote
      ? "video-note"
      : message.voice
        ? "voice"
        : message.gif
          ? "animation"
          : message.sticker
            ? "sticker"
            : message.video
              ? "video"
              : message.audio
                ? "audio"
                : message.document
                  ? "file"
                  : null;
  if (!kind) return null;
  const file = message.file;
  const mimeType = stringValue(file?.mimeType);
  return {
    id: mediaId,
    kind,
    fileName: stringValue(file?.name),
    mimeType,
    size: finiteNumber(file?.size),
    // Teleproto's File.width/height/duration call `_fromAttr([Cls, Cls])`,
    // which does `attr instanceof [Cls, Cls]` and throws TypeError, and a
    // photo carries no document attributes at all — its dimensions live on
    // the PhotoSize entries (telegram-tt `getPhotoFullDimensions`, tdesktop's
    // PhotoData), so the chain falls through file → document → photo sizes.
    width:
      fileMetric(file, "width") ??
      attributeMetric(message.document, "w") ??
      photoMetric(message.photo, "w"),
    height:
      fileMetric(file, "height") ??
      attributeMetric(message.document, "h") ??
      photoMetric(message.photo, "h"),
    duration:
      fileMetric(file, "duration") ??
      attributeMetric(message.document, "duration"),
    spoiler: Boolean(
      typeof message.media === "object" &&
      message.media &&
      "spoiler" in message.media &&
      message.media.spoiler,
    ),
    // Stickers have their vector outline instead, and a voice note, audio
    // track or video note has no visual placeholder worth decoding — only the
    // kinds the renderer actually blurs behind a download pay for the base64.
    blurredThumbnail:
      kind === "photo"
        ? strippedThumbnailOf(message.photo)
        : kind === "video"
          ? strippedThumbnailOf(message.video)
          : kind === "animation"
            ? strippedThumbnailOf(message.gif)
            : kind === "file"
              ? strippedThumbnailOf(message.document)
              : null,
    sticker: kind === "sticker" ? stickerOf(message.document, mimeType) : null,
  };
}

export function messageGroupedId(
  message: TeleprotoMediaMessage,
): string | null {
  return message.groupedId?.toString() ?? null;
}

// Teleproto's webPreview accessor only surfaces fully fetched WebPage
// constructors; pending or otherwise unknown webpage media still carries a
// URL on media.webpage and must degrade to a bare link card, not vanish.
function webPageOf(
  message: TeleprotoMediaMessage,
): TeleprotoWebPageView | null {
  if (message.webPreview && typeof message.webPreview === "object") {
    return message.webPreview;
  }
  const media = message.media;
  if (media && typeof media === "object" && "webpage" in media) {
    const webpage = (media as { webpage?: unknown }).webpage;
    if (webpage && typeof webpage === "object") {
      return webpage as TeleprotoWebPageView;
    }
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "object" && value && "toString" in value) {
    value = Number((value as { toString(): string }).toString());
  }
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function fileMetric(
  file: TeleprotoFileView | undefined,
  key: "width" | "height" | "duration",
): number | null {
  if (!file) return null;
  try {
    return finiteNumber(file[key]);
  } catch {
    return null;
  }
}

function attributeMetric(document: unknown, key: string): number | null {
  for (const attribute of documentAttributes(document)) {
    if (!(key in attribute)) continue;
    const value = finiteNumber(attribute[key as keyof typeof attribute]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * A photo's display dimensions from its `sizes` entries. `PhotoSize`,
 * `PhotoCachedSize` and `PhotoSizeProgressive` carry `w`/`h`; the stripped
 * placeholder and the empty size do not. The largest entry by area is the
 * display size — every size is proportional, but taking the largest keeps the
 * choice identical to what the reference clients lay out against.
 */
function photoMetric(photo: unknown, key: "w" | "h"): number | null {
  if (typeof photo !== "object" || photo === null || !("sizes" in photo)) {
    return null;
  }
  const sizes = photo.sizes;
  if (!Array.isArray(sizes)) return null;
  let bestArea = 0;
  let best: { readonly w: number; readonly h: number } | null = null;
  for (const entry of sizes) {
    if (typeof entry !== "object" || entry === null) continue;
    if (!("w" in entry) || !("h" in entry)) continue;
    const w = finiteNumber(entry.w);
    const h = finiteNumber(entry.h);
    if (w === null || h === null || w === 0 || h === 0) continue;
    if (w * h > bestArea) {
      bestArea = w * h;
      best = { w, h };
    }
  }
  return best ? best[key] : null;
}

// Telegram keeps the emoji a sticker stands for and the set it came from on
// DocumentAttributeSticker, and leaves the encoding to the mime type.
// DocumentAttributeCustomEmoji carries the same two fields and also means
// "draw this document as a sticker", so both are read the same way.
function stickerOf(
  document: unknown,
  mimeType: string | null,
): MessageStickerDto {
  const outlinePath = stickerOutlineOf(document);
  for (const attribute of documentAttributes(document)) {
    if (!("alt" in attribute) || !("stickerset" in attribute)) continue;
    return {
      emoji: stringValue(attribute.alt),
      format: stickerFormat(mimeType),
      setName: stickerSetName(attribute.stickerset),
      outlinePath,
    };
  }
  return {
    emoji: null,
    format: stickerFormat(mimeType),
    setName: null,
    outlinePath,
  };
}

function stickerSetName(stickerset: unknown): string | null {
  if (typeof stickerset !== "object" || stickerset === null) return null;
  if (!("shortName" in stickerset)) return null;
  return stringValue(stickerset.shortName);
}

export function stickerFormat(mimeType: string | null): StickerFormat {
  if (mimeType === "application/x-tgsticker") return "animated";
  if (mimeType === "video/webm") return "video";
  return "static";
}

function documentAttributes(document: unknown): ReadonlyArray<object> {
  if (typeof document !== "object" || document === null) return [];
  if (!("attributes" in document)) return [];
  const attributes = document.attributes;
  if (!Array.isArray(attributes)) return [];
  return attributes.filter(
    (attribute): attribute is object =>
      typeof attribute === "object" && attribute !== null,
  );
}
