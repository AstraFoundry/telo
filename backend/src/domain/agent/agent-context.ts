import type { ChatDto } from "../telegram/chat";
import type { MessageDto } from "../telegram/message";

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

/**
 * One Telegram message assembled into an agent run's context. By the time a
 * message appears here it has passed the redaction pass, so this shape is
 * both the preview model and the gateway payload.
 */
export interface AgentScopedMessage {
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

/** The exact, redacted message set a scoped agent run sends to the model. */
export interface AgentScopedContext {
  readonly scope: AgentContextScope;
  readonly messages: ReadonlyArray<AgentScopedMessage>;
  readonly redactionCounts: AgentRedactionCounts;
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
