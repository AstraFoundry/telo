/**
 * Telegram chat vocabulary: dialogs, folders, members, and list paging.
 * Contracts re-exports these so the wire surface and the domain share one source.
 */
export type ChatKind = "direct" | "group" | "channel" | "saved" | "secret";

/**
 * TDLib empty userpic: one grapheme (letter or emoji) on the peer's accent
 * colors. Built-in ids 0–6 are theme reds/oranges/…; higher ids come from
 * `updateAccentColors`. Used only when there is no profile/chat photo.
 */
export interface AvatarPlaceholderDto {
  readonly glyph: string;
  readonly lightColors: ReadonlyArray<string>;
  readonly darkColors: ReadonlyArray<string>;
}

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
  /**
   * False when the account cannot send plain text (channel subscriber, left
   * group, restricted member, deleted user, unready secret chat). Omitted
   * means writable, matching demo fixtures and older events.
   */
  readonly canSendMessages?: boolean;
  /**
   * False when stickers/GIFs/`can_send_other_messages` is off. Omitted
   * follows `canSendMessages`.
   */
  readonly canSendStickers?: boolean;
  /**
   * False when photos, videos, and documents are all disallowed. Omitted
   * follows `canSendMessages`.
   */
  readonly canSendMedia?: boolean;
  readonly initials: string;
  /**
   * Profile photo URL (`telo-media://` or a data URL). Null when Telegram has
   * no photo, or the cache has not resolved yet — see `avatarPending`.
   */
  readonly avatarDataUrl: string | null;
  /**
   * True until a disk/memory cache hit or the Telegram download settles.
   * The avatar slot shows a skeleton while this is set, unless a
   * placeholder can paint immediately.
   */
  readonly avatarPending?: boolean;
  /**
   * Empty userpic from TDLib `accent_color_id` plus the first grapheme of
   * the title. Painted when `avatarDataUrl` is null.
   */
  readonly avatarPlaceholder?: AvatarPlaceholderDto | null;
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
  /**
   * TDLib `chatPosition.order` (uint64 decimal string). Higher sorts first.
   * Absent on demo fixtures that keep array order.
   */
  readonly listOrder?: string;
  /**
   * Secret-chat handshake. Absent on every non-secret chat.
   */
  readonly secretState?: "pending" | "ready" | "closed";
}

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

/**
 * Create/edit payload for a native Telegram dialog filter (TDLib
 * `createChatFolder` / `editChatFolder`). tdesktop's folder editor collects a
 * name plus the chats the folder always includes; the other filter flags
 * (contacts/groups/channels, exclude muted/read/archived) are preserved by
 * the adapter on edit and default to off on create.
 */
export interface ChatFolderInput {
  readonly title: string;
  /** Chats the folder always includes, as chat ids. */
  readonly chatIds: ReadonlyArray<string>;
}

export interface UpdateChatFolderInput extends ChatFolderInput {
  /** Telegram dialog filter id; the Archive (`ARCHIVE_FOLDER_ID`) is not editable. */
  readonly id: number;
}

/**
 * One native folder's edit state: the title plus the chats it always
 * includes. `updateChatFolders` carries only `chatFolderInfo` (id, name,
 * icon), so the edit dialog reads membership through this lookup — TDLib's
 * `getChatFolder` — instead of the folder list.
 */
export interface ChatFolderDetailsDto {
  readonly id: number;
  readonly title: string;
  /**
   * Pinned and always-included chats, as chat ids. tdesktop's editor shows
   * one "included chats" list; both TDLib lists feed it.
   */
  readonly includedChatIds: ReadonlyArray<string>;
}

/**
 * Opaque chat-list pagination token. Adapters encode their own offset;
 * the renderer round-trips the string and never reads fields from it.
 */
export type ChatPageCursorDto = string;

export interface ChatPageInput {
  readonly limit?: number;
  readonly cursor?: ChatPageCursorDto | null;
}

export interface ChatPageDto {
  readonly items: ReadonlyArray<ChatDto>;
  readonly nextCursor: ChatPageCursorDto | null;
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
  readonly avatarPlaceholder?: AvatarPlaceholderDto | null;
}

export interface CreateTelegramGroupInput {
  readonly title: string;
  readonly userIds: ReadonlyArray<string>;
}

export interface CreateTelegramChannelInput {
  readonly title: string;
  readonly description?: string;
}
