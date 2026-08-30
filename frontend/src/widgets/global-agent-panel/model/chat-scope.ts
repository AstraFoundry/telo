import type { ChatDto, MessageDto } from "../../../../../contracts/src/ipc";
import type { ChatActionScope } from "entities/agent";

/**
 * Message scope of a chat-scoped agent action: the unread messages when the
 * chat's read boundary is loaded (everything after `lastReadMessageId`),
 * otherwise the loaded page. A boundary above the loaded page means every
 * loaded message is unread. Media-only messages carry no text to work on.
 * Returns null when the scope is empty, which disables the action.
 */
export function collectChatScope(
  chat: ChatDto | null,
  messages: ReadonlyArray<MessageDto>,
): ChatActionScope | null {
  if (!chat) return null;
  const boundary = chat.lastReadMessageId
    ? messages.findIndex((message) => message.id === chat.lastReadMessageId)
    : -1;
  const scoped = boundary >= 0 ? messages.slice(boundary + 1) : messages;
  const scopeMessages = scoped
    .filter((message) => Boolean(message.body?.trim()))
    .map(({ id, senderName, body }) => ({ id, senderName, body }));
  if (scopeMessages.length === 0) return null;
  return { chatId: chat.id, chatTitle: chat.title, messages: scopeMessages };
}
