import { EventType, type AGUIEvent } from "@ag-ui/core";
import path from "node:path";
import { tmpdir } from "node:os";
import { copyFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import {
  ipcMain,
  dialog,
  shell,
  Notification,
  type WebContents,
} from "electron";

import type {
  DeleteMessageInput,
  AgentContextScopeInput,
  AgentScheduledTaskDto,
  ChatPageInput,
  ConnectAgentAccountInput,
  ListAgentModelsInput,
  EditMessageInput,
  ForwardMessageInput,
  MessagePageInput,
  MessageSearchPageInput,
  KeywordFolderInput,
  LocalMediaFileInput,
  RunAgentInput,
  RunChatAgentInput,
  SaveAgentConfigurationInput,
  SaveScheduledTaskInput,
  SaveTriggerRuleInput,
  SendMessageInput,
  SendMediaInput,
  SetMessageReactionInput,
  StickerSetReferenceDto,
  TelegramLoginInput,
  UpdateKeywordFolderInput,
  UpdateUserPreferencesInput,
} from "../../../../contracts/src/ipc";
import {
  AGENT_SUGGESTIONS_EVENT_NAME,
  type AgentSuggestionsPayload,
  MESSAGE_ACTION_EVENT_NAME,
} from "../../../../contracts/src/ipc";
import type { AgentOutput } from "../../domain/agent/agent-ports";
import type { AgentScheduledTask } from "../../domain/agent/agent-scheduled-task";
import type { ApplicationContainer } from "./container";
import { channels } from "./channels";

export function registerIpc(container: ApplicationContainer): void {
  ipcMain.handle(channels.currentUserGet, () =>
    container.workspace.getCurrentUser(),
  );
  ipcMain.handle(channels.chatPageList, (_event, input?: ChatPageInput) =>
    container.workspace.listChatPage(input),
  );
  ipcMain.handle(channels.secretChatCreate, (_event, userId: string) =>
    container.workspace.createSecretChat(userId),
  );
  ipcMain.handle(channels.folderList, () => container.workspace.listFolders());
  ipcMain.handle(
    channels.keywordFolderCreate,
    (_event, input: KeywordFolderInput) =>
      container.workspace.createKeywordFolder(input),
  );
  ipcMain.handle(
    channels.keywordFolderUpdate,
    (_event, input: UpdateKeywordFolderInput) =>
      container.workspace.updateKeywordFolder(input),
  );
  ipcMain.handle(channels.keywordFolderDelete, (_event, id: number) =>
    container.workspace.deleteKeywordFolder(id),
  );
  ipcMain.handle(
    channels.messagePageList,
    (_event, chatId: string, input?: MessagePageInput) =>
      container.workspace.listMessagePage(chatId, input),
  );
  ipcMain.handle(
    channels.sharedMediaList,
    (_event, chatId: string, input?: MessagePageInput) =>
      container.workspace.listSharedMedia(chatId, input),
  );
  ipcMain.handle(channels.pinnedMessageList, (_event, chatId: string) =>
    container.workspace.listPinnedMessages(chatId),
  );
  ipcMain.handle(channels.chatMemberList, (_event, chatId: string) =>
    container.workspace.listChatMembers(chatId),
  );
  ipcMain.handle(channels.peerProfileGet, (_event, peerId: string) =>
    container.workspace.getPeerProfile(peerId),
  );
  ipcMain.handle(channels.stickerSetList, () =>
    container.workspace.listStickerSets(),
  );
  ipcMain.handle(channels.stickerCatalogGet, () =>
    container.workspace.getStickerCatalog(),
  );
  ipcMain.handle(
    channels.stickerSetReorder,
    (_event, setIds: ReadonlyArray<string>) =>
      container.workspace.reorderStickerSets(setIds),
  );
  ipcMain.handle(
    channels.stickerFavoriteSet,
    (_event, stickerId: string, favorite: boolean) =>
      container.workspace.setStickerFavorite(stickerId, favorite),
  );
  ipcMain.handle(channels.stickerRecentRemove, (_event, stickerId: string) =>
    container.workspace.removeRecentSticker(stickerId),
  );
  ipcMain.handle(channels.stickerRecentClear, () =>
    container.workspace.clearRecentStickers(),
  );
  ipcMain.handle(channels.stickerSearch, (_event, query: string) =>
    container.workspace.searchStickers(query),
  );
  ipcMain.handle(
    channels.stickerSend,
    (_event, chatId: string, stickerId: string) =>
      container.workspace.sendSticker(chatId, stickerId),
  );
  ipcMain.handle(
    channels.stickerSetGet,
    (_event, reference: StickerSetReferenceDto) =>
      container.workspace.getStickerSet(reference),
  );
  ipcMain.handle(
    channels.customEmojiGet,
    (_event, documentIds: ReadonlyArray<string>) =>
      container.workspace.getCustomEmoji(documentIds),
  );
  ipcMain.handle(
    channels.stickerSetInstalledSet,
    (_event, shortName: string, installed: boolean) =>
      container.workspace.setStickerSetInstalled(shortName, installed),
  );
  ipcMain.handle(channels.searchGlobal, (_event, query: string) =>
    container.workspace.searchGlobal(query),
  );
  ipcMain.handle(
    channels.searchMessages,
    (_event, chatId: string, query: string, input?: MessageSearchPageInput) =>
      container.workspace.searchMessages(chatId, query, input),
  );
  ipcMain.handle(
    channels.messageSend,
    (_event, chatId: string, body: string, input?: SendMessageInput) =>
      container.workspace.sendMessage(chatId, body, input),
  );
  ipcMain.handle(channels.mediaDownload, (_event, mediaId: string) =>
    container.workspace.downloadMedia(mediaId),
  );
  ipcMain.handle(channels.mediaDownloadCancel, (_event, mediaId: string) =>
    container.workspace.cancelMediaDownload(mediaId),
  );
  ipcMain.handle(
    channels.mediaSaveAs,
    async (_event, mediaId: string, fileName: string | null) => {
      const source = await container.workspace.resolveMediaFile(mediaId);
      const suggested =
        typeof fileName === "string" && path.basename(fileName) === fileName
          ? fileName
          : path.basename(source);
      const result = await dialog.showSaveDialog({ defaultPath: suggested });
      if (result.canceled || !result.filePath) return null;
      await copyFile(source, result.filePath);
      return result.filePath;
    },
  );
  ipcMain.handle(channels.mediaOpen, async (_event, mediaId: string) => {
    const filePath = await container.workspace.resolveMediaFile(mediaId);
    // shell.openPath resolves to an error message instead of throwing.
    const failure = await shell.openPath(filePath);
    if (failure) throw new Error(failure);
  });
  ipcMain.handle(
    channels.mediaSend,
    async (
      _event,
      chatId: string,
      files: ReadonlyArray<LocalMediaFileInput>,
      input: SendMediaInput,
    ) => {
      const staged = await stageUploadFiles(files);
      try {
        return await container.workspace.sendMedia(
          chatId,
          await validateUploadFiles(staged.files),
          input,
        );
      } finally {
        // Staged copies exist only to give the upload a path; the repository
        // has consumed them by the time sendMedia settles.
        await Promise.all(
          staged.temporaryDirectories.map((directory) =>
            rm(directory, { recursive: true, force: true }),
          ),
        );
      }
    },
  );
  ipcMain.handle(channels.mediaUploadCancel, (_event, uploadId: string) =>
    container.workspace.cancelMediaUpload(uploadId),
  );
  ipcMain.handle(channels.messageEdit, (_event, input: EditMessageInput) =>
    container.messageActions.editMessage(input),
  );
  ipcMain.handle(channels.messageDelete, (_event, input: DeleteMessageInput) =>
    container.messageActions.deleteMessage(input),
  );
  ipcMain.handle(
    channels.messageForward,
    (_event, input: ForwardMessageInput) =>
      container.messageActions.forwardMessage(input),
  );
  ipcMain.handle(
    channels.botCallbackAnswer,
    (_event, chatId: string, messageId: string, buttonId: string) =>
      container.messageActions.answerBotCallback(chatId, messageId, buttonId),
  );
  ipcMain.handle(
    channels.messageReactionSet,
    (_event, input: SetMessageReactionInput) =>
      container.messageActions.setMessageReaction(input),
  );
  ipcMain.handle(channels.messageReactionsAvailable, (_event, chatId: string) =>
    container.messageActions.listAvailableReactions(chatId),
  );
  ipcMain.handle(
    channels.chatPinSet,
    (_event, chatId: string, pinned: boolean) =>
      container.chatActions.setPinned(chatId, pinned),
  );
  ipcMain.handle(
    channels.chatMuteSet,
    (_event, chatId: string, muted: boolean) =>
      container.chatActions.setMuted(chatId, muted),
  );
  ipcMain.handle(
    channels.chatReadSet,
    (_event, chatId: string, read: boolean) =>
      container.chatActions.setRead(chatId, read),
  );
  ipcMain.handle(
    channels.chatArchiveSet,
    (_event, chatId: string, archived: boolean) =>
      container.chatActions.setArchived(chatId, archived),
  );
  ipcMain.handle(
    channels.chatTypingSet,
    (_event, chatId: string, typing: boolean) =>
      container.workspace.setTyping(chatId, typing),
  );
  ipcMain.handle(
    channels.chatDraftSave,
    (_event, chatId: string, text: string) =>
      container.workspace.saveDraft(chatId, text),
  );
  ipcMain.handle(channels.agentConfigGet, () =>
    container.agentConfiguration.get(),
  );
  ipcMain.handle(
    channels.agentConfigSave,
    (_event, input: SaveAgentConfigurationInput) =>
      container.agentConfiguration.execute(input),
  );
  ipcMain.handle(
    channels.agentAccountConnect,
    (_event, input: ConnectAgentAccountInput) =>
      container.agentConfiguration.connect(input),
  );
  ipcMain.handle(
    channels.agentAccountDisconnect,
    (_event, input: ConnectAgentAccountInput) =>
      container.agentConfiguration.disconnect(input),
  );
  ipcMain.handle(
    channels.agentModelsList,
    (_event, input: ListAgentModelsInput) =>
      container.listAgentModels.execute(input),
  );
  ipcMain.handle(channels.telegramLoginConfiguration, () =>
    container.telegram.getLoginConfiguration(),
  );
  ipcMain.handle(
    channels.telegramLoginBegin,
    (_event, input: TelegramLoginInput) => container.telegram.beginLogin(input),
  );
  ipcMain.handle(channels.telegramChallengeSubmit, (_event, value: string) =>
    container.telegram.submitChallenge(value),
  );
  ipcMain.handle(channels.telegramAuthGet, () =>
    container.telegram.getAuthState(),
  );
  ipcMain.handle(channels.telegramAccountsList, () =>
    container.telegram.listAccounts(),
  );
  ipcMain.handle(
    channels.telegramAccountActivate,
    (_event, accountId: string) =>
      container.telegram.setActiveAccount(accountId),
  );
  ipcMain.handle(channels.telegramLogout, () =>
    container.telegramLogout.execute(),
  );
  ipcMain.handle(channels.preferencesGet, () => container.preferences.get());
  ipcMain.handle(
    channels.preferencesUpdate,
    (_event, input: UpdateUserPreferencesInput) =>
      container.preferences.execute(input),
  );
  ipcMain.handle(channels.storageMediaCacheUsage, () =>
    container.mediaCacheStorage.usageBytes(),
  );
  ipcMain.handle(channels.storageMediaCacheClear, () =>
    container.mediaCacheStorage.clear(),
  );
  ipcMain.handle(
    channels.notify,
    (event, title: string, body: string, tag?: string) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title, body });
      if (tag) {
        notification.on("click", () =>
          event.sender.send(channels.notifyClick, tag),
        );
      }
      notification.show();
    },
  );
  const suggestFollowUps = (threadId: string) =>
    container.runAgent.suggestFollowUps(threadId);
  ipcMain.handle(channels.agentRun, async (event, input: RunAgentInput) => {
    // Message actions stream over CUSTOM events instead of the transcript
    // sequence: the result is written into the composer draft, never into
    // the agent panel's thread view.
    if (input.action) {
      await streamMessageActionEvents(
        event.sender,
        container.runMessageAction.execute({
          ...input,
          action: input.action,
        }),
      );
      return;
    }
    await streamAgentEvents(
      event.sender,
      input,
      container.runAgent.execute(input),
      suggestFollowUps,
    );
  });
  ipcMain.handle(
    channels.agentRunChatSummary,
    async (event, input: RunChatAgentInput) => {
      await streamAgentEvents(
        event.sender,
        input,
        container.runChatSummary.execute(input),
        suggestFollowUps,
      );
    },
  );
  ipcMain.handle(
    channels.agentRunChatExtraction,
    async (event, input: RunChatAgentInput) => {
      await streamAgentEvents(
        event.sender,
        input,
        container.runChatExtraction.execute(input),
        suggestFollowUps,
      );
    },
  );
  ipcMain.handle(
    channels.agentContextPreview,
    (_event, input: AgentContextScopeInput) =>
      container.agentContext.preview(input),
  );
  ipcMain.handle(channels.agentAuditList, () =>
    container.agentAudit.listRecent(),
  );
  ipcMain.handle(channels.agentThreadsList, () =>
    container.agentThreads.listThreads(),
  );
  ipcMain.handle(channels.agentThreadGet, (_event, threadId: string) =>
    container.agentThreads.getThread(threadId),
  );
  ipcMain.handle(channels.agentThreadCreate, () =>
    container.agentThreads.createThread(),
  );
  ipcMain.handle(channels.agentThreadSelect, (_event, threadId: string) =>
    container.agentThreads.selectThread(threadId),
  );
  ipcMain.handle(channels.agentTriggerRulesList, async () =>
    (await container.agentAutomation.listRules()).map((rule) =>
      rule.snapshot(),
    ),
  );
  ipcMain.handle(
    channels.agentTriggerRuleSave,
    async (_event, input: SaveTriggerRuleInput) => {
      if (!input.name?.trim()) {
        throw new Error("Trigger rule name is required");
      }
      if (!input.promptTemplate?.trim()) {
        throw new Error("Trigger rule prompt template is required");
      }
      return (
        await container.agentAutomation.saveRule(input, "user")
      ).snapshot();
    },
  );
  ipcMain.handle(channels.agentTriggerRuleRemove, (_event, ruleId: string) =>
    container.agentAutomation.removeRule(ruleId),
  );
  ipcMain.handle(
    channels.agentTriggerRuleEnable,
    async (_event, ruleId: string, enabled: boolean) =>
      (
        await container.agentAutomation.setRuleEnabled(ruleId, enabled)
      ).snapshot(),
  );
  ipcMain.handle(channels.agentScheduledTasksList, async () =>
    (await container.agentAutomation.listTasks()).map(scheduledTaskDto),
  );
  ipcMain.handle(
    channels.agentScheduledTaskSave,
    async (_event, input: SaveScheduledTaskInput) => {
      if (!input.name?.trim()) {
        throw new Error("Scheduled task name is required");
      }
      if (!input.promptTemplate?.trim()) {
        throw new Error("Scheduled task prompt template is required");
      }
      return scheduledTaskDto(
        await container.agentAutomation.saveTask(input, "user"),
      );
    },
  );
  ipcMain.handle(channels.agentScheduledTaskRemove, (_event, taskId: string) =>
    container.agentAutomation.removeTask(taskId),
  );
  ipcMain.handle(
    channels.agentScheduledTaskEnable,
    async (_event, taskId: string, enabled: boolean) =>
      scheduledTaskDto(
        await container.agentAutomation.setTaskEnabled(taskId, enabled),
      ),
  );
}

// The snapshot carries persisted state; nextRunAt is derived per request so
// the renderer always sees the next fire relative to now.
function scheduledTaskDto(task: AgentScheduledTask): AgentScheduledTaskDto {
  return {
    ...task.snapshot(),
    nextRunAt: task.nextRunAt()?.toISOString() ?? null,
  };
}
const MAX_ALBUM_FILES = 10;
// Telegram rejects user uploads past 2 GB per file.
const MAX_UPLOAD_FILE_BYTES = 2 * 1024 ** 3;

/**
 * Pasted clipboard files have no disk path; their bytes arrive over IPC and
 * are staged to a temp file so the rest of the pipeline (validation,
 * repository upload) sees a plain absolute source like a picked file.
 */
async function stageUploadFiles(
  files: ReadonlyArray<LocalMediaFileInput>,
): Promise<{
  files: ReadonlyArray<LocalMediaFileInput>;
  temporaryDirectories: ReadonlyArray<string>;
}> {
  const temporaryDirectories: string[] = [];
  const staged = await Promise.all(
    files.map(async (file) => {
      if (!file.bytes) return file;
      if (file.bytes.byteLength !== file.size) {
        throw new Error(`Upload source changed for ${file.name}`);
      }
      const directory = await mkdtemp(path.join(tmpdir(), "telo-upload-"));
      const source = path.join(directory, path.basename(file.name));
      await writeFile(source, file.bytes);
      temporaryDirectories.push(directory);
      return {
        source,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
      };
    }),
  );
  return { files: staged, temporaryDirectories };
}

async function validateUploadFiles(
  files: ReadonlyArray<LocalMediaFileInput>,
): Promise<ReadonlyArray<LocalMediaFileInput>> {
  if (files.length < 1 || files.length > MAX_ALBUM_FILES) {
    throw new Error(`Select from 1 to ${MAX_ALBUM_FILES} files`);
  }
  return Promise.all(
    files.map(async (file) => {
      if (!file.name.trim()) throw new Error("Upload file name is required");
      if (file.size > MAX_UPLOAD_FILE_BYTES) {
        throw new Error(`Upload ${file.name} exceeds the 2 GB limit`);
      }
      if (!path.isAbsolute(file.source))
        throw new Error("Upload source must be absolute");
      const details = await stat(file.source);
      if (!details.isFile() || details.size !== file.size) {
        throw new Error(`Upload source changed for ${file.name}`);
      }
      return file;
    }),
  );
}

async function streamAgentEvents(
  sender: WebContents,
  input: Pick<RunAgentInput, "threadId" | "context">,
  outputs: AsyncIterable<AgentOutput>,
  suggestFollowUps: (threadId: string) => Promise<ReadonlyArray<string>>,
): Promise<void> {
  const runId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  send(sender, {
    type: EventType.RUN_STARTED,
    threadId: input.threadId,
    runId,
  });
  send(sender, { type: EventType.STATE_SNAPSHOT, snapshot: input.context });

  // TEXT_MESSAGE_START opens on the first delta, not upfront: a failed or
  // empty run must not mint an assistant shell message.
  let messageStarted = false;
  let failed = false;
  for await (const output of outputs) {
    if (output.type === "text") {
      if (!messageStarted) {
        messageStarted = true;
        send(sender, {
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
        });
      }
      send(sender, {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: output.delta,
      });
    } else if (output.type === "activity") {
      send(sender, { type: EventType.CUSTOM, name: "activity", value: output });
    } else {
      failed = true;
      send(sender, {
        type: EventType.RUN_ERROR,
        message: output.message,
        code: "AGENT_FAILED",
      });
    }
  }

  if (messageStarted) {
    send(sender, { type: EventType.TEXT_MESSAGE_END, messageId });
  }
  if (failed) return;
  send(sender, {
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId,
    outcome: { type: "success" },
  });
  // Follow-up pills trail the closed run so a slow suggestion call never
  // keeps the reply in its streaming state; an empty list sends nothing.
  if (!messageStarted) return;
  const items = await suggestFollowUps(input.threadId);
  if (items.length === 0) return;
  const value: AgentSuggestionsPayload = { items };
  send(sender, {
    type: EventType.CUSTOM,
    name: AGENT_SUGGESTIONS_EVENT_NAME,
    value,
  });
}

function send(sender: WebContents, event: AGUIEvent): void {
  sender.send(channels.agentEvent, event);
}

// Message-action output rides CUSTOM events named MESSAGE_ACTION_EVENT_NAME
// so every listener except the chat store's draft writer ignores it; no
// RUN_* or TEXT_MESSAGE_* events are emitted, keeping the panel transcript
// and its thread notifications out of the action entirely. The terminal
// `done` event is the completion signal: the invoke response can overtake
// queued event messages, so the renderer must not tear down on it.
async function streamMessageActionEvents(
  sender: WebContents,
  outputs: AsyncIterable<AgentOutput>,
): Promise<void> {
  for await (const output of outputs) {
    send(sender, {
      type: EventType.CUSTOM,
      name: MESSAGE_ACTION_EVENT_NAME,
      value: output,
    });
  }
  send(sender, {
    type: EventType.CUSTOM,
    name: MESSAGE_ACTION_EVENT_NAME,
    value: { type: "done" },
  });
}
