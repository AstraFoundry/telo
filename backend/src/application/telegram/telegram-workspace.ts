import type {
  ChatFolderDto,
  ChatMemberDto,
  ChatPageDto,
  ChatPageInput,
  CurrentUserDto,
  GlobalSearchResultDto,
  MessageDto,
  MessagePageDto,
  MessagePageInput,
  MessageSearchPageDto,
  MessageSearchPageInput,
  SendMessageInput,
  SendMediaInput,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";
import type {
  TelegramRepository,
  TelegramUploadFile,
} from "../../domain/telegram/telegram-ports";

const DEFAULT_CHAT_PAGE_SIZE = 50;
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_ALBUM_ITEMS = 10;

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

  listFolders(): Promise<ReadonlyArray<ChatFolderDto>> {
    return this.repository.listFolders();
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

  listSharedMedia(
    chatId: string,
    input: MessagePageInput = {},
  ): Promise<MessagePageDto> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (input.beforeMessageId) validateMessageId(input.beforeMessageId);
    return this.repository.listSharedMedia(chatId, {
      ...input,
      limit: pageSize(input.limit, DEFAULT_MESSAGE_PAGE_SIZE),
    });
  }

  listPinnedMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    return this.repository.listPinnedMessages(chatId);
  }

  listChatMembers(chatId: string): Promise<ReadonlyArray<ChatMemberDto>> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    return this.repository.listChatMembers(chatId);
  }

  searchGlobal(query: string): Promise<GlobalSearchResultDto> {
    if (!query.trim()) throw new Error("Search query is required");
    return this.repository.searchGlobal(query.trim());
  }

  searchMessages(
    chatId: string,
    query: string,
    input: MessageSearchPageInput = {},
  ): Promise<MessageSearchPageDto> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (!query.trim()) throw new Error("Search query is required");
    if (input.beforeMessageId) validateMessageId(input.beforeMessageId);
    return this.repository.searchMessages(chatId, query.trim(), {
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
      input?.silent,
      input?.entities,
    );
  }

  downloadMedia(mediaId: string): Promise<void> {
    if (!mediaId.trim()) throw new Error("Media id is required");
    return this.repository.downloadMedia(mediaId);
  }

  cancelMediaDownload(mediaId: string): Promise<void> {
    if (!mediaId.trim()) throw new Error("Media id is required");
    return this.repository.cancelMediaDownload(mediaId);
  }

  resolveMediaFile(mediaId: string): Promise<string> {
    if (!mediaId.trim()) throw new Error("Media id is required");
    return this.repository.resolveMediaFile(mediaId);
  }

  sendMedia(
    chatId: string,
    files: ReadonlyArray<TelegramUploadFile>,
    input: SendMediaInput,
  ): Promise<ReadonlyArray<MessageDto>> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (!input.uploadId.trim()) throw new Error("Upload id is required");
    if (files.length < 1 || files.length > MAX_ALBUM_ITEMS) {
      throw new Error(`Select from 1 to ${MAX_ALBUM_ITEMS} files`);
    }
    for (const file of files) {
      if (!file.source.trim() || !file.name.trim()) {
        throw new Error("Every upload requires a source and file name");
      }
      if (!Number.isSafeInteger(file.size) || file.size < 1) {
        throw new Error(`Upload size is invalid for ${file.name}`);
      }
    }
    return this.repository.sendMedia(
      chatId,
      files,
      input.caption?.trim() ?? "",
      input.replyToId,
      input.clientId,
      input.uploadId,
    );
  }

  cancelMediaUpload(uploadId: string): Promise<void> {
    if (!uploadId.trim()) throw new Error("Upload id is required");
    return this.repository.cancelMediaUpload(uploadId);
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
