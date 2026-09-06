/**
 * Telegram's "jumbomoji" rule: a message whose whole text is emoji and
 * nothing else is drawn larger than ordinary text, and only up to a few of
 * them.
 *
 * Both reference clients cap it at three — tdesktop's
 * `kIsolatedEmojiLimit` (`ui/text/text_isolated_emoji.h`) and Web K's
 * three-emoji branch in `wrapRichText` — and both require the text to be
 * *only* emoji: one emoji followed by a full stop is an ordinary message.
 * Neither allows whitespace between them, because a space is a text block and
 * a text block is what makes the message not isolated.
 */
export const ISOLATED_EMOJI_LIMIT = 3;

/**
 * Grapheme clusters are the unit here, not code points: a skin-toned thumb, a
 * flag and a multi-person ZWJ sequence are each one emoji to a reader, and
 * counting their code points would call a single 👨‍👩‍👧‍👦 four emoji and drop it
 * past the limit.
 */
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * `Extended_Pictographic` covers the pictographs; the rest of a cluster is
 * the machinery that binds one together — variation selectors, the zero-width
 * joiner, skin-tone modifiers, keycap combining marks — plus the regional
 * indicators that pair into flags and the digits and `#`/`*` that keycaps are
 * built from. A cluster made only of these is an emoji.
 */
const EMOJI_CLUSTER =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u{FE0E}|\u{FE0F}|\u{200D}|\u{20E3}|[0-9#*])+$/u;

/**
 * How many emoji this text is, or 0 when it is anything else.
 *
 * Zero is the answer for empty text, for text carrying a single non-emoji
 * character, and for more emoji than Telegram draws large — the caller needs
 * one number, and "not isolated" and "too many to enlarge" lead to the same
 * ordinary rendering.
 */
export function isolatedEmojiCount(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const { segment } of graphemes.segment(text)) {
    // A lone digit or `#` matches the cluster pattern on its own — they are
    // only emoji as the base of a keycap — so a cluster has to carry at least
    // one pictograph, flag half or keycap mark to count.
    if (!EMOJI_CLUSTER.test(segment)) return 0;
    if (
      !/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{20E3}/u.test(
        segment,
      )
    ) {
      return 0;
    }
    count += 1;
    if (count > ISOLATED_EMOJI_LIMIT) return 0;
  }
  return count;
}
