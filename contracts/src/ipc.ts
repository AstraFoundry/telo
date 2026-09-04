import type { AGUIEvent } from "@ag-ui/core";

export type ChatKind = "direct" | "group" | "channel" | "saved";

export interface ChatDto {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly updatedAt: string;
  readonly unreadCount: number;
  /**
   * Id of the last message the user has read (Telegram `readInboxMaxId`);
   * positions the unread divider in the transcript. Null when the read
   * boundary is unknown.
   */
  readonly lastReadMessageId: string | null;
  readonly muted: boolean;
  readonly pinned: boolean;
  readonly kind: ChatKind;
  readonly initials: string;
  /**
   * Profile photo URL (`telo-media://` or a data URL). Null when Telegram has
   * no photo, or the cache has not resolved yet — see `avatarPending`.
   */
  readonly avatarDataUrl: string | null;
  /**
   * True until a disk/memory cache hit or the Telegram download settles.
   * The avatar slot shows a skeleton while this is set, never initials.
   */
  readonly avatarPending?: boolean;
  /** Server-synced draft text (e.g. typed on another Telegram client). */
  readonly draftPreview: string | null;
  /** Whether the other party is currently typing in this chat. */
  readonly typing: boolean;
  /**
   * Presence of the other party in a direct chat: `"online"` when Telegram
   * reports them online, null/absent otherwise. Groups, channels, and Saved
   * Messages have no single counterpart, so they never report presence.
   */
  readonly presence?: "online" | null;
  /**
   * Telegram folder the chat belongs to: `ARCHIVE_FOLDER_ID` for archived
   * chats, any other value for a custom folder, null/absent for the main
   * list outside any folder. Telegram allows a chat to sit in several
   * custom folders; the adapter reports the first matching filter.
   */
  readonly folderId?: number | null;
  /**
   * Keyword folders this chat currently matches. Virtual membership: a chat
   * keeps its native `folderId` and may also appear in any number of
   * keyword folders. Ids are negative so they never collide with Telegram's.
   */
  readonly keywordFolderIds?: ReadonlyArray<number>;
}

/** Reserved Telegram folder id for the Archive. */
export const ARCHIVE_FOLDER_ID = 1;

/**
 * Native Telegram dialog filters versus local keyword folders. Keyword
 * folder ids are negative so they never collide with Telegram's. Omitted
 * `kind` is treated as `"native"` (Telegram adapters only emit those).
 */
export type ChatFolderKind = "native" | "keyword";

export interface ChatFolderDto {
  /** Telegram dialog filter id, `ARCHIVE_FOLDER_ID`, or a negative keyword id. */
  readonly id: number;
  readonly title: string;
  /** Unread messages across the folder's chats, computed server-side. */
  readonly unreadCount: number;
  /** Discriminator; omitted means a native Telegram folder. */
  readonly kind?: ChatFolderKind;
  /**
   * Search term for keyword folders. A chat belongs to the folder when any
   * message body contains this term as a case-insensitive substring.
   */
  readonly query?: string;
}

export interface KeywordFolderInput {
  readonly title: string;
  readonly query: string;
}

export interface UpdateKeywordFolderInput extends KeywordFolderInput {
  readonly id: number;
}

export interface ChatPageCursorDto {
  readonly chatId: string;
  readonly topMessageId: string;
  readonly updatedAt: string;
}

export interface ChatPageInput {
  readonly limit?: number;
  readonly cursor?: ChatPageCursorDto | null;
}

export interface ChatPageDto {
  readonly items: ReadonlyArray<ChatDto>;
  readonly nextCursor: ChatPageCursorDto | null;
}

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

/**
 * How a sticker document is encoded. Telegram tells these apart by mime type:
 * `image/webp` is a still, `application/x-tgsticker` is a gzipped Lottie
 * animation, and `video/webm` is a short silent video.
 */
export type StickerFormat = "static" | "animated" | "video";

/**
 * Telegram `DocumentAttributeSticker` payload. A sticker is a document, so it
 * keeps every `MessageFileMediaDto` field and adds these on top.
 */
export interface MessageStickerDto {
  /**
   * Emoji the sticker stands for. It is the accessible name; it is not the
   * placeholder — see `outlinePath`.
   */
  readonly emoji: string | null;
  readonly format: StickerFormat;
  /** Short name of the set the sticker belongs to; null when it has none. */
  readonly setName: string | null;
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

/** A sticker set, the unit Telegram's picker and set sheet group stickers by. */
export interface StickerSetDto {
  readonly id: string;
  readonly title: string;
  readonly shortName: string;
  readonly stickers: ReadonlyArray<StickerItemDto>;
  /**
   * Whether the account has the set installed. Always true for the picker's
   * own list; a set opened from a received sticker may not be.
   */
  readonly installed: boolean;
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
   * meanwhile, never initials.
   */
  readonly senderAvatarPending?: boolean;
  readonly body: string;
  readonly entities: ReadonlyArray<MessageEntityDto>;
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
   * Inline keyboard the message carries (Telegram `ReplyInlineMarkup`).
   * Null/absent for every message without one, which is almost all of them.
   */
  readonly keyboard?: MessageKeyboardDto | null;
  /**
   * Reaction buckets in Telegram's own order, most-reacted first. Absent on
   * an optimistic placeholder and on any message nobody has reacted to.
   */
  readonly reactions?: ReadonlyArray<MessageReactionDto>;
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

export type TelegramWorkspaceEvent =
  | {
      readonly type: "connection-state";
      readonly state: "offline" | "synchronizing" | "connected";
    }
  | {
      readonly type: "chat-upsert";
      readonly chat: ChatDto;
    }
  | {
      /** Full dialog snapshot after a successful GetDialogs refresh. */
      readonly type: "chats";
      readonly chats: ReadonlyArray<ChatDto>;
      readonly nextCursor: ChatPageCursorDto | null;
    }
  | {
      /** The chat's pinned-message set changed; reload the pin strip. */
      readonly type: "pinned-messages";
      readonly chatId: string;
    }
  | {
      readonly type: "chat-avatar";
      readonly chatId: string;
      readonly avatarDataUrl: string | null;
    }
  | {
      readonly type: "message-upsert";
      readonly cause: "new" | "edited";
      readonly message: MessageDto;
    }
  | {
      readonly type: "message-delete";
      readonly chatId: string;
      readonly messageIds: ReadonlyArray<string>;
    }
  | {
      readonly type: "message-read";
      readonly chatId: string;
      readonly maxMessageId: string;
      readonly direction: "inbox" | "outbox";
    }
  | {
      /**
       * A message's reaction buckets changed, either from this account's own
       * `sendReaction` or from someone else reacting
       * (`Api.UpdateMessageReactions`).
       */
      readonly type: "message-reactions";
      readonly chatId: string;
      readonly messageId: string;
      readonly reactions: ReadonlyArray<MessageReactionDto>;
    }
  | {
      /**
       * Catch-up / update-queue failures. The adapter logs these in the
       * main process and no longer publishes this variant; the renderer
       * ignores it if an older main process still emits one.
       */
      readonly type: "sync-error";
      readonly message: string;
    }
  | {
      readonly type: "typing";
      readonly chatId: string;
      readonly typing: boolean;
    }
  | {
      readonly type: "draft";
      readonly chatId: string;
      readonly draftPreview: string | null;
    }
  | {
      readonly type: "chat-mute";
      readonly chatId: string;
      readonly muted: boolean;
    }
  | {
      readonly type: "chat-pin";
      readonly chatId: string;
      readonly pinned: boolean;
    }
  | {
      /** Presence flip for a direct chat's counterpart. */
      readonly type: "chat-presence";
      readonly chatId: string;
      readonly online: boolean;
    }
  | {
      /** Full folder snapshot; folder lists are tiny, so deltas are not modeled. */
      readonly type: "folders";
      readonly folders: ReadonlyArray<ChatFolderDto>;
    }
  | {
      readonly type: "media-download";
      readonly mediaId: string;
      readonly state: "downloading" | "ready" | "cancelled" | "failed";
      readonly downloadedBytes: number;
      readonly totalBytes: number | null;
      readonly url: string | null;
      readonly error: string | null;
    }
  | {
      readonly type: "media-upload";
      readonly uploadId: string;
      readonly state: "uploading" | "ready" | "cancelled" | "failed";
      readonly progress: number;
      readonly error: string | null;
    };

export interface SendMessageInput {
  readonly replyToId?: string;
  /** Stable id minted by the renderer for optimistic-send reconciliation. */
  readonly clientId?: string;
  /**
   * Telegram "send without sound": the recipient gets the message without a
   * notification sound.
   */
  readonly silent?: boolean;
  /**
   * Formatting spans authored through the composer's formatting controls.
   * Offsets and lengths are UTF-16 code units over `body`, matching the
   * entity contract of received messages.
   */
  readonly entities?: ReadonlyArray<MessageEntityDto>;
}

export interface SendMediaInput {
  readonly uploadId: string;
  readonly caption?: string;
  readonly replyToId?: string;
  readonly clientId?: string;
}

/** Preload-to-main transport only; never returned to web content. */
export interface LocalMediaFileInput {
  /**
   * Absolute file path picked from disk; empty when the file only exists in
   * memory (a pasted clipboard image has no path), in which case `bytes`
   * carries the content and main stages it to a temp file before upload.
   */
  readonly source: string;
  readonly bytes?: Uint8Array;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
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
 * The account's reaction on one message after the call, not a delta:
 * Telegram's `messages.sendReaction` replaces the whole set this account
 * holds on a message, and `null` clears it. Telegram's own clients hold one
 * emoji per message outside premium multi-reactions, which is the shape the
 * renderer toggles against.
 */
export interface SetMessageReactionInput {
  readonly chatId: string;
  readonly messageId: string;
  readonly emoji: string | null;
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

export interface CurrentUserDto {
  readonly id: string;
  readonly displayName: string;
  readonly username: string | null;
  readonly initials: string;
  readonly avatarDataUrl: string | null;
}

/**
 * A member of a group chat, listed for the composer's mention autocomplete.
 * `username` is null for accounts without one; such members can be mentioned
 * only through a `text-mention` entity, which the composer does not author.
 */
export interface ChatMemberDto {
  readonly id: string;
  readonly displayName: string;
  readonly username: string | null;
  /**
   * Member photo from the shared per-peer avatar cache, or null when the
   * member has no photo or the download has not settled — see `avatarPending`.
   * A later `chat-avatar` event keyed by `id` carries the settled photo.
   */
  readonly avatarDataUrl: string | null;
  /** True until the photo settles, exactly like `ChatDto.avatarPending`. */
  readonly avatarPending?: boolean;
}

/**
 * Identity card for any Telegram peer, including a group member or channel
 * poster who has no dialog of their own. A peer that does have a dialog is
 * shown through the richer chat profile instead, so this carries only what
 * Telegram can tell about a peer with no shared history.
 */
export interface PeerProfileDto {
  readonly id: string;
  readonly title: string;
  readonly username: string | null;
  readonly kind: ChatKind;
  readonly avatarDataUrl: string | null;
  /** True until the photo settles, exactly like `ChatDto.avatarPending`. */
  readonly avatarPending?: boolean;
  /** Telegram "about" text; null when empty or hidden from the account. */
  readonly bio: string | null;
  /** Set only when the peer shares their number with the account. */
  readonly phone: string | null;
}

/** Inclusive bounds the renderer clamps to and the domain re-validates. */
export const AGENT_TEMPERATURE_MIN = 0;
export const AGENT_TEMPERATURE_MAX = 2;
/** Tool-call rounds one run may take before the model must answer. */
export const AGENT_MAX_STEPS_MIN = 1;
export const AGENT_MAX_STEPS_MAX = 8;
/** Prior thread turns replayed to the model, newest kept. */
export const AGENT_HISTORY_LIMIT_MIN = 0;
export const AGENT_HISTORY_LIMIT_MAX = 50;

/**
 * First-class BYOA providers. OpenAI, Anthropic, Google, xAI, and Kimi
 * authenticate with desktop OAuth when a client is configured; Groq,
 * DeepSeek, and Mistral still use the account key the vendor issues.
 * OpenAI-compatible is the fallback for any other HTTPS endpoint and is
 * listed last.
 */
export const FIRST_CLASS_AGENT_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "groq",
  "xai",
  "kimi",
  "deepseek",
  "mistral",
] as const;

export const AGENT_COMPATIBLE_PROVIDER = "openai-compatible" as const;

export const AGENT_PROVIDERS = [
  ...FIRST_CLASS_AGENT_PROVIDERS,
  AGENT_COMPATIBLE_PROVIDER,
] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

/**
 * Vendors whose Connect-account path is desktop OAuth. Groq, DeepSeek, and
 * Mistral stay on API keys; they do not publish a native OAuth program Telo
 * can run.
 */
export const AGENT_OAUTH_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "kimi",
] as const;

export type AgentOAuthProvider = (typeof AGENT_OAUTH_PROVIDERS)[number];

export type AgentAuthKind = "oauth" | "api-key";

export function agentProviderSupportsOAuth(
  provider: AgentProvider,
): provider is AgentOAuthProvider {
  return (AGENT_OAUTH_PROVIDERS as readonly string[]).includes(provider);
}

/** True when this build can run Connect for `provider`. */
export function agentOAuthIsConfigured(
  configured: ReadonlyArray<AgentOAuthProvider>,
  provider: AgentProvider,
): boolean {
  return agentProviderSupportsOAuth(provider) && configured.includes(provider);
}

/** Model id filled in when the user picks this provider. */
export const AGENT_PROVIDER_DEFAULT_MODEL: Record<AgentProvider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  xai: "grok-3",
  kimi: "kimi-k2.5",
  deepseek: "deepseek-chat",
  mistral: "mistral-small-latest",
  "openai-compatible": "gpt-4.1-mini",
};

export function isAgentProvider(value: string): value is AgentProvider {
  return (AGENT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Kimi coding / Moonshot models fix temperature per thinking mode (1.0 when
 * thinking, 0.6 when not). Sending any other value returns 400
 * (`invalid temperature: only 1 is allowed for this model`). Official Kimi
 * docs and oh-my-pi omit the field so the server applies the mode default.
 * Named Kimi always talks to that API; compatible endpoints need the same
 * treatment when the id is a Kimi family id.
 */
export function agentRequestOmitsTemperature(
  provider: AgentProvider,
  model: string,
): boolean {
  return provider === "kimi" || isKimiFamilyModelId(model);
}

/** `kimi-k2.5`, `moonshotai/kimi-k2.6`, `vendor/kimi-k3`. */
export function isKimiFamilyModelId(model: string): boolean {
  return model.includes("moonshotai/kimi") || /(^|\/)kimi[-.]/i.test(model);
}

export interface AgentConfigurationDto {
  readonly provider: AgentProvider;
  readonly model: string;
  readonly baseUrl: string | null;
  readonly instructions: string;
  /** True when an API key or OAuth tokens are stored in the main process. */
  readonly hasCredential: boolean;
  /** Which stored secret will authenticate the next run; null when none. */
  readonly authKind: AgentAuthKind | null;
  /** Connected account email (or similar); never a token. */
  readonly accountLabel: string | null;
  /**
   * OAuth vendors this build can Connect. Combined with the selected
   * provider in the renderer to decide Connect vs key.
   */
  readonly configuredOAuthProviders: ReadonlyArray<AgentOAuthProvider>;
  readonly canInspectWorkspace: boolean;
  /** Sampling temperature handed to the provider. */
  readonly temperature: number;
  /** Tool-call rounds allowed before the model has to produce an answer. */
  readonly maxSteps: number;
  /** How many prior turns of the thread are replayed as context. */
  readonly historyLimit: number;
}

export interface SaveAgentConfigurationInput {
  readonly provider: AgentConfigurationDto["provider"];
  readonly model: string;
  readonly baseUrl?: string | null;
  readonly instructions: string;
  readonly apiKey?: string;
  readonly canInspectWorkspace: boolean;
  readonly temperature: number;
  readonly maxSteps: number;
  readonly historyLimit: number;
}

/** Persist provider fields and start (or finish) the vendor OAuth loop. */
export type ConnectAgentAccountInput = Omit<
  SaveAgentConfigurationInput,
  "apiKey"
>;

/**
 * List chat-capable models from the selected vendor. `apiKey` is the unsaved
 * key in the form; when it is omitted the main process uses the stored
 * secret for the same provider (API key or OAuth). The renderer never
 * receives credentials back.
 */
export interface ListAgentModelsInput {
  readonly provider: AgentProvider;
  readonly baseUrl?: string | null;
  readonly apiKey?: string;
}

export interface AgentModelDto {
  readonly id: string;
  /** Vendor display name when the list endpoint provides one. */
  readonly label?: string;
}

export interface AgentModelListDto {
  readonly models: ReadonlyArray<AgentModelDto>;
}

export type ThemePreference = "light" | "dark" | "system";

export type AccentColorPreference =
  "blue" | "green" | "purple" | "red" | "orange";

export type TimeFormatPreference = "system" | "12h" | "24h";

/**
 * A user-defined quick reply: the composer inserts `body` at the caret.
 * Persisted as a preference so templates follow the account on this device.
 */
export interface MessageTemplateDto {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export interface UserPreferencesDto {
  readonly agentPanelOpen: boolean;
  readonly demoWorkspace: boolean;
  readonly theme: ThemePreference;
  readonly accentColor: AccentColorPreference;
  readonly messageTextSize: number;
  readonly timeFormat: TimeFormatPreference;
  readonly sendWithEnter: boolean;
  readonly notificationsEnabled: boolean;
  /** Workspace chat-list column width in CSS pixels. */
  readonly sidebarWidth: number;
  /** Workspace agent-panel column width in CSS pixels. */
  readonly agentPanelWidth: number;
  /** Recently picked composer emoji glyphs, most recent first. */
  readonly recentEmojis: ReadonlyArray<string>;
  /**
   * Chat ids of recently opened search results, most recent first. Search
   * history is local to this device — both reference clients persist it
   * locally per account (web-k caps at 20), never synced server-side.
   */
  readonly recentSearches: ReadonlyArray<string>;
  /** Quick replies the composer can insert into a draft. */
  readonly messageTemplates: ReadonlyArray<MessageTemplateDto>;
  /**
   * Forces the reduced-motion path on even when the OS does not ask for it.
   * Telegram calls the same idea power saving; the app never animates less
   * than the OS asks, so this only ever adds restraint.
   */
  readonly reduceMotion: boolean;
  /** Animated stickers replay on their own instead of holding one frame. */
  readonly loopStickers: boolean;
  /** Desktop notifications carry the sender's name rather than just the app. */
  readonly notificationSenderName: boolean;
  /** Desktop notifications carry the message body rather than a placeholder. */
  readonly notificationPreview: boolean;
  /** Muted chats contribute to the chat-list and folder unread badges. */
  readonly countMutedChats: boolean;
  /** Ceiling for the on-disk media cache, in mebibytes. */
  readonly mediaCacheLimitMb: number;
}

export interface UpdateUserPreferencesInput {
  readonly agentPanelOpen?: boolean;
  readonly demoWorkspace?: boolean;
  readonly theme?: ThemePreference;
  readonly accentColor?: AccentColorPreference;
  readonly messageTextSize?: number;
  readonly timeFormat?: TimeFormatPreference;
  readonly sendWithEnter?: boolean;
  readonly notificationsEnabled?: boolean;
  readonly sidebarWidth?: number;
  readonly agentPanelWidth?: number;
  readonly recentEmojis?: ReadonlyArray<string>;
  readonly recentSearches?: ReadonlyArray<string>;
  readonly messageTemplates?: ReadonlyArray<MessageTemplateDto>;
  readonly reduceMotion?: boolean;
  readonly loopStickers?: boolean;
  readonly notificationSenderName?: boolean;
  readonly notificationPreview?: boolean;
  readonly countMutedChats?: boolean;
  readonly mediaCacheLimitMb?: number;
}

export interface UiContextSnapshot {
  readonly activeChat: Pick<ChatDto, "id" | "title" | "kind"> | null;
  readonly visibleChats: ReadonlyArray<
    Pick<ChatDto, "id" | "title" | "unreadCount">
  >;
  readonly visibleMessages: ReadonlyArray<
    Pick<MessageDto, "senderName" | "body" | "sentAt" | "outgoing">
  >;
  readonly components: ReadonlyArray<{
    readonly id: string;
    readonly role: string;
    readonly state: Readonly<Record<string, string | number | boolean | null>>;
  }>;
}

export interface RunAgentInput {
  readonly threadId: string;
  readonly prompt: string;
  readonly context: UiContextSnapshot;
  /**
   * User-facing label persisted as the transcript's user message instead of
   * the raw prompt; action prompts embed markers and message payloads the
   * transcript must not show.
   */
  readonly promptLabel?: string;
  /** Which Telegram messages are assembled into the run's model payload. */
  readonly scope: AgentContextScopeInput;
  /**
   * Message-level action (translate / rewrite / draft reply). When set, the
   * backend rebuilds the prompt from the action and streams the result over
   * CUSTOM events instead of the panel transcript.
   */
  readonly action?: MessageAgentActionInput;
}

/**
 * A chat-scoped agent action (summary / extraction). The message payload is
 * assembled main-side from the run's `unread` scope — fresh, redacted, and
 * audited — so the renderer only names the chat and the transcript label.
 */
export interface RunChatAgentInput {
  readonly threadId: string;
  readonly context: UiContextSnapshot;
  /** Chat the scope is collected from; backs the run's `unread` scope. */
  readonly chatId: string;
  readonly chatTitle: string;
  /** User-facing transcript label persisted instead of the machine prompt. */
  readonly promptLabel: string;
}

export type MessageAgentActionKind = "translate" | "rewrite" | "draft-reply";

export type MessageAgentActionTone = "neutral" | "friendly" | "formal";

/**
 * A message-level agent action (translate / rewrite / draft reply) riding on
 * the regular `agent.run` channel. The backend rebuilds the prompt from the
 * action and the message body carried in `RunAgentInput.prompt`; the result
 * streams back over CUSTOM AG-UI events named `MESSAGE_ACTION_EVENT_NAME` and
 * is written into the composer draft, never into the panel transcript.
 */
export interface MessageAgentActionInput {
  readonly kind: MessageAgentActionKind;
  readonly tone?: MessageAgentActionTone;
}

/** Stream payload of a message action, mirroring the backend's AgentOutput. */
export type MessageAgentActionOutput =
  | { readonly type: "text"; readonly delta: string }
  | { readonly type: "activity"; readonly label: string }
  | { readonly type: "error"; readonly message: string }
  /**
   * Terminal event of every action run. It doubles as the completion signal
   * because the invoke response can overtake queued event messages, so the
   * renderer cleans up on `done`, not on the response.
   */
  | { readonly type: "done" };

/** Reserved threadId for message actions; the backend persists no thread. */
export const MESSAGE_ACTION_THREAD_ID = "message-action";

/** CUSTOM AG-UI event name carrying MessageAgentActionOutput values. */
export const MESSAGE_ACTION_EVENT_NAME = "message-action";

/**
 * CUSTOM AG-UI event emitted once per successful panel run, after the reply
 * text and before `RUN_FINISHED`, carrying `AgentSuggestionsPayload`: short
 * follow-up prompts the composer offers as pills. Absent when the model had
 * nothing to propose.
 */
export const AGENT_SUGGESTIONS_EVENT_NAME = "suggestions";

export interface AgentSuggestionsPayload {
  readonly items: ReadonlyArray<string>;
}

/**
 * In-app link scheme. Agent replies cite Telegram messages with these links
 * and the renderer turns them into jump targets; nothing outside the app
 * handles the scheme, so it never leaves the window.
 */
export const TELO_LINK_SCHEME = "telo:";

export const teloMessageLink = (chatId: string, messageId: string): string =>
  `telo://message/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}`;

export type TeloLink = {
  readonly kind: "message";
  readonly chatId: string;
  readonly messageId: string;
};

const TELO_MESSAGE_LINK = /^telo:\/\/message\/([^/\s]+)\/([^/\s]+)$/;

/** Parses an in-app link; null for anything that is not one. */
export function parseTeloLink(href: string): TeloLink | null {
  const match = TELO_MESSAGE_LINK.exec(href);
  if (!match) return null;
  try {
    return {
      kind: "message",
      chatId: decodeURIComponent(match[1]!),
      messageId: decodeURIComponent(match[2]!),
    };
  } catch {
    return null;
  }
}

/**
 * Explicit context scope for an agent run: the user picks exactly which
 * Telegram messages are assembled into the model payload.
 * - `selected`: the messages the user explicitly pointed at (currently the
 *   composer's reply target; multi-select arrives with the Wave 4 batch
 *   actions).
 * - `unread`: the active chat's unread messages.
 * - `folder`: unread messages across the chats of the active folder
 *   (`folderId` null/absent is the implicit "All chats" main list).
 */
export type AgentContextScope = "selected" | "unread" | "folder";

export interface AgentContextScopeInput {
  readonly scope: AgentContextScope;
  /** Required for `selected` and `unread`: the chat the messages live in. */
  readonly chatId?: string;
  /** Active folder for `folder` scope; null/absent means the main list. */
  readonly folderId?: number | null;
  /** Explicit message ids within `chatId` for `selected` scope. */
  readonly messageIds?: ReadonlyArray<string>;
}

/**
 * One message of the assembled agent context. `body` and `senderName` are
 * already redacted: the preview shows exactly what the model receives.
 */
export interface AgentContextMessageDto {
  readonly messageId: string;
  readonly chatId: string;
  readonly chatTitle: string;
  readonly senderName: string;
  readonly body: string;
  readonly sentAt: string;
}

/** How many fields of each kind the redaction pass masked in a payload. */
export interface AgentRedactionCounts {
  readonly emails: number;
  readonly phones: number;
  readonly tokens: number;
}

export interface AgentContextPreviewDto {
  readonly scope: AgentContextScope;
  readonly messages: ReadonlyArray<AgentContextMessageDto>;
  readonly redactionCounts: AgentRedactionCounts;
}
/**
 * How an automation (trigger rule or scheduled task) delivers the agent
 * run's result: `auto-send` posts it into the chat, `draft-only` parks it
 * in the composer draft. Declared per rule/task; the global default is
 * draft-only.
 */
export type AgentDeliveryMode = "auto-send" | "draft-only";

/**
 * Match dimensions of a trigger rule. Dimensions combine with AND; several
 * keywords are OR within their dimension. At least one dimension must be
 * set. Automation never fires on the account's own outgoing messages.
 */
export interface AgentTriggerRuleMatchDto {
  readonly chatIds: ReadonlyArray<string>;
  readonly senderIds: ReadonlyArray<string>;
  readonly keywords: ReadonlyArray<string>;
  /** Regular expression tested against the message body; null when unused. */
  readonly pattern: string | null;
  /** When true, muted chats never fire the rule. */
  readonly excludeMuted: boolean;
}

export interface AgentTriggerRuleDto {
  readonly ruleId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly match: AgentTriggerRuleMatchDto;
  readonly delivery: AgentDeliveryMode;
  /** Instruction of the triggered run; the matched message is the payload. */
  readonly promptTemplate: string;
  readonly createdBy: "user" | "agent";
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Create-or-replace input for a trigger rule: an absent `ruleId` creates
 * (the main process mints the id), a present one replaces the editable
 * fields of that rule.
 */
export interface SaveTriggerRuleInput {
  readonly ruleId?: string;
  readonly name: string;
  readonly match: Partial<AgentTriggerRuleMatchDto>;
  readonly delivery?: AgentDeliveryMode;
  readonly promptTemplate: string;
}

/** When a scheduled task fires: recurring cron or a single future instant. */
export type AgentTaskScheduleDto =
  | { readonly kind: "cron"; readonly expression: string }
  | { readonly kind: "once"; readonly runAt: string };

/**
 * Optional context scope of a scheduled run. "selected" is excluded on
 * purpose: pinned message ids go stale between scheduling and firing.
 */
export interface AgentTaskContextDto {
  readonly scope: "unread" | "folder";
  readonly chatId?: string;
  readonly folderId?: number;
}

export interface AgentScheduledTaskDto {
  readonly taskId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly schedule: AgentTaskScheduleDto;
  readonly delivery: AgentDeliveryMode;
  readonly promptTemplate: string;
  /** Chat the run's result is delivered to (message or draft). */
  readonly chatId: string;
  readonly context: AgentTaskContextDto | null;
  readonly lastRunAt: string | null;
  /** Next fire after now; null for spent one-shots and impossible crons. */
  readonly nextRunAt: string | null;
  readonly createdBy: "user" | "agent";
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Create-or-replace input for a scheduled task; same ruleId semantics. */
export interface SaveScheduledTaskInput {
  readonly taskId?: string;
  readonly name: string;
  readonly schedule: AgentTaskScheduleDto;
  readonly delivery?: AgentDeliveryMode;
  readonly promptTemplate: string;
  readonly chatId: string;
  readonly context?: AgentTaskContextDto | null;
}

/**
 * Pushed to the renderer whenever an automation finishes (or fails) a run,
 * so the UI can surface what happened without polling. `preview` is the
 * first 200 characters of the delivered/attempted text. `draft-conflict`
 * means draft-only delivery found an occupied composer and left it alone.
 */
export interface AgentAutomationEvent {
  readonly type: "automation-run";
  readonly source: "trigger" | "schedule";
  readonly sourceId: string;
  readonly sourceName: string;
  readonly chatId: string;
  readonly delivery: AgentDeliveryMode;
  readonly status: "sent" | "draft" | "draft-conflict" | "empty" | "error";
  readonly preview: string;
  readonly error?: string;
}

/**
 * Local audit trail entry for one agent run. Records what left the device
 * (scope, message ids, redaction counts, prompt hash) — never the raw
 * prompt or message bodies.
 */
export interface AgentAuditRecordDto {
  readonly id: string;
  readonly timestamp: string;
  readonly action: "run";
  readonly threadId: string;
  readonly scope: AgentContextScope;
  readonly messageIds: ReadonlyArray<string>;
  readonly redactionCounts: AgentRedactionCounts;
  readonly model: string;
  readonly promptHash: string;
}

export interface AgentThreadMessageDto {
  readonly id: string;
  readonly from: "user" | "assistant";
  readonly body: string;
  readonly sentAt: string;
  /** Set when the body reports a failed run rather than a model reply. */
  readonly error?: boolean;
}

export interface AgentThreadSummaryDto {
  readonly threadId: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface AgentThreadDto extends AgentThreadSummaryDto {
  readonly messages: ReadonlyArray<AgentThreadMessageDto>;
}

export interface AgentThreadListDto {
  readonly threads: ReadonlyArray<AgentThreadSummaryDto>;
  readonly activeThreadId: string | null;
}

export interface TelegramLoginInput {
  readonly phoneNumber: string;
  readonly apiId?: number;
  readonly apiHash?: string;
}

export interface TelegramLoginConfigurationDto {
  readonly applicationCredentialsConfigured: boolean;
}

/**
 * One signed-in Telegram account on this device, the unit the account
 * switcher lists. Telegram Desktop's own cap is 3 accounts for free users
 * (`Main::Domain::kMaxAccounts`), which this client follows.
 */
export interface TelegramAccountDto {
  /** Stable id assigned at first login; never the Telegram user id. */
  readonly id: string;
  readonly displayName: string;
  readonly username: string | null;
  /** Profile photo (`telo-media://` or a data URL); null when unknown. */
  readonly avatarDataUrl: string | null;
  /** Whether this is the account the workspace is currently attached to. */
  readonly active: boolean;
  /**
   * Unread messages as last seen while this account was connected. Only the
   * active account stays connected, so an inactive account's count is what it
   * was when the account was last active — never a live number.
   */
  readonly unreadCount: number;
}

export type TelegramAuthState =
  | { readonly status: "idle" }
  | { readonly status: "restoring" }
  | { readonly status: "connecting" }
  | { readonly status: "code-required" }
  | { readonly status: "password-required"; readonly hint: string | null }
  | { readonly status: "ready" }
  | { readonly status: "error"; readonly message: string };

export interface TeloDesktopApi {
  readonly workspace: {
    getCurrentUser(): Promise<CurrentUserDto>;
    listChatPage(input?: ChatPageInput): Promise<ChatPageDto>;
    /**
     * Lists the chat folders (custom folders plus the Archive when it holds
     * chats, plus local keyword folders) with server-computed unread counts.
     * The implicit "All chats" view is not part of the list.
     */
    listFolders(): Promise<ReadonlyArray<ChatFolderDto>>;
    /** Creates a local keyword folder; the search term auto-collects matching chats. */
    createKeywordFolder(input: KeywordFolderInput): Promise<ChatFolderDto>;
    /** Updates a local keyword folder's title and search term. */
    updateKeywordFolder(
      input: UpdateKeywordFolderInput,
    ): Promise<ChatFolderDto>;
    /** Deletes a local keyword folder. Native Telegram folders cannot be deleted here. */
    deleteKeywordFolder(id: number): Promise<void>;
    listMessagePage(
      chatId: string,
      input?: MessagePageInput,
    ): Promise<MessagePageDto>;
    /**
     * The chat's shared media: photo, video, and file messages, paged with
     * the same cursor semantics as `listMessagePage`.
     */
    listSharedMedia(
      chatId: string,
      input?: MessagePageInput,
    ): Promise<MessagePageDto>;
    /** The chat's pinned messages, most recently pinned first. */
    listPinnedMessages(chatId: string): Promise<ReadonlyArray<MessageDto>>;
    /**
     * Members of a group chat, for the composer's mention autocomplete.
     * Empty for chats without a member list (direct, channel, Saved
     * Messages) — the autocomplete simply stays closed there.
     */
    listChatMembers(chatId: string): Promise<ReadonlyArray<ChatMemberDto>>;
    /**
     * Identity card for one peer, used when a message author has no dialog to
     * open. Peers with a dialog are read from the chat list instead.
     */
    getPeerProfile(peerId: string): Promise<PeerProfileDto>;
    /**
     * The account's installed sticker sets, each with its stickers, for the
     * composer picker. Sticker ids are media keys the download pipeline
     * understands, so the picker draws them the same way the transcript does.
     */
    listStickerSets(): Promise<ReadonlyArray<StickerSetDto>>;
    /** Sends one sticker from an installed set into a chat. */
    sendSticker(chatId: string, stickerId: string): Promise<MessageDto>;
    /**
     * One set by short name, for the sheet a received sticker opens. Unlike
     * the picker's list this can return a set the account has not installed.
     */
    getStickerSet(shortName: string): Promise<StickerSetDto>;
    /** Adds the set to the account's stickers, or removes it. */
    setStickerSetInstalled(
      shortName: string,
      installed: boolean,
    ): Promise<void>;
    /**
     * Resolves the documents behind `custom-emoji` message entities. They are
     * sticker documents, so the results carry the same media ids and download
     * through the same pipeline as set stickers.
     */
    getCustomEmoji(
      documentIds: ReadonlyArray<string>,
    ): Promise<ReadonlyArray<StickerItemDto>>;
    /**
     * Server-side global search: chats matching the query by title/preview
     * plus messages matching by body across every chat.
     */
    searchGlobal(query: string): Promise<GlobalSearchResultDto>;
    /**
     * Server-side search within a single chat; returns the matching message
     * ids (newest first) so the transcript can page until each match loads.
     */
    searchMessages(
      chatId: string,
      query: string,
      input?: MessageSearchPageInput,
    ): Promise<MessageSearchPageDto>;
    sendMessage(
      chatId: string,
      body: string,
      input?: SendMessageInput,
    ): Promise<MessageDto>;
    downloadMedia(mediaId: string): Promise<void>;
    cancelMediaDownload(mediaId: string): Promise<void>;
    /**
     * Copies the cached media file to a destination picked in the native save
     * dialog, downloading it first when not yet cached. Resolves to the saved
     * path, or null when the dialog is cancelled. `fileName` only seeds the
     * dialog's suggested name.
     */
    saveMediaAs(
      mediaId: string,
      fileName: string | null,
    ): Promise<string | null>;
    /**
     * Opens the cached media file with the system default application,
     * downloading it first when not yet cached.
     */
    openMedia(mediaId: string): Promise<void>;
    sendMedia(
      chatId: string,
      files: ReadonlyArray<File>,
      input: SendMediaInput,
    ): Promise<ReadonlyArray<MessageDto>>;
    cancelMediaUpload(uploadId: string): Promise<void>;
    editMessage(input: EditMessageInput): Promise<void>;
    deleteMessage(input: DeleteMessageInput): Promise<void>;
    forwardMessage(input: ForwardMessageInput): Promise<void>;
    /**
     * Sets (or clears, with a null emoji) this account's reaction on a
     * message.
     */
    setMessageReaction(input: SetMessageReactionInput): Promise<void>;
    /**
     * Emoji this chat allows as reactions, in Telegram's own order
     * (`messages.getAvailableReactions`, inactive entries dropped). The
     * picker renders exactly this list.
     */
    listAvailableReactions(chatId: string): Promise<ReadonlyArray<string>>;
    setChatPinned(chatId: string, pinned: boolean): Promise<void>;
    setChatMuted(chatId: string, muted: boolean): Promise<void>;
    setChatRead(chatId: string, read: boolean): Promise<void>;
    /** Sends (or cancels) the local user's typing signal for a chat. */
    setTyping(chatId: string, typing: boolean): Promise<void>;
    /** Persists the composer draft server-side; an empty string clears it. */
    saveDraft(chatId: string, text: string): Promise<void>;
    /**
     * Presses a `"callback"` inline keyboard button. The callback payload is
     * looked up main-side from the message, so the opaque bytes Telegram
     * expects never reach web content.
     */
    answerBotCallback(
      chatId: string,
      messageId: string,
      buttonId: string,
    ): Promise<BotCallbackAnswerDto>;
    /**
     * Moves a chat into or out of the Archive (Telegram
     * `folders.editPeerFolders`, `folder_id` 1 ↔ 0).
     */
    setChatArchived(chatId: string, archived: boolean): Promise<void>;
    onEvent(listener: (event: TelegramWorkspaceEvent) => void): () => void;
  };
  readonly agent: {
    getConfiguration(): Promise<AgentConfigurationDto>;
    saveConfiguration(
      input: SaveAgentConfigurationInput,
    ): Promise<AgentConfigurationDto>;
    connectAccount(
      input: ConnectAgentAccountInput,
    ): Promise<AgentConfigurationDto>;
    disconnectAccount(
      input: ConnectAgentAccountInput,
    ): Promise<AgentConfigurationDto>;
    /** Chat-capable models from the selected vendor; secrets stay main-side. */
    listModels(input: ListAgentModelsInput): Promise<AgentModelListDto>;
    run(input: RunAgentInput): Promise<void>;
    /** Streams a summary of the given chat messages into the thread. */
    runChatSummary(input: RunChatAgentInput): Promise<void>;
    /** Streams decisions / open questions / action items into the thread. */
    runChatExtraction(input: RunChatAgentInput): Promise<void>;
    /**
     * Assembles and redacts the exact message payload a scoped run would
     * send to the model, without running anything. WYSIWYS: the preview is
     * the payload.
     */
    previewContext(
      input: AgentContextScopeInput,
    ): Promise<AgentContextPreviewDto>;
    /** Local audit trail of past runs, newest first. */
    listAuditRecords(): Promise<ReadonlyArray<AgentAuditRecordDto>>;
    onEvent(listener: (event: AGUIEvent) => void): () => void;
    listThreads(): Promise<AgentThreadListDto>;
    getThread(threadId: string): Promise<AgentThreadDto | null>;
    createThread(): Promise<AgentThreadDto>;
    selectThread(threadId: string): Promise<AgentThreadDto>;
    /** Trigger rules in creation order, both user- and agent-authored. */
    listTriggerRules(): Promise<ReadonlyArray<AgentTriggerRuleDto>>;
    saveTriggerRule(input: SaveTriggerRuleInput): Promise<AgentTriggerRuleDto>;
    removeTriggerRule(ruleId: string): Promise<void>;
    setTriggerRuleEnabled(
      ruleId: string,
      enabled: boolean,
    ): Promise<AgentTriggerRuleDto>;
    /** Scheduled tasks in creation order, both user- and agent-authored. */
    listScheduledTasks(): Promise<ReadonlyArray<AgentScheduledTaskDto>>;
    saveScheduledTask(
      input: SaveScheduledTaskInput,
    ): Promise<AgentScheduledTaskDto>;
    removeScheduledTask(taskId: string): Promise<void>;
    setScheduledTaskEnabled(
      taskId: string,
      enabled: boolean,
    ): Promise<AgentScheduledTaskDto>;
    /** Automation run outcomes (sent / parked in draft / failed). */
    onAutomationEvent(
      listener: (event: AgentAutomationEvent) => void,
    ): () => void;
  };
  readonly telegram: {
    getLoginConfiguration(): Promise<TelegramLoginConfigurationDto>;
    beginLogin(input: TelegramLoginInput): Promise<void>;
    submitChallenge(value: string): Promise<void>;
    getAuthState(): Promise<TelegramAuthState>;
    logout(): Promise<void>;
    onAuthState(listener: (state: TelegramAuthState) => void): () => void;
    /**
     * Every signed-in Telegram account on this device, in the order the
     * switcher shows them (most recently used first, the active one first).
     */
    listAccounts(): Promise<ReadonlyArray<TelegramAccountDto>>;
    /**
     * Makes another signed-in account the active one. Only the active account
     * stays connected — workspace events and every workspace method address
     * it alone, and the renderer reloads its workspace when the auth state
     * settles back to `"ready"`.
     */
    setActiveAccount(accountId: string): Promise<void>;
  };
  readonly shell: {
    /** `tag` is echoed back by `onNotificationClick` (e.g. a chat id). */
    notify(title: string, body: string, tag?: string): Promise<void>;
    onNotificationClick(listener: (tag: string) => void): () => void;
  };
  readonly preferences: {
    get(): Promise<UserPreferencesDto>;
    update(input: UpdateUserPreferencesInput): Promise<UserPreferencesDto>;
  };
  readonly storage: {
    /** Bytes currently held by the on-disk media cache. */
    mediaCacheUsage(): Promise<number>;
    /** Empties the media cache and answers the reclaimed byte count. */
    clearMediaCache(): Promise<number>;
  };
}
