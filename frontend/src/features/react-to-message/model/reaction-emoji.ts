/**
 * Telegram's reaction identity is the emoji without U+FE0F — see
 * `normalizeReactionEmoji`. Paint-time needs the opposite: a character that
 * is emoji but not emoji-presentation (❤ U+2764, ⚡-adjacent dingbats)
 * otherwise takes text presentation from the UI font, which is a black
 * heart rather than the red emoji.
 *
 * Identity on the chip (`data-reaction`, toggle IPC) stays stripped.
 */
export function reactionEmojiForDisplay(emoji: string): string {
  const chars = [...emoji];
  let out = "";
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    out += ch;
    if (chars[i + 1] === "\uFE0F") continue;
    if (/\p{Emoji}/u.test(ch) && !/\p{Emoji_Presentation}/u.test(ch)) {
      out += "\uFE0F";
    }
  }
  return out;
}
