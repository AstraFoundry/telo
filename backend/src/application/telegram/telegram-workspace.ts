import type {
  ChatDto,
  ChatFolderDto,
  ChatMemberDto,
  ChatPageDto,
  ChatPageInput,
  CurrentUserDto,
  GlobalSearchResultDto,
  KeywordFolderInput,
  MessageDto,
  MessagePageDto,
  MessagePageInput,
  MessageSearchPageDto,
  MessageSearchPageInput,
  PeerProfileDto,
  SendMessageInput,
  SendMediaInput,
  StickerItemDto,
  StickerCatalogDto,
  StickerSetDto,
  StickerSetReferenceDto,
  TelegramWorkspaceEvent,
  UpdateKeywordFolderInput,
} from "../../../../contracts/src/ipc";
import type {
  TelegramRepository,
  TelegramUploadFile,
} from "../../domain/telegram/telegram-ports";
import { trimOutgoingMessage } from "../../domain/telegram/outgoing-message";
import type { KeywordFolderService } from "../keyword-folder/keyword-folders";

const DEFAULT_CHAT_PAGE_SIZE = 50;
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_ALBUM_ITEMS = 10;

export class TelegramWorkspaceService {
  constructor(
    private readonly repository: TelegramRepository,
    private readonly keywordFolders: KeywordFolderService | null = null,
  ) {}

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    const emitMergedFolders = (): void => {
      if (!this.keywordFolders) return;
      void this.listFolders().then((folders) => {
        listener({ type: "folders", folders });
      });
    };
    const unsubKeyword =
      this.keywordFolders?.onChange(emitMergedFolders) ?? (() => {});
    const unsubRepository = this.repository.subscribe((event) => {
      if (!this.keywordFolders) {
        listener(event);
        return;
      }
      if (event.type === "folders") {
        void this.keywordFolders.mergeNative(event.folders).then((folders) => {
          listener({ type: "folders", folders });
        });
        return;
      }
      if (event.type === "chat-upsert") {
        listener({
          type: "chat-upsert",
          chat: this.keywordFolders.annotate(event.chat),
        });
        emitMergedFolders();
        return;
      }
      if (event.type === "message-upsert") {
        this.keywordFolders.noteMessage(event.message);
        listener(event);
        emitMergedFolders();
        return;
      }
      if (event.type === "message-read" || event.type === "message-delete") {
        listener(event);
        emitMergedFolders();
        return;
      }
      listener(event);
    });
    return () => {
      unsubKeyword();
      unsubRepository();
    };
  }

  getCurrentUser(): Promise<CurrentUserDto> {
    return this.repository.getCurrentUser();
  }

  async listChatPage(input: ChatPageInput = {}): Promise<ChatPageDto> {
    if (input.cursor) validateChatCursor(input.cursor);
    const page = await this.repository.listChatPage({
      ...input,
      limit: pageSize(input.limit, DEFAULT_CHAT_PAGE_SIZE),
    });
    const keywords = this.keywordFolders;
    if (!keywords) return page;
    await keywords.mergeNative(await this.repository.listFolders());
    return {
      ...page,
      items: page.items.map((chat) => keywords.annotate(chat)),
    };
  }

  createSecretChat(userId: string): Promise<ChatDto> {
    if (!userId.trim()) throw new Error("User id is required");
    return this.repository.createSecretChat(userId.trim());
  }

  openSavedMessages(): Promise<ChatDto> {
    return this.repository.openSavedMessages();
  }

  async listFolders(): Promise<ReadonlyArray<ChatFolderDto>> {
    const native = await this.repository.listFolders();
    if (!this.keywordFolders) return native;
    return this.keywordFolders.mergeNative(native);
  }

  createKeywordFolder(input: KeywordFolderInput): Promise<ChatFolderDto> {
    if (!this.keywordFolders) {
      throw new Error("Keyword folders are unavailable");
    }
    return this.keywordFolders.create(input);
  }

  updateKeywordFolder(input: UpdateKeywordFolderInput): Promise<ChatFolderDto> {
    if (!this.keywordFolders) {
      throw new Error("Keyword folders are unavailable");
    }
    return this.keywordFolders.update(input);
  }

  deleteKeywordFolder(id: number): Promise<void> {
    if (!this.keywordFolders) {
      throw new Error("Keyword folders are unavailable");
    }
    return this.keywordFolders.remove(id);
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

  getPeerProfile(peerId: string): Promise<PeerProfileDto> {
    if (!peerId.trim()) throw new Error("Peer id is required");
    return this.repository.getPeerProfile(peerId);
  }

  listStickerSets(): Promise<ReadonlyArray<StickerSetDto>> {
    return this.repository.listStickerSets();
  }

  getStickerCatalog(): Promise<StickerCatalogDto> {
    return this.repository.getStickerCatalog();
  }

  reorderStickerSets(setIds: ReadonlyArray<string>): Promise<void> {
    if (setIds.length === 0) throw new Error("Sticker set order is required");
    if (new Set(setIds).size !== setIds.length) {
      throw new Error("Sticker set order contains duplicates");
    }
    if (setIds.some((id) => !id.trim())) {
      throw new Error("Sticker set id is required");
    }
    return this.repository.reorderStickerSets(setIds);
  }

  setStickerFavorite(stickerId: string, favorite: boolean): Promise<void> {
    if (!stickerId.trim()) throw new Error("Sticker id is required");
    return this.repository.setStickerFavorite(stickerId, favorite);
  }

  removeRecentSticker(stickerId: string): Promise<void> {
    if (!stickerId.trim()) throw new Error("Sticker id is required");
    return this.repository.removeRecentSticker(stickerId);
  }

  clearRecentStickers(): Promise<void> {
    return this.repository.clearRecentStickers();
  }

  searchStickers(query: string): Promise<ReadonlyArray<StickerItemDto>> {
    const normalized = query.trim();
    if (!normalized) throw new Error("Sticker search query is required");
    return this.repository.searchStickers(normalized);
  }

  sendSticker(
    chatId: string,
    stickerId: string,
    clientId?: string,
  ): Promise<MessageDto> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (!stickerId.trim()) throw new Error("Sticker id is required");
    return this.repository.sendSticker(chatId, stickerId, clientId);
  }

  getStickerSet(reference: StickerSetReferenceDto): Promise<StickerSetDto> {
    if (reference.kind === "short-name") {
      const shortName = reference.shortName.trim();
      if (!shortName) throw new Error("Sticker set name is required");
      return this.repository.getStickerSet({ kind: "short-name", shortName });
    }
    const id = reference.id.trim();
    if (!id) throw new Error("Sticker set id is required");
    return this.repository.getStickerSet({ kind: "id", id });
  }

  setStickerSetInstalled(shortName: string, installed: boolean): Promise<void> {
    if (!shortName.trim()) throw new Error("Sticker set name is required");
    return this.repository.setStickerSetInstalled(shortName, installed);
  }

  getCustomEmoji(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<StickerItemDto>> {
    // A message with no custom emoji batches an empty list; that is a normal
    // renderer state, not a bad request, so it answers without a round trip.
    if (documentIds.length === 0) return Promise.resolve([]);
    return this.repository.getCustomEmoji(documentIds);
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
    const trimmed = trimOutgoingMessage(body, input?.entities);
    return this.repository.sendMessage(
      chatId,
      trimmed.body,
      input?.replyToId,
      input?.clientId,
      input?.silent,
      trimmed.entities,
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
  if (!cursor.trim()) throw new Error("Chat cursor is required");
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
