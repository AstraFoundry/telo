import type { MessageCallDto } from "./call";
import type { MessagePollDto } from "./poll";
import type { AvatarPlaceholderDto, ChatDto } from "./chat";
import type { MessageStickerDto } from "./sticker";

/**
 * Message vocabulary: entities, media, keyboards, reactions, paging, and edits.
 */

interface MessageEntityRangeDto {
  /** UTF-16 code-unit offset, matching Telegram and JavaScript string slices. */
  readonly offset: number;
  /** UTF-16 code-unit length. */
  readonly length: number;
}

export type MessageEntityDto =
  | (MessageEntityRangeDto & {
      readonly type:
        | "mention"
        | "hashtag"
        | "bot-command"
        | "url"
        | "email"
        | "bold"
        | "italic"
        | "code"
        | "phone"
        | "cashtag"
        | "underline"
        | "strikethrough"
        | "bank-card"
        | "spoiler"
        | "diff-insert"
        | "diff-delete";
    })
  | (MessageEntityRangeDto & {
      readonly type: "pre";
      readonly language: string;
    })
  | (MessageEntityRangeDto & {
      readonly type: "text-link";
      readonly url: string;
    })
  | (MessageEntityRangeDto & {
      readonly type: "text-mention";
      readonly userId: string;
    })
  | (MessageEntityRangeDto & {
      readonly type: "custom-emoji";
      readonly documentId: string;
    })
  | (MessageEntityRangeDto & {
      readonly type: "blockquote";
      readonly collapsed: boolean;
    })
  | (MessageEntityRangeDto & {
      readonly type: "formatted-date";
      readonly date: string;
      readonly relative: boolean;
      readonly shortTime: boolean;
      readonly longTime: boolean;
      readonly shortDate: boolean;
      readonly longDate: boolean;
      readonly dayOfWeek: boolean;
    })
  | (MessageEntityRangeDto & {
      readonly type: "diff-replace";
      readonly oldText: string;
    });

export interface MessageReplyToDto {
  readonly id: string;
  readonly senderName: string;
  readonly body: string;
  readonly entities: ReadonlyArray<MessageEntityDto>;
}

export type MessageMediaKind =
  | "photo"
  | "video"
  | "file"
  | "audio"
  | "voice"
  | "video-note"
  | "animation"
  | "sticker";

/**
 * What pressing an inline keyboard button does. Telegram defines a dozen
 * `KeyboardButton` variants; these are the three this client can honestly
 * act on, plus `"unsupported"` for the rest.
 *
 * Unsupported buttons are still reported, because the keyboard is part of the
 * message the bot sent and dropping rows would misrepresent it — Telegram
 * Desktop does the same for the variants it cannot service, answering with an
 * inform box (`api_bot.cpp:388-392`). The renderer shows them without an
 * action rather than wiring a control that silently does nothing.
 */
export type MessageButtonKind = "callback" | "url" | "copy" | "unsupported";

export interface MessageButtonDto {
  /**
   * Stable within the message, so the renderer can key an in-flight press and
   * the main process can find the button's callback payload again. The
   * callback `data` never crosses into web content.
   */
  readonly id: string;
  readonly text: string;
  readonly kind: MessageButtonKind;
  /** Target of a `"url"` button. */
  readonly url?: string | null;
  /** Payload of a `"copy"` button, which the renderer writes to the clipboard. */
  readonly copyText?: string | null;
}

/**
 * A bot's inline keyboard (Telegram `ReplyInlineMarkup`), attached below the
 * message that carries it. Rows are laid out in order and the buttons in a
 * row share the width equally. This is not the reply keyboard, which is
 * chat-level state shown above the composer.
 */
export interface MessageKeyboardDto {
  readonly rows: ReadonlyArray<ReadonlyArray<MessageButtonDto>>;
}

/**
 * Result of pressing a `"callback"` button (`messages.botCallbackAnswer`).
 * Both reference clients apply the same precedence: a non-empty message wins
 * over a url, and `alert` decides between a modal and a toast
 * (`api_bot.cpp:118-152`). `cache_time` is ignored by both, so it is not
 * modelled here.
 */
export type BotCallbackAnswerDto =
  | { readonly kind: "none" }
  | { readonly kind: "message"; readonly text: string; readonly alert: boolean }
  | { readonly kind: "url"; readonly url: string };

/**
 * Attribution of a forwarded message (Telegram `MessageFwdHeader`), and where
 * following it leads. Both reference clients resolve the target in the same
 * order: `savedFromPeer` + `savedFromMsgId` first, then a channel post's
 * `fromId` + `channelPost`, then a plain `fromId`, and finally a bare
 * `fromName` — which means the original sender disallowed linking back, so
 * there is nowhere to go.
 */
export interface MessageForwardDto {
  /** Display name of the original author, or of the channel for a post. */
  readonly senderName: string;
  /**
   * Peer to open. Null when the original sender hid their account, which is
   * the only signal Telegram gives for a restricted forward.
   */
  readonly senderId: string | null;
  /**
   * Message to scroll to inside `senderId`. Null when only the peer is
   * known, in which case following the attribution opens the peer itself.
   */
  readonly messageId: string | null;
  /**
   * Signed author of a channel post, shown after the channel name the way
   * Telegram's `lng_forwarded_signed` does. Null/absent for everything else.
   */
  readonly postAuthor?: string | null;
}

export interface MessageFileMediaDto {
  /** Stable opaque key used for download commands; never a local path. */
  readonly id: string;
  readonly kind: MessageMediaKind;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly size: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
  readonly spoiler: boolean;
  /**
   * `data:` URL of Telegram's stripped thumbnail (`PhotoStrippedSize`,
   * `type: "i"`) — a ~100-byte JPEG a few dozen pixels wide that arrives with
   * the message. It is what both reference clients draw, blurred and
   * upscaled, while the real photo or video downloads; the caller must never
   * blur the full-resolution image instead, which costs a GPU pass per frame
   * while scrolling. Null/absent when Telegram sent no stripped thumbnail,
   * which is when the renderer falls back to a skeleton.
   */
  readonly blurredThumbnail?: string | null;
  /** Sticker attributes; null for every other document kind. */
  readonly sticker?: MessageStickerDto | null;
}

/** Link preview attached to a message (Telegram MessageMediaWebPage). */
export interface MessageWebPageMediaDto {
  /** Stable opaque key identifying the carrying message. */
  readonly id: string;
  readonly kind: "webpage";
  readonly url: string;
  readonly displayUrl: string | null;
  readonly siteName: string | null;
  readonly title: string | null;
  readonly description: string | null;
  /**
   * Media id of the preview photo, downloadable through the media pipeline;
   * null when Telegram attached no photo.
   */
  readonly thumbnailMediaId: string | null;
}

export type MessageMediaDto = MessageFileMediaDto | MessageWebPageMediaDto;

/**
 * One emoji bucket of a message's reactions (Telegram `ReactionCount`).
 *
 * `chosen` is Telegram's `chosenOrder`, reduced to the only question a chip
 * asks: did this account pick this emoji. Custom-emoji and paid reactions
 * (`ReactionCustomEmoji`, `ReactionPaid`) carry a document rather than a
 * glyph and are not mapped; a message that only carries those reports none.
 */
export interface MessageReactionDto {
  readonly emoji: string;
  readonly count: number;
  readonly chosen: boolean;
}

export interface MessageDto {
  readonly id: string;
  readonly chatId: string;
  readonly senderName: string;
  /**
   * Peer id of the author, used to key the avatar cache: the sender's user id
   * in groups and the channel id for channel posts. Telegram resolves photos
   * per peer, not per message. Only incoming rows read it — outgoing rows
   * render the account's own photo — so a local optimistic placeholder that
   * Telegram has not acknowledged yet carries the empty string, matching the
   * existing `senderName` convention.
   */
  readonly senderId: string;
  /**
   * Author photo (`telo-media://` or a data URL) taken from the avatar cache
   * when the message was mapped, so a cache hit paints with the first frame.
   * Null when Telegram has no photo, or the cache has not resolved yet — see
   * `senderAvatarPending`.
   */
  readonly senderAvatarUrl: string | null;
  /**
   * True until the author photo settles. A later `chat-avatar` event keyed by
   * `senderId` overlays this snapshot; the avatar slot shows a skeleton
   * meanwhile unless `senderAvatarPlaceholder` can paint.
   */
  readonly senderAvatarPending?: boolean;
  /** Empty userpic for the author when they have no photo. */
  readonly senderAvatarPlaceholder?: AvatarPlaceholderDto | null;
  readonly body: string;
  readonly entities: ReadonlyArray<MessageEntityDto>;
  /**
   * How many emoji this message is, when its whole text is emoji and nothing
   * else. Telegram draws such a message at a larger size than ordinary text —
   * "jumbomoji" — and both reference clients cap it at three
   * (`tdesktop … ui/text/text_isolated_emoji.h kIsolatedEmojiLimit`, Web K
   * `wrapRichText`'s `loadPromises`/`isSingleEmoji` path). Absent or zero for
   * every other message, including one emoji followed by any other character.
   *
   * A single emoji that Telegram has an animation for never reaches here:
   * TDLib substitutes `messageAnimatedEmoji` for the text and it arrives as
   * sticker media with the `"emoji"` role instead.
   */
  readonly isolatedEmojiCount?: number;
  readonly media: MessageMediaDto | null;
  /** Telegram album identifier shared by each message in an album. */
  readonly groupedId: string | null;
  readonly sentAt: string;
  readonly outgoing: boolean;
  readonly status: "sending" | "sent" | "read" | "failed";
  /** Snapshot of the message this one replies to; null/absent when not a reply. */
  readonly replyTo?: MessageReplyToDto | null;
  /** ISO timestamp of the last edit; null/absent when never edited. */
  readonly editedAt?: string | null;
  /**
   * Client-assigned id set on outgoing sends, echoed back by the adapter so
   * the optimistic placeholder can be reconciled with the delivered message.
   */
  readonly clientId?: string | null;
  /**
   * Attribution of a forwarded message (Telegram `fwdFrom`), including where
   * following it leads. Null/absent for ordinary messages and for forwards
   * sent with the sender hidden by the forwarder.
   */
  readonly forwardedFrom?: MessageForwardDto | null;
  /**
   * Whether the message is pinned in its chat (TDLib `message.is_pinned`).
   * Absent for ordinary messages; the context menu reads this to offer Pin
   * versus Unpin.
   */
  readonly pinned?: boolean;
  /**
   * Inline keyboard the message carries (Telegram `ReplyInlineMarkup`).
   * Null/absent for every message without one, which is almost all of them.
   */
  readonly keyboard?: MessageKeyboardDto | null;
  /**
   * Reaction buckets in Telegram's own order, most-reacted first. Absent on
   * an optimistic placeholder and on any message nobody has reacted to.
   */
  readonly reactions?: ReadonlyArray<MessageReactionDto>;
  /**
   * Call log entry when the message is a `messageCall`/`messageGroupCall`;
   * the bubble renders as a call card instead of text. Null otherwise.
   */
  readonly call?: MessageCallDto | null;
  /**
   * Poll card when the message is a `messagePoll` (TDLib `poll`); the bubble
   * renders the question and answer options instead of a text body, and
   * votes arrive as edited-message upserts. Null otherwise.
   */
  readonly poll?: MessagePollDto | null;
  /**
   * ISO timestamp of the scheduled delivery when the message sits in the
   * chat's scheduled list (TDLib `messageSchedulingStateSendAtDate`).
   * Null/absent for ordinary transcript messages.
   */
  readonly scheduledAt?: string | null;
}

export interface MessagePageInput {
  readonly limit?: number;
  /** Exclusive message id; retrieves messages older than this message. */
  readonly beforeMessageId?: string | null;
}

export interface MessagePageDto {
  readonly items: ReadonlyArray<MessageDto>;
  readonly nextCursor: string | null;
}

/**
 * Server-side global search result: chats whose title or latest preview
 * matches the query, plus messages whose body matches across all chats
 * (most recent first). Mirrors Telegram's global search sections.
 */
export interface GlobalSearchResultDto {
  readonly chats: ReadonlyArray<ChatDto>;
  readonly messages: ReadonlyArray<MessageDto>;
}

export interface MessageSearchPageInput {
  readonly limit?: number;
  /** Exclusive match id; retrieves matches older than this message. */
  readonly beforeMessageId?: string | null;
}

export interface MessageSearchPageDto {
  /** Matching message ids, newest first (Telegram's own search order). */
  readonly messageIds: ReadonlyArray<string>;
  /** Total matches in the chat's full history, as reported by the server. */
  readonly totalCount: number;
  /** Oldest loaded match id; pass as `beforeMessageId` for the next page. */
  readonly nextCursor: string | null;
}

export interface EditMessageInput {
  readonly chatId: string;
  readonly messageId: string;
  readonly body: string;
}

/**
 * How far a delete reaches: `"me"` hides the message for this account only,
 * `"everyone"` revokes it for all participants (Telegram `revoke`). Omitted
 * keeps the historical behavior, which always revoked — `"everyone"`.
 */
export type DeleteMessageScope = "me" | "everyone";

export interface DeleteMessageInput {
  readonly chatId: string;
  readonly messageId: string;
  readonly scope?: DeleteMessageScope;
}

/**
 * Adds or removes one emoji on a message. User accounts cannot call
 * TDLib's `setMessageReactions` (bots only); the adapter uses
 * `addMessageReaction` / `removeMessageReaction` instead. `emoji` is always
 * the pressed glyph. `remove: true` takes that glyph back.
 */
export interface SetMessageReactionInput {
  readonly chatId: string;
  readonly messageId: string;
  readonly emoji: string;
  readonly remove?: boolean;
}

export interface ForwardMessageInput {
  readonly fromChatId: string;
  readonly messageId: string;
  readonly toChatId: string;
  /**
   * Telegram "hide sender": the forwarded copy drops its author attribution
   * (`dropAuthor`). Omitted keeps the attribution, matching the historical
   * behavior.
   */
  readonly hideSender?: boolean;
}

/**
 * Pins or unpins one message (TDLib `pinChatMessage` / `unpinChatMessage`).
 * `silent` maps to `disable_notification`: tdesktop's group pin dialog
 * starts with "notify all members" unchecked, so the default here is
 * `true` — pass `false` to push a pinned-message notification to the chat.
 * Notifications never fire in channels or private chats regardless.
 */
export interface PinMessageInput {
  readonly chatId: string;
  readonly messageId: string;
  readonly pinned: boolean;
  readonly silent?: boolean;
}
