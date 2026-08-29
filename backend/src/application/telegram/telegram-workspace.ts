import type {
  ChatPageDto,
  ChatPageInput,
  CurrentUserDto,
  MessageDto,
  MessagePageDto,
  MessagePageInput,
  SendMessageInput,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";

const DEFAULT_CHAT_PAGE_SIZE = 50;
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export class TelegramWorkspaceService {
  constructor(private readonly repository: TelegramRepository) {}

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    return this.repository.subscribe(listener);
  }

  getCurrentUser(): Promise<CurrentUserDto> {
    return this.repository.getCurrentUser();
  }

  listChatPage(input: ChatPageInput = {}): Promise<ChatPageDto> {
    if (input.cursor) validateChatCursor(input.cursor);
    return this.repository.listChatPage({
      ...input,
      limit: pageSize(input.limit, DEFAULT_CHAT_PAGE_SIZE),
    });
  }

  listMessagePage(
    chatId: string,
    input: MessagePageInput = {},
  ): Promise<MessagePageDto> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (input.beforeMessageId) validateMessageId(input.beforeMessageId);
    return this.repository.listMessagePage(chatId, {
      ...input,
      limit: pageSize(input.limit, DEFAULT_MESSAGE_PAGE_SIZE),
    });
  }

  sendMessage(
    chatId: string,
    body: string,
    input?: SendMessageInput,
  ): Promise<MessageDto> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (!body.trim()) throw new Error("Message body is required");
    return this.repository.sendMessage(
      chatId,
      body.trim(),
      input?.replyToId,
      input?.clientId,
    );
  }

  setTyping(chatId: string, typing: boolean): Promise<void> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    return this.repository.setTyping(chatId, typing);
  }

  saveDraft(chatId: string, text: string): Promise<void> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    return this.repository.saveDraft(chatId, text);
  }
}

function validateChatCursor(
  cursor: NonNullable<ChatPageInput["cursor"]>,
): void {
  if (!cursor.chatId.trim()) throw new Error("Chat cursor id is required");
  validateMessageId(cursor.topMessageId);
  if (Number.isNaN(Date.parse(cursor.updatedAt))) {
    throw new Error("Chat cursor timestamp is invalid");
  }
}

function validateMessageId(value: string): void {
  if (!value.trim()) throw new Error("Message id is required");
}

function pageSize(value: number | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error(`Page size must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
  return value;
}
