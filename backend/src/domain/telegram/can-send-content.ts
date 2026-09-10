import type { ChatDto } from "./chat";

/** Content kinds a chat's send permissions gate. */
export type SendableContentKind = "text" | "stickers" | "media" | "any";

/**
 * Whether the account may post `kind` to `chat`. The flags come from the
 * adapter's mapping of Telegram's member status and chat permissions; an
 * omitted flag means writable (demo fixtures and older events), and omitted
 * sticker/media flags follow the plain-text flag, matching the `ChatDto`
 * contract. `"any"` asks whether anything can be posted at all — the forward
 * path, where the content kind is whatever the source message carries.
 */
export function canSendContent(
  chat: ChatDto,
  kind: SendableContentKind,
): boolean {
  const text = chat.canSendMessages ?? true;
  const stickers = chat.canSendStickers ?? text;
  const media = chat.canSendMedia ?? text;
  if (kind === "any") return text || stickers || media;
  if (kind === "text") return text;
  return kind === "stickers" ? stickers : media;
}

/**
 * Throws the user-facing send-permission error when `kind` is blocked. These
 * are the messages the TDLib adapter historically raised, so the error
 * surface the renderer shows is unchanged by the move into the domain.
 */
export function assertCanSendContent(
  chat: ChatDto,
  kind: SendableContentKind,
): void {
  if (canSendContent(chat, kind)) return;
  throw new Error(
    kind === "stickers"
      ? "The current account can't send stickers to this chat"
      : kind === "media"
        ? "The current account can't send media to this chat"
        : "The current account can't write to this chat",
  );
}
