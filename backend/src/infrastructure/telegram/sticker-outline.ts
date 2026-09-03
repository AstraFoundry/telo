/**
 * Telegram ships a sticker's outline with the message itself, as a
 * `PhotoPathSize` thumbnail (`type: "j"`) holding a few hundred bytes of
 * compressed SVG path commands. Decoding it needs no network and no decoder
 * library, which is why both reference clients draw that outline as the
 * sticker's placeholder rather than a spinner, a grey box, or the alt emoji.
 *
 * The encoding is documented at https://core.telegram.org/api/files#vector-thumbnails
 * and implemented identically in Telegram Web K (`helpers/bytes/getPathFromBytes.ts`)
 * and Telegram Desktop (`Images::PathFromInlineBytes`).
 */

/**
 * Byte values at or above 192 index this table directly; it holds the path
 * command letters plus the two separators, in the order Telegram encodes them.
 */
const LOOKUP =
  "AACAAAAHAAALMAAAQASTAVAAAZaacaaaahaaalmaaaqastava.az0123456789-,";

/**
 * Expands the packed bytes into an SVG path `d` attribute, or null when there
 * is nothing to expand. Path coordinates are in the document's own pixel
 * space, so the caller supplies a `viewBox` of the sticker's dimensions.
 */
export function decodeStickerOutline(
  bytes: Uint8Array | null | undefined,
): string | null {
  if (!bytes || bytes.length === 0) return null;
  const parts: string[] = ["M"];
  for (const byte of bytes) {
    if (byte >= 192) {
      // A command letter or an explicit separator, stored as a table index.
      parts.push(LOOKUP[byte - 192] ?? "");
      continue;
    }
    // Otherwise the low six bits are a coordinate, and bits 6/7 encode which
    // separator precedes it — a comma between a pair, a minus for a negative.
    if (byte >= 128) parts.push(",");
    else if (byte >= 64) parts.push("-");
    parts.push(String(byte & 63));
  }
  parts.push("z");
  const path = parts.join("");
  // "Mz" is a path with no geometry; a decode that produced only the framing
  // commands is a failed decode, and returning it would paint nothing while
  // suppressing the skeleton fallback.
  return path === "Mz" ? null : path;
}

/**
 * Pulls the vector-thumbnail bytes out of a teleproto document's `thumbs`.
 * Shaped as `unknown` because the adapter reads teleproto values structurally
 * everywhere else in this folder, and the sticker path is optional on every
 * document.
 */
export function stickerOutlineOf(document: unknown): string | null {
  if (typeof document !== "object" || document === null) return null;
  if (!("thumbs" in document)) return null;
  const thumbs = document.thumbs;
  if (!Array.isArray(thumbs)) return null;
  for (const thumb of thumbs) {
    if (typeof thumb !== "object" || thumb === null) continue;
    if (!("bytes" in thumb)) continue;
    // PhotoPathSize is the only thumbnail type whose payload is a path; every
    // other `bytes` thumbnail (PhotoStrippedSize) is a JPEG fragment.
    if ("type" in thumb && thumb.type !== "j") continue;
    const bytes = thumb.bytes;
    if (bytes instanceof Uint8Array) return decodeStickerOutline(bytes);
    if (Array.isArray(bytes)) {
      return decodeStickerOutline(Uint8Array.from(bytes as number[]));
    }
  }
  return null;
}
