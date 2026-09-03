import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AGUIEvent } from "@ag-ui/core";

import type {
  ConnectAgentAccountInput,
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
    sendSticker: (chatId, stickerId) =>
      ipcRenderer.invoke(channels.stickerSend, chatId, stickerId),
    getStickerSet: (shortName) =>
      ipcRenderer.invoke(channels.stickerSetGet, shortName),
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
  },
  shell: {
    notify: (title, body, tag) =>
      ipcRenderer.invoke(channels.notify, title, body, tag),
    onNotificationClick: (listener) =>
      subscribe<string>(channels.notifyClick, listener),
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
