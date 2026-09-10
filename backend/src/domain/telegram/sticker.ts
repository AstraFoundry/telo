/**
 * Sticker vocabulary: sets, catalog, and animated-emoji effects.
 */
/**
 * How a sticker document is encoded. Telegram tells these apart by mime type:
 * `image/webp` is a still, `application/x-tgsticker` is a gzipped Lottie
 * animation, and `video/webm` is a short silent video.
 */
export type StickerFormat = "static" | "animated" | "video";

/** A Telegram input-sticker-set reference safe to carry across Electron IPC. */
export type StickerSetReferenceDto =
  | {
      readonly kind: "id";
      readonly id: string;
    }
  | {
      readonly kind: "short-name";
      readonly shortName: string;
    };

/**
 * Telegram `DocumentAttributeSticker` payload. A sticker is a document, so it
 * keeps every `MessageFileMediaDto` field and adds these on top.
 */
/**
 * What a sticker document is standing in for.
 *
 * `"sticker"` is one the sender picked out of a set. `"emoji"` is Telegram's
 * animated rendering of a message whose whole text was one emoji — TDLib
 * `messageAnimatedEmoji`, which it substitutes for `messageText` on its own.
 * The two are drawn at different sizes and play by different rules, so the
 * transcript has to be able to tell them apart.
 */
export type StickerRole = "sticker" | "emoji";

export interface MessageStickerDto {
  /**
   * Emoji the sticker stands for. It is the accessible name; it is not the
   * placeholder — see `outlinePath`.
   */
  readonly emoji: string | null;
  /**
   * Defaults to `"sticker"` when absent — a picker cell and a sticker message
   * have no opinion to state, and only the transcript's animated-emoji path
   * asks.
   */
  readonly role?: StickerRole;
  readonly format: StickerFormat;
  /** Set the sticker belongs to; null for set-less/system stickers. */
  readonly setReference: StickerSetReferenceDto | null;
  /**
   * SVG path of the sticker's own silhouette, decoded main-side from the
   * document's vector thumbnail (Telegram `PhotoPathSize`, `type: "j"`). It
   * arrives with the message, so it is what both reference clients paint
   * until the document itself is on disk. Null when Telegram sent no vector
   * thumbnail, which is when the renderer falls back to a skeleton.
   *
   * Coordinates are in the document's own pixel space: draw it in a viewBox
   * of `width` × `height`.
   */
  readonly outlinePath: string | null;
}

/**
 * One sticker inside an installed set, ready for the picker to draw and send.
 * `id` is an opaque media key that flows through the same download pipeline
 * as message media, so the picker never handles filesystem paths.
 */
export interface StickerItemDto {
  readonly id: string;
  readonly emoji: string | null;
  readonly format: StickerFormat;
  readonly width: number | null;
  readonly height: number | null;
  /** Silhouette to draw until the document lands; see `MessageStickerDto`. */
  readonly outlinePath: string | null;
}

/**
 * The oversized sticker Telegram plays over the transcript when an animated
 * emoji is clicked (TDLib `clickAnimatedEmojiMessage`, and the peer's own
 * click arriving as `updateAnimatedEmojiMessageClicked`).
 *
 * It is a separate document from the one in the bubble: the message carries
 * the small looping-once emoji, the effect is a bigger, louder take on it.
 * Null is a real answer — TDLib answers 404 for "no effect, replay the usual
 * animation", which is not an error.
 */
export interface AnimatedEmojiEffectDto {
  readonly chatId: string;
  readonly messageId: string;
  /** Media id of the effect document, downloadable through the media pipeline. */
  readonly mediaId: string;
  readonly sticker: MessageStickerDto;
  readonly width: number | null;
  readonly height: number | null;
}

/** Lightweight installed-set metadata used to paint picker navigation. */
export interface StickerSetSummaryDto {
  readonly id: string;
  readonly title: string;
  readonly shortName: string;
  readonly reference: StickerSetReferenceDto;
}

/** A resolved sticker set with its sendable documents. */
export interface StickerSetDto extends StickerSetSummaryDto {
  readonly stickers: ReadonlyArray<StickerItemDto>;
  /**
   * Whether the account has the set installed. Always true for the picker's
   * own list; a set opened from a received sticker may not be.
   */
  readonly installed: boolean;
}

/**
 * The account-level sticker picker state. Recent and favorite stickers are
 * server-owned ordered views over the same documents as installed sets; they
 * stay separate so the renderer never invents synthetic sticker packs.
 */
export interface StickerCatalogDto {
  readonly recent: ReadonlyArray<StickerItemDto>;
  readonly favorites: ReadonlyArray<StickerItemDto>;
  readonly sets: ReadonlyArray<StickerSetSummaryDto>;
}
