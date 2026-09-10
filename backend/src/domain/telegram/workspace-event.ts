import type { ChatDto, ChatFolderDto, ChatPageCursorDto } from "./chat";
import type { MessageDto, MessageReactionDto } from "./message";
import type { AnimatedEmojiEffectDto } from "./sticker";

/**
 * Workspace events pushed from the repository to subscribers.
 */

export type TelegramWorkspaceEvent =
  | {
      /** Installed order, recent stickers, or favorites changed. */
      readonly type: "sticker-catalog-changed";
    }
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
      /**
       * The chat's scheduled-message set changed (a message was scheduled,
       * deleted, or delivered); reload the scheduled list. Mirrors the
       * pinned-messages signal.
       */
      readonly type: "scheduled-messages";
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
      /**
       * The peer clicked an animated emoji of theirs; play the effect over
       * that message if it is on screen. Telegram pushes this so both sides
       * see the same burst at the same moment.
       */
      readonly type: "animated-emoji-clicked";
      readonly effect: AnimatedEmojiEffectDto;
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
       * `setMessageReaction` or from `updateMessageInteractionInfo`.
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
      /**
       * The account's own profile changed (name, bio, username, photo) —
       * from a local edit or another client. Reload `getCurrentUser`.
       */
      readonly type: "current-user";
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
