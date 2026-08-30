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
  /** Profile photo, when Telegram has one; null falls back to `initials`. */
  readonly avatarDataUrl: string | null;
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

export interface MessageDto {
  readonly id: string;
  readonly chatId: string;
  readonly senderName: string;
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
   * Sender attribution of a forwarded message (Telegram `fwdFrom`): the
   * original author's display name. Null/absent for ordinary messages and
   * for forwards sent with the sender hidden.
   */
  readonly forwardedFrom?: string | null;
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
      readonly avatarDataUrl: string;
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
  /** Quick replies the composer can insert into a draft. */
  readonly messageTemplates: ReadonlyArray<MessageTemplateDto>;
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
  readonly messageTemplates?: ReadonlyArray<MessageTemplateDto>;
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
