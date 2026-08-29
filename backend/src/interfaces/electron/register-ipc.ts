import { EventType, type AGUIEvent } from "@ag-ui/core";
import { ipcMain, Notification, type WebContents } from "electron";

import type {
  DeleteMessageInput,
  ChatPageInput,
  EditMessageInput,
  ForwardMessageInput,
  MessagePageInput,
  RunAgentInput,
  SaveAgentConfigurationInput,
  SendMessageInput,
  TelegramLoginInput,
  UpdateUserPreferencesInput,
} from "../../../../contracts/src/ipc";
import type { ApplicationContainer } from "./container";
import { channels } from "./channels";

export function registerIpc(container: ApplicationContainer): void {
  ipcMain.handle(channels.currentUserGet, () =>
    container.workspace.getCurrentUser(),
  );
  ipcMain.handle(channels.chatPageList, (_event, input?: ChatPageInput) =>
    container.workspace.listChatPage(input),
  );
  ipcMain.handle(
    channels.messagePageList,
    (_event, chatId: string, input?: MessagePageInput) =>
      container.workspace.listMessagePage(chatId, input),
  );
  ipcMain.handle(
    channels.messageSend,
    (_event, chatId: string, body: string, input?: SendMessageInput) =>
      container.workspace.sendMessage(chatId, body, input),
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
  ipcMain.handle(channels.agentConfigGet, () =>
    container.agentConfiguration.get(),
  );
  ipcMain.handle(
    channels.agentConfigSave,
    (_event, input: SaveAgentConfigurationInput) =>
      container.agentConfiguration.execute(input),
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
  ipcMain.handle(channels.telegramLogout, () =>
    container.telegramLogout.execute(),
  );
  ipcMain.handle(channels.preferencesGet, () => container.preferences.get());
  ipcMain.handle(
    channels.preferencesUpdate,
    (_event, input: UpdateUserPreferencesInput) =>
      container.preferences.execute(input),
  );
  ipcMain.handle(channels.notify, (_event, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });
  ipcMain.handle(channels.agentRun, async (event, input: RunAgentInput) => {
    await streamAgentEvents(container, event.sender, input);
  });
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
}

async function streamAgentEvents(
  container: ApplicationContainer,
  sender: WebContents,
  input: RunAgentInput,
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
  for await (const output of container.runAgent.execute(input)) {
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
  if (!failed) {
    send(sender, {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId,
      outcome: { type: "success" },
    });
  }
}

function send(sender: WebContents, event: AGUIEvent): void {
  sender.send(channels.agentEvent, event);
}
