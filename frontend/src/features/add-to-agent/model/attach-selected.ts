import type { ChatDto, MessageDto } from "../../../../../contracts/src/ipc";
import type { AgentAttachedMessage } from "entities/agent";

/**
 * Turns the chat's selected messages into composer cards, in transcript
 * order. The card carries only what it shows — sender and first line — the
 * run re-reads and redacts the full bodies main-side from the ids.
 */
export function toAttachedMessages(
  chat: ChatDto,
  messages: ReadonlyArray<MessageDto>,
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<AgentAttachedMessage> {
  const wanted = new Set(selectedIds);
  return messages
    .filter((message) => wanted.has(message.id))
    .map((message) => ({
      chatId: chat.id,
      chatTitle: chat.title,
      messageId: message.id,
      senderName: message.senderName,
      body: message.body,
    }));
}
