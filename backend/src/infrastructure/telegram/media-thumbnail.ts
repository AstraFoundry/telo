/**
 * Telegram attaches a stripped thumbnail (`PhotoStrippedSize`, `type: "i"`) to
 * photos, videos, animations and most documents: roughly a hundred bytes that
 * arrive with the message itself and expand into a JPEG a few dozen pixels
 * wide. Both reference clients draw it blurred and upscaled while the real
 * file downloads, which is why it is worth decoding here rather than blurring
 * the full-resolution image in the renderer.
 *
 * To fit in those hundred bytes the server strips everything a decoder can
 * reconstruct: the JFIF header, the quantisation tables and the Huffman
 * tables are all fixed and shared, so only three bytes of preamble survive —
 * a 0x01 marker plus the image's height and width, one byte each because a
 * stripped thumbnail never exceeds 255 pixels. Rebuilding the file means
 * prepending the shared header, patching those two dimensions into its SOF0
 * marker, and closing the stream with EOI.
 *
 * The header table and the two patch offsets are copied verbatim from
 * Telegram Web K (`helpers/bytes/getPreviewURLFromBytes.ts`), which matches
 * Telegram Desktop's `Images::ExpandInlineBytes`.
 */

/** The shared JFIF/DQT/SOF0/DHT preamble every stripped thumbnail omits. */
const JPEG_HEADER_HEX =
  "ffd8ffe000104a46494600010100000100010000ffdb004300281c1e231e19282321232d2b28303c64413c37373c7b585d4964918099968f808c8aa0b4e6c3a0aadaad8a8cc8ffcbdaeef5ffffff9bc1fffffffaffe6fdfff8ffdb0043012b2d2d3c353c76414176f8a58ca5f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8ffc00011080000000003012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00";

const JPEG_HEADER = Buffer.from(JPEG_HEADER_HEX, "hex");
const JPEG_TAIL = Uint8Array.of(0xff, 0xd9);

/**
 * Offsets of the height and width bytes inside the header's SOF0 marker. The
 * table above declares a 0x0000 frame size; without this patch every
 * thumbnail would decode as a zero-sized image.
 */
const SOF0_HEIGHT_OFFSET = 164;
const SOF0_WIDTH_OFFSET = 166;

/** Marker byte identifying a payload that still needs the shared header. */
const STRIPPED_MARKER = 0x01;

/**
 * Turns thumbnail bytes into a `data:` URL the renderer can assign straight
 * to an `img`, or null when there is nothing to expand.
 */
export function expandStrippedThumbnail(
  bytes: Uint8Array | null | undefined,
): string | null {
  if (!bytes || bytes.length === 0) return null;
  let jpeg: Uint8Array;
  if (bytes[0] === STRIPPED_MARKER) {
    // Marker plus the two dimension bytes and nothing else: there is no
    // entropy-coded data to decode. Emitting that URL would paint an empty
    // image while suppressing the renderer's skeleton fallback.
    if (bytes.length <= 3) return null;
    const payload = bytes.subarray(3);
    jpeg = new Uint8Array(
      JPEG_HEADER.length + payload.length + JPEG_TAIL.length,
    );
    jpeg.set(JPEG_HEADER, 0);
    jpeg.set(payload, JPEG_HEADER.length);
    jpeg.set(JPEG_TAIL, JPEG_HEADER.length + payload.length);
    jpeg[SOF0_HEIGHT_OFFSET] = bytes[1];
    jpeg[SOF0_WIDTH_OFFSET] = bytes[2];
  } else {
    // Older peers and some bots send a complete image instead of a stripped
    // one; it is already a valid file and must not be reframed.
    jpeg = bytes;
  }
  return `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;
}

/**
 * Pulls the stripped thumbnail out of a teleproto photo or document. Shaped
 * as `unknown` because the adapter reads teleproto values structurally
 * everywhere else in this folder, and the thumbnail is optional on every
 * media kind.
 */
export function strippedThumbnailOf(media: unknown): string | null {
  if (typeof media !== "object" || media === null) return null;
  // A Photo keeps its thumbnails inline in `sizes`; a Document — video,
  // animation, or plain file — keeps them in `thumbs`. Only one of the two
  // is ever present, so which one matched carries no information.
  const sizes = "sizes" in media ? media.sizes : null;
  const thumbs = "thumbs" in media ? media.thumbs : null;
  return strippedThumbnailIn(sizes) ?? strippedThumbnailIn(thumbs);
}

function strippedThumbnailIn(entries: unknown): string | null {
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    // PhotoPathSize (`type: "j"`, the sticker outline) is the other variant
    // carrying `bytes`, and those bytes are packed SVG path commands rather
    // than a JPEG fragment; expanding them would paint garbage.
    if (!("type" in entry) || entry.type !== "i") continue;
    if (!("bytes" in entry)) continue;
    const bytes = entry.bytes;
    if (bytes instanceof Uint8Array) return expandStrippedThumbnail(bytes);
    if (Array.isArray(bytes)) {
      return expandStrippedThumbnail(Uint8Array.from(bytes as number[]));
    }
  }
  return null;
}
