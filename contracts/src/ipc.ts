import type { AGUIEvent } from "@ag-ui/core";

export type ChatKind = "direct" | "group" | "channel" | "saved";

export interface ChatDto {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly updatedAt: string;
  readonly unreadCount: number;
  readonly muted: boolean;
  readonly pinned: boolean;
  readonly kind: ChatKind;
  readonly initials: string;
  /** Profile photo, when Telegram has one; null falls back to `initials`. */
  readonly avatarDataUrl: string | null;
  /** Server-synced draft text (e.g. typed on another Telegram client). */
  readonly draftPreview: string | null;
  /** Whether the other party is currently typing in this chat. */
  readonly typing: boolean;
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

export interface MessageReplyToDto {
  readonly id: string;
  readonly senderName: string;
  readonly body: string;
}

export interface MessageDto {
  readonly id: string;
  readonly chatId: string;
  readonly senderName: string;
  readonly body: string;
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
    };

export interface SendMessageInput {
  readonly replyToId?: string;
  /** Stable id minted by the renderer for optimistic-send reconciliation. */
  readonly clientId?: string;
}

export interface EditMessageInput {
  readonly chatId: string;
  readonly messageId: string;
  readonly body: string;
}

export interface DeleteMessageInput {
  readonly chatId: string;
  readonly messageId: string;
}

export interface ForwardMessageInput {
  readonly fromChatId: string;
  readonly messageId: string;
  readonly toChatId: string;
}

export interface CurrentUserDto {
  readonly id: string;
  readonly displayName: string;
  readonly username: string | null;
  readonly initials: string;
  readonly avatarDataUrl: string | null;
}

export interface AgentConfigurationDto {
  readonly provider: "openai" | "openai-compatible";
  readonly model: string;
  readonly baseUrl: string | null;
  readonly instructions: string;
  readonly hasApiKey: boolean;
  readonly canInspectWorkspace: boolean;
}

export interface SaveAgentConfigurationInput {
  readonly provider: AgentConfigurationDto["provider"];
  readonly model: string;
  readonly baseUrl?: string | null;
  readonly instructions: string;
  readonly apiKey?: string;
  readonly canInspectWorkspace: boolean;
}

export type ThemePreference = "light" | "dark" | "system";

export type AccentColorPreference =
  "blue" | "green" | "purple" | "red" | "orange";

export type TimeFormatPreference = "system" | "12h" | "24h";

export interface UserPreferencesDto {
  readonly agentPanelOpen: boolean;
  readonly demoWorkspace: boolean;
  readonly theme: ThemePreference;
  readonly accentColor: AccentColorPreference;
  readonly messageTextSize: number;
  readonly timeFormat: TimeFormatPreference;
  readonly sendWithEnter: boolean;
  readonly notificationsEnabled: boolean;
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

export type TelegramAuthState =
  | { readonly status: "idle" }
  | { readonly status: "connecting" }
  | { readonly status: "code-required" }
  | { readonly status: "password-required"; readonly hint: string | null }
  | { readonly status: "ready" }
  | { readonly status: "error"; readonly message: string };

export interface TeloDesktopApi {
  readonly workspace: {
    getCurrentUser(): Promise<CurrentUserDto>;
    listChatPage(input?: ChatPageInput): Promise<ChatPageDto>;
    listMessagePage(
      chatId: string,
      input?: MessagePageInput,
    ): Promise<MessagePageDto>;
    sendMessage(
      chatId: string,
      body: string,
      input?: SendMessageInput,
    ): Promise<MessageDto>;
    editMessage(input: EditMessageInput): Promise<void>;
    deleteMessage(input: DeleteMessageInput): Promise<void>;
    forwardMessage(input: ForwardMessageInput): Promise<void>;
    setChatPinned(chatId: string, pinned: boolean): Promise<void>;
    setChatMuted(chatId: string, muted: boolean): Promise<void>;
    setChatRead(chatId: string, read: boolean): Promise<void>;
    /** Sends (or cancels) the local user's typing signal for a chat. */
    setTyping(chatId: string, typing: boolean): Promise<void>;
    /** Persists the composer draft server-side; an empty string clears it. */
    saveDraft(chatId: string, text: string): Promise<void>;
    onEvent(listener: (event: TelegramWorkspaceEvent) => void): () => void;
  };
  readonly agent: {
    getConfiguration(): Promise<AgentConfigurationDto>;
    saveConfiguration(
      input: SaveAgentConfigurationInput,
    ): Promise<AgentConfigurationDto>;
    run(input: RunAgentInput): Promise<void>;
    onEvent(listener: (event: AGUIEvent) => void): () => void;
    listThreads(): Promise<AgentThreadListDto>;
    getThread(threadId: string): Promise<AgentThreadDto | null>;
    createThread(): Promise<AgentThreadDto>;
    selectThread(threadId: string): Promise<AgentThreadDto>;
  };
  readonly telegram: {
    getLoginConfiguration(): Promise<TelegramLoginConfigurationDto>;
    beginLogin(input: TelegramLoginInput): Promise<void>;
    submitChallenge(value: string): Promise<void>;
    getAuthState(): Promise<TelegramAuthState>;
    logout(): Promise<void>;
    onAuthState(listener: (state: TelegramAuthState) => void): () => void;
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
}
