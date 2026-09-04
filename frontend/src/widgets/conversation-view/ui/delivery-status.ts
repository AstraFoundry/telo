import type { MessageDto } from "../../../../../contracts/src/ipc";

/**
 * What the delivery indicator draws for one outgoing message.
 *
 * Telegram keeps these four states visually distinct, and every client draws
 * the same alphabet: a clock while the message is still in flight, one check
 * once the server acknowledged it, two checks once the recipient read it, and
 * an error mark when the send failed. Collapsing "sent" onto the two-check
 * glyph — even at a lighter stroke — claims the message was read.
 */
export type DeliveryGlyphKind = "clock" | "check" | "double-check" | "error";

/**
 * The single mapping from message state to indicator. The switch is
 * exhaustive on `MessageDto["status"]` with no default branch, so a new
 * message state fails typecheck here instead of silently inheriting one of
 * the existing glyphs.
 */
export function deliveryGlyphKind(
  status: MessageDto["status"],
): DeliveryGlyphKind {
  switch (status) {
    case "sending":
      return "clock";
    case "sent":
      return "check";
    case "read":
      return "double-check";
    case "failed":
      return "error";
  }
}
