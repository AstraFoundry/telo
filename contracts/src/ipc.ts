import type { AGUIEvent } from "@ag-ui/core";

// Vocabulary owned by the backend domain (docs/backend/domain.md): the
// domain declares these types and limits, and this module mirrors them so
// renderer, preload, and main keep a single import site.
export type {
  ChatKind,
  AvatarPlaceholderDto,
  ChatDto,
  ChatFolderKind,
  ChatFolderDto,
  ChatFolderDetailsDto,
  ChatFolderInput,
  UpdateChatFolderInput,
  ChatPageCursorDto,
  ChatPageInput,
  ChatPageDto,
  ChatMemberDto,
  CreateTelegramGroupInput,
  CreateTelegramChannelInput,
} from "../../backend/src/domain/telegram/chat";
export type {
  UpdateProfileNameInput,
  UsernameAvailability,
  CurrentUserDto,
  PeerProfileDto,
} from "../../backend/src/domain/telegram/profile";
export type {
  TelegramContactDto,
  AddContactByPhoneInput,
  SetPeerContactInput,
} from "../../backend/src/domain/telegram/contact";
export type {
  MessageCallStatus,
  MessageCallDto,
  TelegramCallKind,
  TelegramCallDto,
  TelegramCallPageDto,
} from "../../backend/src/domain/telegram/call";
export type {
  MessagePollKind,
  MessagePollOptionDto,
  MessagePollDto,
  SendPollInput,
} from "../../backend/src/domain/telegram/poll";
export {
  POLL_OPTIONS_MIN,
  POLL_OPTIONS_MAX,
} from "../../backend/src/domain/telegram/poll";
export type {
  StoryPrivacy,
  StoryActivePeriod,
  PostStoryInput,
  PostedStoryDto,
} from "../../backend/src/domain/telegram/story";
export type {
  StickerFormat,
  StickerSetReferenceDto,
  StickerRole,
  MessageStickerDto,
  StickerItemDto,
  AnimatedEmojiEffectDto,
  StickerSetSummaryDto,
  StickerSetDto,
  StickerCatalogDto,
} from "../../backend/src/domain/telegram/sticker";
export type {
  MessageEntityDto,
  MessageReplyToDto,
  MessageMediaKind,
  MessageButtonKind,
  MessageButtonDto,
  MessageKeyboardDto,
  BotCallbackAnswerDto,
  MessageForwardDto,
  MessageFileMediaDto,
  MessageWebPageMediaDto,
  MessageMediaDto,
  MessageReactionDto,
  MessageDto,
  MessagePageInput,
  MessagePageDto,
  GlobalSearchResultDto,
  MessageSearchPageInput,
  MessageSearchPageDto,
  EditMessageInput,
  DeleteMessageScope,
  DeleteMessageInput,
  SetMessageReactionInput,
  ForwardMessageInput,
  PinMessageInput,
} from "../../backend/src/domain/telegram/message";
export type { TelegramWorkspaceEvent } from "../../backend/src/domain/telegram/workspace-event";
export type {
  AgentProvider,
  AgentOAuthProvider,
  AgentAuthKind,
} from "../../backend/src/domain/agent/agent-providers";
export {
  AGENT_TEMPERATURE_MIN,
  AGENT_TEMPERATURE_MAX,
  AGENT_MAX_STEPS_MIN,
  AGENT_MAX_STEPS_MAX,
  AGENT_HISTORY_LIMIT_MIN,
  AGENT_HISTORY_LIMIT_MAX,
  FIRST_CLASS_AGENT_PROVIDERS,
  AGENT_COMPATIBLE_PROVIDER,
  AGENT_PROVIDERS,
  AGENT_OAUTH_PROVIDERS,
  agentProviderSupportsOAuth,
  agentOAuthIsConfigured,
  AGENT_PROVIDER_DEFAULT_MODEL,
  isAgentProvider,
} from "../../backend/src/domain/agent/agent-providers";
export type {
  AgentContextScope,
  AgentRedactionCounts,
  UiContextSnapshot,
} from "../../backend/src/domain/agent/agent-context";
export type { AgentDeliveryMode } from "../../backend/src/domain/agent/agent-automation";
export type {
  AccentColorPreference,
  ChatWallpaperPreference,
  MessageTemplateDto,
  ThemePreference,
  TimeFormatPreference,
} from "../../backend/src/domain/preferences/user-preferences";

import type { AgentDeliveryMode } from "../../backend/src/domain/agent/agent-automation";
import type {
  AgentContextScope,
  AgentRedactionCounts,
  UiContextSnapshot,
} from "../../backend/src/domain/agent/agent-context";
import type {
  AgentAuthKind,
  AgentOAuthProvider,
  AgentProvider,
} from "../../backend/src/domain/agent/agent-providers.ts";
import type {
  AccentColorPreference,
  ChatWallpaperPreference,
  MessageTemplateDto,
  ThemePreference,
  TimeFormatPreference,
} from "../../backend/src/domain/preferences/user-preferences";
import type { TelegramCallPageDto } from "../../backend/src/domain/telegram/call.ts";
import type {
  AvatarPlaceholderDto,
  ChatDto,
  ChatFolderDetailsDto,
  ChatFolderDto,
  ChatFolderInput,
  ChatMemberDto,
  ChatPageDto,
  ChatPageInput,
  CreateTelegramChannelInput,
  CreateTelegramGroupInput,
  UpdateChatFolderInput,
} from "../../backend/src/domain/telegram/chat.ts";
import type {
  AddContactByPhoneInput,
  SetPeerContactInput,
  TelegramContactDto,
} from "../../backend/src/domain/telegram/contact.ts";
import type {
  BotCallbackAnswerDto,
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
  GlobalSearchResultDto,
  MessageDto,
  MessageEntityDto,
  MessagePageDto,
  MessagePageInput,
  MessageSearchPageDto,
  MessageSearchPageInput,
  PinMessageInput,
  SetMessageReactionInput,
} from "../../backend/src/domain/telegram/message.ts";
import type { SendPollInput } from "../../backend/src/domain/telegram/poll.ts";
import type {
  CurrentUserDto,
  PeerProfileDto,
  UpdateProfileNameInput,
  UsernameAvailability,
} from "../../backend/src/domain/telegram/profile.ts";
import type {
  AnimatedEmojiEffectDto,
  StickerCatalogDto,
  StickerItemDto,
  StickerSetDto,
  StickerSetReferenceDto,
} from "../../backend/src/domain/telegram/sticker.ts";
import type {
  PostStoryInput,
  PostedStoryDto,
} from "../../backend/src/domain/telegram/story.ts";
import type { TelegramWorkspaceEvent } from "../../backend/src/domain/telegram/workspace-event.ts";

/** Reserved Telegram folder id for the Archive. */
export const ARCHIVE_FOLDER_ID = 1;

export interface KeywordFolderInput {
  readonly title: string;
  readonly query: string;
}

export interface UpdateKeywordFolderInput extends KeywordFolderInput {
  readonly id: number;
}

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
   * Unix seconds of the scheduled delivery (TDLib `sendMessage`'s
   * `scheduling_state`). The message lands in the chat's scheduled list
   * instead of the live transcript and is delivered server-side.
   */
  readonly sendAt?: number;
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
  /**
   * Marks the send as a composer-recorded voice note: the staged file list
   * carries exactly one audio recording and the adapter sends TDLib
   * `inputMessageVoiceNote` instead of deriving the content type from the
   * MIME type. `durationSeconds` is the recorder's wall-clock duration.
   */
  readonly voiceNote?: { readonly durationSeconds: number };
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
  /** Backdrop drawn behind the transcript. */
  readonly chatWallpaper: ChatWallpaperPreference;
  /** Message notifications are raised for one-to-one chats. */
  readonly notifyDirectChats: boolean;
  /** Message notifications are raised for groups. */
  readonly notifyGroupChats: boolean;
  /** Message notifications are raised for channels. */
  readonly notifyChannels: boolean;
  /** Message notifications ring; when off the banner arrives silently. */
  readonly notificationSound: boolean;
  /** Photos fetch themselves as their bubble scrolls into view. */
  readonly autoDownloadPhotos: boolean;
  /** Videos and animations fetch themselves as their bubble scrolls in. */
  readonly autoDownloadVideos: boolean;
  /** Documents and other files fetch themselves as their bubble scrolls in. */
  readonly autoDownloadFiles: boolean;
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
  readonly chatWallpaper?: ChatWallpaperPreference;
  readonly notifyDirectChats?: boolean;
  readonly notifyGroupChats?: boolean;
  readonly notifyChannels?: boolean;
  readonly notificationSound?: boolean;
  readonly autoDownloadPhotos?: boolean;
  readonly autoDownloadVideos?: boolean;
  readonly autoDownloadFiles?: boolean;
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

export interface AgentContextPreviewDto {
  readonly scope: AgentContextScope;
  readonly messages: ReadonlyArray<AgentContextMessageDto>;
  readonly redactionCounts: AgentRedactionCounts;
}

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
  readonly avatarPlaceholder?: AvatarPlaceholderDto | null;
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

/** Extra shaping for a desktop notification the shell raises. */
export interface ShellNotifyOptions {
  /** Suppress the notification sound; the banner still arrives. */
  readonly silent?: boolean;
}

export interface TeloDesktopApi {
  readonly workspace: {
    getCurrentUser(): Promise<CurrentUserDto>;
    listChatPage(input?: ChatPageInput): Promise<ChatPageDto>;
    /**
     * Renames the account (Telegram `setName`) and returns the refreshed
     * identity. First name must be non-empty.
     */
    updateProfileName(input: UpdateProfileNameInput): Promise<CurrentUserDto>;
    /**
     * Sets the account bio (Telegram `setBio`); an empty string clears it.
     * The editor owns the draft, so this resolves void on success.
     */
    updateBio(bio: string): Promise<void>;
    /**
     * Checks a personal username against Telegram (`checkChatUsername` on
     * the Saved Messages chat) without claiming it.
     */
    checkUsernameAvailability(username: string): Promise<UsernameAvailability>;
    /**
     * Claims or replaces the account username (Telegram `setUsername`);
     * an empty string removes it. Returns the refreshed identity.
     */
    setUsername(username: string): Promise<CurrentUserDto>;
    /**
     * Replaces the account profile photo (Telegram `setProfilePhoto` from an
     * uploaded `inputFileLocal`) and returns the refreshed identity.
     */
    setProfilePhoto(file: File): Promise<CurrentUserDto>;
    /**
     * Phone-first contact creation (Telegram `importContacts`), tdesktop's
     * AddContactBox. Resolves to the imported contact, or null when the
     * number is not registered on Telegram (the "not joined" retry state).
     */
    addContactByPhone(
      input: AddContactByPhoneInput,
    ): Promise<TelegramContactDto | null>;
    /**
     * Adds or edits a known peer as a contact (Telegram `addContact`),
     * tdesktop's EditContactBox. `sharePhoneNumber` maps to
     * `share_phone_number` — the privacy exception offered when the peer's
     * profile sets `needPhonePrivacyException`.
     */
    setPeerContact(input: SetPeerContactInput): Promise<void>;
    /** Removes a peer from the contact list (Telegram `removeContacts`). */
    removePeerContact(userId: string): Promise<void>;
    /**
     * Starts a device-local end-to-end encrypted secret chat with `userId`.
     */
    createSecretChat(userId: string): Promise<ChatDto>;
    listContacts(): Promise<ReadonlyArray<TelegramContactDto>>;
    openPrivateChat(userId: string): Promise<ChatDto>;
    createGroup(input: CreateTelegramGroupInput): Promise<ChatDto>;
    createChannel(input: CreateTelegramChannelInput): Promise<ChatDto>;
    listCalls(cursor?: string | null): Promise<TelegramCallPageDto>;
    postStory(file: File, input: PostStoryInput): Promise<PostedStoryDto>;
    /**
     * Opens Saved Messages even when that chat is not in the loaded dialog
     * page. The Saved Messages chat id is the current account's user id.
     */
    openSavedMessages(): Promise<ChatDto>;
    /**
     * Lists the chat folders (custom folders plus the Archive when it holds
     * chats, plus local keyword folders) with server-computed unread counts.
     * The implicit "All chats" view is not part of the list.
     */
    listFolders(): Promise<ReadonlyArray<ChatFolderDto>>;
    /**
     * One native folder's edit state (title plus included chats) for the
     * folder editor (TDLib `getChatFolder`); null for an unknown id.
     */
    getChatFolder(folderId: number): Promise<ChatFolderDetailsDto | null>;
    /** Creates a server-synced chat folder (TDLib `createChatFolder`). */
    createChatFolder(input: ChatFolderInput): Promise<ChatFolderDto>;
    /** Renames a server folder and replaces its included chats (TDLib `editChatFolder`). */
    editChatFolder(input: UpdateChatFolderInput): Promise<ChatFolderDto>;
    /** Deletes a server folder (TDLib `deleteChatFolder`); chats stay in the main list. */
    deleteChatFolder(folderId: number): Promise<void>;
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
     * The chat's scheduled messages, soonest delivery first (TDLib
     * `getChatScheduledMessages`). Deleting one goes through the regular
     * `deleteMessage`; both adapters refresh the `scheduled-messages`
     * workspace event.
     */
    listScheduledMessages(chatId: string): Promise<ReadonlyArray<MessageDto>>;
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
    /** Installed sets plus the account's recent and favorite stickers. */
    getStickerCatalog(): Promise<StickerCatalogDto>;
    /** Persists the complete installed-set order. */
    reorderStickerSets(setIds: ReadonlyArray<string>): Promise<void>;
    /** Adds or removes a sticker from the account's favorites. */
    setStickerFavorite(stickerId: string, favorite: boolean): Promise<void>;
    /** Removes one sticker from the account's recent list. */
    removeRecentSticker(stickerId: string): Promise<void>;
    /** Clears the account's recent sticker list. */
    clearRecentStickers(): Promise<void>;
    /** Searches Telegram's global sticker index by emoji or keyword. */
    searchStickers(query: string): Promise<ReadonlyArray<StickerItemDto>>;
    /** Sends one sticker from an installed set into a chat. */
    sendSticker(
      chatId: string,
      stickerId: string,
      clientId?: string,
    ): Promise<MessageDto>;
    /** Resolves one installed or received sticker set on demand. */
    getStickerSet(reference: StickerSetReferenceDto): Promise<StickerSetDto>;
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
     * Pins or unpins a message in its chat. `silent` (default true, like
     * tdesktop's group pin dialog) suppresses the notification; the pin
     * strip refreshes from the pushed `pinned-messages` workspace event.
     */
    pinMessage(input: PinMessageInput): Promise<void>;
    /**
     * Adds or removes this account's reaction on a message. `remove` takes
     * the named emoji back; otherwise it is added.
     */
    setMessageReaction(input: SetMessageReactionInput): Promise<void>;
    /**
     * Sets this account's answer on a poll (TDLib `setPollAnswer`).
     * `optionIds` are 0-based option indexes; an empty list retracts the
     * answer. The updated tally arrives as an edited-message upsert.
     */
    setMessagePollAnswer(
      chatId: string,
      messageId: string,
      optionIds: ReadonlyArray<number>,
    ): Promise<void>;
    /**
     * Creates a poll in the chat (TDLib `sendMessage` with
     * `inputMessagePoll`) — tdesktop's attach menu → Poll. Deliberately off
     * the text send path: a poll carries no message body.
     */
    sendPoll(chatId: string, input: SendPollInput): Promise<MessageDto>;
    /**
     * Emoji this message (or chat, when `messageId` is omitted) allows as
     * reactions, in Telegram's own order (`getMessageAvailableReactions`).
     * The picker renders exactly this list.
     */
    listAvailableReactions(
      chatId: string,
      messageId?: string,
    ): Promise<ReadonlyArray<string>>;
    /**
     * Tells Telegram an animated-emoji message was clicked and answers with
     * the oversized sticker to play over the transcript, or null when
     * Telegram has no effect for it and the bubble's own animation should
     * simply replay (TDLib answers that case with a 404, not an error).
     */
    clickAnimatedEmoji(
      chatId: string,
      messageId: string,
    ): Promise<AnimatedEmojiEffectDto | null>;
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
    /** True when the window has no native title bar (Linux frameless). */
    readonly frameless: boolean;
    /** `tag` is echoed back by `onNotificationClick` (e.g. a chat id). */
    notify(
      title: string,
      body: string,
      tag?: string,
      options?: ShellNotifyOptions,
    ): Promise<void>;
    onNotificationClick(listener: (tag: string) => void): () => void;
    windowControl(action: "minimize" | "maximize" | "close"): Promise<void>;
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
