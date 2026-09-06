import type { AGUIEvent } from "@ag-ui/core";
import { vi, type Mock } from "vitest";

import type {
  SendMediaInput,
  TelegramWorkspaceEvent,
  TeloDesktopApi,
  StickerSetReferenceDto,
} from "../../../../contracts/src/ipc";

type MockedFunctions<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown
    ? Mock<T[K]>
    : MockedFunctions<T[K]>;
};

export type TeloApiMock = MockedFunctions<TeloDesktopApi> & {
  /** Broadcasts a workspace event to every listener registered via onEvent. */
  emitWorkspaceEvent(event: TelegramWorkspaceEvent): void;
  /** Broadcasts an AG-UI event to every listener registered via onEvent. */
  emitAgentEvent(event: AGUIEvent): void;
};

type MediaUploadState = Extract<
  TelegramWorkspaceEvent,
  { type: "media-upload" }
>["state"];

/**
 * Installs a vi.fn()-backed `window.telo` preload contract mock and returns it
 * so tests can stub resolved/rejected values per case. The default sendMedia
 * and cancelMediaUpload implementations emit the matching media-upload events
 * (uploading → ready, and cancelled) to listeners registered through onEvent,
 * mirroring the main process, so store upload tracking is testable end to end.
 */
export function installTeloApiMock(): TeloApiMock {
  const workspaceListeners = new Set<(event: TelegramWorkspaceEvent) => void>();
  const emitWorkspaceEvent = (event: TelegramWorkspaceEvent) => {
    for (const listener of workspaceListeners) listener(event);
  };
  const agentListeners = new Set<(event: AGUIEvent) => void>();
  const emitAgentEvent = (event: AGUIEvent) => {
    for (const listener of agentListeners) listener(event);
  };
  const emitUpload = (
    uploadId: string,
    state: MediaUploadState,
    progress: number,
  ) => {
    emitWorkspaceEvent({
      type: "media-upload",
      uploadId,
      state,
      progress,
      error: null,
    });
  };
  const api: TeloApiMock = {
    workspace: {
      getCurrentUser: vi.fn(),
      listChatPage: vi.fn(async () => ({ items: [], nextCursor: null })),
      createSecretChat: vi.fn(async (userId: string) => ({
        id: `secret-${userId}`,
        title: "Secret",
        preview: "",
        updatedAt: "2026-01-01T00:00:00.000Z",
        unreadCount: 0,
        lastReadMessageId: null,
        muted: false,
        pinned: false,
        kind: "secret" as const,
        initials: "S",
        avatarDataUrl: null,
        draftPreview: null,
        typing: false,
        secretState: "pending" as const,
      })),
      openSavedMessages: vi.fn(async () => ({
        id: "saved",
        title: "Saved Messages",
        preview: "",
        updatedAt: "2026-01-01T00:00:00.000Z",
        unreadCount: 0,
        lastReadMessageId: null,
        muted: false,
        pinned: false,
        kind: "saved" as const,
        initials: "SM",
        avatarDataUrl: null,
        draftPreview: null,
        typing: false,
      })),
      listFolders: vi.fn(async () => []),
      createKeywordFolder: vi.fn(async () => ({
        id: -1,
        title: "Spacing",
        unreadCount: 0,
        kind: "keyword" as const,
        query: "spacing",
      })),
      updateKeywordFolder: vi.fn(async () => ({
        id: -1,
        title: "Spacing",
        unreadCount: 0,
        kind: "keyword" as const,
        query: "spacing",
      })),
      deleteKeywordFolder: vi.fn(async () => undefined),
      listMessagePage: vi.fn(async () => ({ items: [], nextCursor: null })),
      listSharedMedia: vi.fn(async () => ({ items: [], nextCursor: null })),
      listPinnedMessages: vi.fn(async () => []),
      listChatMembers: vi.fn(async () => []),
      getPeerProfile: vi.fn(async (peerId: string) => ({
        id: peerId,
        title: "Peer",
        username: null,
        kind: "direct" as const,
        avatarDataUrl: null,
        bio: null,
        phone: null,
      })),
      listStickerSets: vi.fn(async () => []),
      getStickerCatalog: vi.fn(async () => ({
        recent: [],
        favorites: [],
        sets: [],
      })),
      reorderStickerSets: vi.fn(async () => undefined),
      setStickerFavorite: vi.fn(async () => undefined),
      removeRecentSticker: vi.fn(async () => undefined),
      clearRecentStickers: vi.fn(async () => undefined),
      searchStickers: vi.fn(async () => []),
      sendSticker: vi.fn(async (chatId: string) => ({
        id: "sticker-message",
        chatId,
        senderName: "You",
        senderId: "demo-you",
        senderAvatarUrl: null,
        body: "",
        entities: [],
        media: null,
        groupedId: null,
        sentAt: new Date(0).toISOString(),
        outgoing: true,
        status: "sent" as const,
      })),
      getStickerSet: vi.fn(async (reference: StickerSetReferenceDto) => ({
        id: "sticker-set",
        title: "Telo Pack",
        shortName:
          reference.kind === "short-name" ? reference.shortName : "TeloPack",
        reference,
        stickers: [],
        installed: true,
      })),
      getCustomEmoji: vi.fn(async () => []),
      setStickerSetInstalled: vi.fn(async () => undefined),
      searchGlobal: vi.fn(async () => ({ chats: [], messages: [] })),
      searchMessages: vi.fn(async () => ({
        messageIds: [],
        totalCount: 0,
        nextCursor: null,
      })),
      sendMessage: vi.fn(),
      downloadMedia: vi.fn(),
      cancelMediaDownload: vi.fn(),
      saveMediaAs: vi.fn(),
      openMedia: vi.fn(),
      sendMedia: vi.fn(
        async (
          _chatId: string,
          _files: ReadonlyArray<File>,
          input: SendMediaInput,
        ) => {
          emitUpload(input.uploadId, "uploading", 0);
          emitUpload(input.uploadId, "ready", 1);
          return [];
        },
      ),
      cancelMediaUpload: vi.fn(async (uploadId: string) => {
        emitUpload(uploadId, "cancelled", 0);
      }),
      editMessage: vi.fn(),
      deleteMessage: vi.fn(),
      forwardMessage: vi.fn(),
      setMessageReaction: vi.fn(),
      listAvailableReactions: vi.fn(async () => [] as ReadonlyArray<string>),
      setChatPinned: vi.fn(),
      setChatMuted: vi.fn(),
      setChatRead: vi.fn(),
      setChatArchived: vi.fn(),
      setTyping: vi.fn(),
      saveDraft: vi.fn(),
      answerBotCallback: vi.fn(async () => ({ kind: "none" }) as const),
      onEvent: vi.fn((listener: (event: TelegramWorkspaceEvent) => void) => {
        workspaceListeners.add(listener);
        return () => {
          workspaceListeners.delete(listener);
        };
      }),
    },
    agent: {
      getConfiguration: vi.fn(),
      saveConfiguration: vi.fn(),
      connectAccount: vi.fn(),
      disconnectAccount: vi.fn(),
      listModels: vi.fn(async () => ({ models: [] })),
      run: vi.fn(),
      runChatSummary: vi.fn(),
      runChatExtraction: vi.fn(),
      onEvent: vi.fn((listener: (event: AGUIEvent) => void) => {
        agentListeners.add(listener);
        return () => {
          agentListeners.delete(listener);
        };
      }),
      listThreads: vi.fn(),
      getThread: vi.fn(),
      createThread: vi.fn(),
      selectThread: vi.fn(),
      listTriggerRules: vi.fn(async () => []),
      saveTriggerRule: vi.fn(),
      removeTriggerRule: vi.fn(),
      setTriggerRuleEnabled: vi.fn(),
      listScheduledTasks: vi.fn(async () => []),
      saveScheduledTask: vi.fn(),
      removeScheduledTask: vi.fn(),
      setScheduledTaskEnabled: vi.fn(),
      onAutomationEvent: vi.fn(() => () => {}),
      previewContext: vi.fn(async () => ({
        scope: "unread" as const,
        messages: [],
        redactionCounts: { emails: 0, phones: 0, tokens: 0 },
      })),
      listAuditRecords: vi.fn(async () => []),
    },
    telegram: {
      getLoginConfiguration: vi.fn(),
      beginLogin: vi.fn(),
      submitChallenge: vi.fn(),
      getAuthState: vi.fn(),
      listAccounts: vi.fn(async () => []),
      setActiveAccount: vi.fn(),
      logout: vi.fn(),
      onAuthState: vi.fn(() => () => {}),
    },
    shell: {
      frameless: false,
      notify: vi.fn(),
      onNotificationClick: vi.fn(() => () => {}),
      windowControl: vi.fn(),
    },
    preferences: {
      get: vi.fn(async () => ({
        agentPanelOpen: false,
        demoWorkspace: false,
        theme: "system",
        accentColor: "blue",
        messageTextSize: 14,
        timeFormat: "system",
        sendWithEnter: true,
        notificationsEnabled: true,
        sidebarWidth: 280,
        agentPanelWidth: 380,
        recentEmojis: [],
        recentSearches: [],
        messageTemplates: [],
        reduceMotion: false,
        loopStickers: true,
        notificationSenderName: true,
        notificationPreview: true,
        countMutedChats: false,
        mediaCacheLimitMb: 512,
      })),
      update: vi.fn(),
    },
    storage: {
      mediaCacheUsage: vi.fn(async () => 0),
      clearMediaCache: vi.fn(async () => 0),
    },
    emitWorkspaceEvent,
    emitAgentEvent,
  };
  window.telo = api;
  return api;
}
