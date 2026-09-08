import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AGUIEvent } from "@ag-ui/core";

import type {
  ConnectAgentAccountInput,
  AgentAutomationEvent,
  ListAgentModelsInput,
  SaveAgentConfigurationInput,
  TeloDesktopApi,
  TelegramAuthState,
  TelegramWorkspaceEvent,
  UpdateUserPreferencesInput,
} from "../../../../contracts/src/ipc";
import { channels } from "./channels";

const api: TeloDesktopApi = {
  workspace: {
    getCurrentUser: () => ipcRenderer.invoke(channels.currentUserGet),
    listChatPage: (input) => ipcRenderer.invoke(channels.chatPageList, input),
    updateProfileName: (input) =>
      ipcRenderer.invoke(channels.profileNameUpdate, input),
    updateBio: (bio) => ipcRenderer.invoke(channels.bioUpdate, bio),
    checkUsernameAvailability: (username) =>
      ipcRenderer.invoke(channels.usernameAvailabilityCheck, username),
    setUsername: (username) =>
      ipcRenderer.invoke(channels.usernameSet, username),
    setProfilePhoto: async (file) => {
      const source = webUtils.getPathForFile(file);
      return ipcRenderer.invoke(channels.profilePhotoSet, {
        source,
        bytes: source ? undefined : new Uint8Array(await file.arrayBuffer()),
        name: file.name,
        mimeType: file.type,
        size: file.size,
      });
    },
    addContactByPhone: (input) =>
      ipcRenderer.invoke(channels.contactPhoneAdd, input),
    setPeerContact: (input) =>
      ipcRenderer.invoke(channels.peerContactSet, input),
    removePeerContact: (userId) =>
      ipcRenderer.invoke(channels.peerContactRemove, userId),
    createSecretChat: (userId) =>
      ipcRenderer.invoke(channels.secretChatCreate, userId),
    listContacts: () => ipcRenderer.invoke(channels.contactsList),
    openPrivateChat: (userId) =>
      ipcRenderer.invoke(channels.privateChatOpen, userId),
    createGroup: (input) => ipcRenderer.invoke(channels.groupCreate, input),
    createChannel: (input) => ipcRenderer.invoke(channels.channelCreate, input),
    listCalls: (cursor) => ipcRenderer.invoke(channels.callsList, cursor),
    postStory: async (file, input) => {
      const source = webUtils.getPathForFile(file);
      return ipcRenderer.invoke(
        channels.storyPost,
        {
          source,
          bytes: source ? undefined : new Uint8Array(await file.arrayBuffer()),
          name: file.name,
          mimeType: file.type,
          size: file.size,
        },
        input,
      );
    },
    openSavedMessages: () => ipcRenderer.invoke(channels.savedMessagesOpen),
    listFolders: () => ipcRenderer.invoke(channels.folderList),
    createKeywordFolder: (input) =>
      ipcRenderer.invoke(channels.keywordFolderCreate, input),
    updateKeywordFolder: (input) =>
      ipcRenderer.invoke(channels.keywordFolderUpdate, input),
    deleteKeywordFolder: (id) =>
      ipcRenderer.invoke(channels.keywordFolderDelete, id),
    listMessagePage: (chatId, input) =>
      ipcRenderer.invoke(channels.messagePageList, chatId, input),
    listSharedMedia: (chatId, input) =>
      ipcRenderer.invoke(channels.sharedMediaList, chatId, input),
    listPinnedMessages: (chatId) =>
      ipcRenderer.invoke(channels.pinnedMessageList, chatId),
    listChatMembers: (chatId) =>
      ipcRenderer.invoke(channels.chatMemberList, chatId),
    getPeerProfile: (peerId) =>
      ipcRenderer.invoke(channels.peerProfileGet, peerId),
    listStickerSets: () => ipcRenderer.invoke(channels.stickerSetList),
    getStickerCatalog: () => ipcRenderer.invoke(channels.stickerCatalogGet),
    reorderStickerSets: (setIds) =>
      ipcRenderer.invoke(channels.stickerSetReorder, setIds),
    setStickerFavorite: (stickerId, favorite) =>
      ipcRenderer.invoke(channels.stickerFavoriteSet, stickerId, favorite),
    removeRecentSticker: (stickerId) =>
      ipcRenderer.invoke(channels.stickerRecentRemove, stickerId),
    clearRecentStickers: () => ipcRenderer.invoke(channels.stickerRecentClear),
    searchStickers: (query) =>
      ipcRenderer.invoke(channels.stickerSearch, query),
    sendSticker: (chatId, stickerId, clientId) =>
      ipcRenderer.invoke(channels.stickerSend, chatId, stickerId, clientId),
    getStickerSet: (reference) =>
      ipcRenderer.invoke(channels.stickerSetGet, reference),
    setStickerSetInstalled: (shortName, installed) =>
      ipcRenderer.invoke(channels.stickerSetInstalledSet, shortName, installed),
    getCustomEmoji: (documentIds) =>
      ipcRenderer.invoke(channels.customEmojiGet, documentIds),
    searchGlobal: (query) => ipcRenderer.invoke(channels.searchGlobal, query),
    searchMessages: (chatId, query, input) =>
      ipcRenderer.invoke(channels.searchMessages, chatId, query, input),
    sendMessage: (chatId, body, input) =>
      ipcRenderer.invoke(channels.messageSend, chatId, body, input),
    downloadMedia: (mediaId) =>
      ipcRenderer.invoke(channels.mediaDownload, mediaId),
    cancelMediaDownload: (mediaId) =>
      ipcRenderer.invoke(channels.mediaDownloadCancel, mediaId),
    saveMediaAs: (mediaId, fileName) =>
      ipcRenderer.invoke(channels.mediaSaveAs, mediaId, fileName),
    openMedia: (mediaId) => ipcRenderer.invoke(channels.mediaOpen, mediaId),
    sendMedia: async (chatId, files, input) =>
      ipcRenderer.invoke(
        channels.mediaSend,
        chatId,
        // Files picked from disk carry an absolute path; pasted clipboard
        // files exist only in memory, so their bytes travel instead and main
        // stages them to a temp file before the upload.
        await Promise.all(
          files.map(async (file) => {
            const source = webUtils.getPathForFile(file);
            return {
              source,
              bytes: source
                ? undefined
                : new Uint8Array(await file.arrayBuffer()),
              name: file.name,
              mimeType: file.type,
              size: file.size,
            };
          }),
        ),
        input,
      ),
    cancelMediaUpload: (uploadId) =>
      ipcRenderer.invoke(channels.mediaUploadCancel, uploadId),
    editMessage: (input) => ipcRenderer.invoke(channels.messageEdit, input),
    deleteMessage: (input) => ipcRenderer.invoke(channels.messageDelete, input),
    forwardMessage: (input) =>
      ipcRenderer.invoke(channels.messageForward, input),
    setChatPinned: (chatId, pinned) =>
      ipcRenderer.invoke(channels.chatPinSet, chatId, pinned),
    setChatMuted: (chatId, muted) =>
      ipcRenderer.invoke(channels.chatMuteSet, chatId, muted),
    setChatRead: (chatId, read) =>
      ipcRenderer.invoke(channels.chatReadSet, chatId, read),
    setTyping: (chatId, typing) =>
      ipcRenderer.invoke(channels.chatTypingSet, chatId, typing),
    saveDraft: (chatId, text) =>
      ipcRenderer.invoke(channels.chatDraftSave, chatId, text),
    answerBotCallback: (chatId, messageId, buttonId) =>
      ipcRenderer.invoke(
        channels.botCallbackAnswer,
        chatId,
        messageId,
        buttonId,
      ),
    setMessageReaction: (input) =>
      ipcRenderer.invoke(channels.messageReactionSet, input),
    listAvailableReactions: (chatId, messageId) =>
      ipcRenderer.invoke(channels.messageReactionsAvailable, chatId, messageId),
    clickAnimatedEmoji: (chatId, messageId) =>
      ipcRenderer.invoke(channels.animatedEmojiClick, chatId, messageId),
    setChatArchived: (chatId, archived) =>
      ipcRenderer.invoke(channels.chatArchiveSet, chatId, archived),
    onEvent: (listener) =>
      subscribe<TelegramWorkspaceEvent>(channels.workspaceEvent, listener),
  },
  agent: {
    getConfiguration: () => ipcRenderer.invoke(channels.agentConfigGet),
    saveConfiguration: (input: SaveAgentConfigurationInput) =>
      ipcRenderer.invoke(channels.agentConfigSave, input),
    connectAccount: (input: ConnectAgentAccountInput) =>
      ipcRenderer.invoke(channels.agentAccountConnect, input),
    disconnectAccount: (input: ConnectAgentAccountInput) =>
      ipcRenderer.invoke(channels.agentAccountDisconnect, input),
    listModels: (input: ListAgentModelsInput) =>
      ipcRenderer.invoke(channels.agentModelsList, input),
    run: (input) => ipcRenderer.invoke(channels.agentRun, input),
    runChatSummary: (input) =>
      ipcRenderer.invoke(channels.agentRunChatSummary, input),
    runChatExtraction: (input) =>
      ipcRenderer.invoke(channels.agentRunChatExtraction, input),
    previewContext: (input) =>
      ipcRenderer.invoke(channels.agentContextPreview, input),
    listAuditRecords: () => ipcRenderer.invoke(channels.agentAuditList),
    onEvent: (listener) => subscribe<AGUIEvent>(channels.agentEvent, listener),
    listThreads: () => ipcRenderer.invoke(channels.agentThreadsList),
    getThread: (threadId) =>
      ipcRenderer.invoke(channels.agentThreadGet, threadId),
    createThread: () => ipcRenderer.invoke(channels.agentThreadCreate),
    selectThread: (threadId) =>
      ipcRenderer.invoke(channels.agentThreadSelect, threadId),
    listTriggerRules: () => ipcRenderer.invoke(channels.agentTriggerRulesList),
    saveTriggerRule: (input) =>
      ipcRenderer.invoke(channels.agentTriggerRuleSave, input),
    removeTriggerRule: (ruleId) =>
      ipcRenderer.invoke(channels.agentTriggerRuleRemove, ruleId),
    setTriggerRuleEnabled: (ruleId, enabled) =>
      ipcRenderer.invoke(channels.agentTriggerRuleEnable, ruleId, enabled),
    listScheduledTasks: () =>
      ipcRenderer.invoke(channels.agentScheduledTasksList),
    saveScheduledTask: (input) =>
      ipcRenderer.invoke(channels.agentScheduledTaskSave, input),
    removeScheduledTask: (taskId) =>
      ipcRenderer.invoke(channels.agentScheduledTaskRemove, taskId),
    setScheduledTaskEnabled: (taskId, enabled) =>
      ipcRenderer.invoke(channels.agentScheduledTaskEnable, taskId, enabled),
    onAutomationEvent: (listener) =>
      subscribe<AgentAutomationEvent>(channels.agentAutomationEvent, listener),
  },
  telegram: {
    getLoginConfiguration: () =>
      ipcRenderer.invoke(channels.telegramLoginConfiguration),
    beginLogin: (input) =>
      ipcRenderer.invoke(channels.telegramLoginBegin, input),
    submitChallenge: (value) =>
      ipcRenderer.invoke(channels.telegramChallengeSubmit, value),
    getAuthState: () => ipcRenderer.invoke(channels.telegramAuthGet),
    logout: () => ipcRenderer.invoke(channels.telegramLogout),
    onAuthState: (listener) =>
      subscribe<TelegramAuthState>(channels.telegramAuthEvent, listener),
    listAccounts: () => ipcRenderer.invoke(channels.telegramAccountsList),
    setActiveAccount: (accountId) =>
      ipcRenderer.invoke(channels.telegramAccountActivate, accountId),
  },
  shell: {
    frameless: process.platform === "linux",
    notify: (title, body, tag, options) =>
      ipcRenderer.invoke(channels.notify, title, body, tag, options),
    onNotificationClick: (listener) =>
      subscribe<string>(channels.notifyClick, listener),
    windowControl: (action) =>
      ipcRenderer.invoke(channels.windowControl, action),
  },
  preferences: {
    get: () => ipcRenderer.invoke(channels.preferencesGet),
    update: (input: UpdateUserPreferencesInput) =>
      ipcRenderer.invoke(channels.preferencesUpdate, input),
  },
  storage: {
    mediaCacheUsage: () => ipcRenderer.invoke(channels.storageMediaCacheUsage),
    clearMediaCache: () => ipcRenderer.invoke(channels.storageMediaCacheClear),
  },
};

contextBridge.exposeInMainWorld("telo", api);

function subscribe<T>(
  channel: string,
  listener: (payload: T) => void,
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) =>
    listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
