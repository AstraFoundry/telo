import { contextBridge, ipcRenderer } from "electron";
import type { AGUIEvent } from "@ag-ui/core";

import type {
  SaveAgentConfigurationInput,
  TeloDesktopApi,
  TelegramAuthState,
  UpdateUserPreferencesInput,
} from "../../../../contracts/src/ipc";
import { channels } from "./channels";

const api: TeloDesktopApi = {
  workspace: {
    getCurrentUser: () => ipcRenderer.invoke(channels.currentUserGet),
    listChats: () => ipcRenderer.invoke(channels.chatsList),
    listMessages: (chatId) => ipcRenderer.invoke(channels.messagesList, chatId),
    sendMessage: (chatId, body, input) =>
      ipcRenderer.invoke(channels.messageSend, chatId, body, input),
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
  },
  agent: {
    getConfiguration: () => ipcRenderer.invoke(channels.agentConfigGet),
    saveConfiguration: (input: SaveAgentConfigurationInput) =>
      ipcRenderer.invoke(channels.agentConfigSave, input),
    run: (input) => ipcRenderer.invoke(channels.agentRun, input),
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
    notify: (title, body) => ipcRenderer.invoke(channels.notify, title, body),
  },
  preferences: {
    get: () => ipcRenderer.invoke(channels.preferencesGet),
    update: (input: UpdateUserPreferencesInput) =>
      ipcRenderer.invoke(channels.preferencesUpdate, input),
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
