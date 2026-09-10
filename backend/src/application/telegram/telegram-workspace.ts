import type {
  AddContactByPhoneInput,
  ChatDto,
  ChatFolderDetailsDto,
  ChatFolderDto,
  ChatFolderInput,
  ChatMemberDto,
  ChatPageDto,
  ChatPageInput,
  CreateTelegramChannelInput,
  CreateTelegramGroupInput,
  CurrentUserDto,
  GlobalSearchResultDto,
  KeywordFolderInput,
  MessageDto,
  MessagePageDto,
  MessagePageInput,
  MessageSearchPageDto,
  MessageSearchPageInput,
  PeerProfileDto,
  PostedStoryDto,
  PostStoryInput,
  SendMessageInput,
  SendPollInput,
  SendMediaInput,
  SetPeerContactInput,
  StickerItemDto,
  StickerCatalogDto,
  StickerSetDto,
  StickerSetReferenceDto,
  TelegramWorkspaceEvent,
  TelegramCallPageDto,
  TelegramContactDto,
  UpdateChatFolderInput,
  UpdateKeywordFolderInput,
  UpdateProfileNameInput,
  UsernameAvailability,
} from "../../../../contracts/src/ipc";
import type {
  TelegramRepository,
  TelegramUploadFile,
} from "../../domain/telegram/telegram-ports";
import { trimOutgoingMessage } from "../../domain/telegram/outgoing-message";
import {
  assertCanSendContent,
  canSendContent,
} from "../../domain/telegram/can-send-content";
import { MAX_ALBUM_FILES } from "../../domain/telegram/upload-policy";
import { POLL_OPTIONS_MAX, POLL_OPTIONS_MIN } from "../../domain/telegram/poll";
import type { KeywordFolderService } from "../keyword-folder/keyword-folders";

const DEFAULT_CHAT_PAGE_SIZE = 50;
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
/** Telegram caps the bio at 70 single-line characters. */
const MAX_BIO_LENGTH = 70;

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

  updateProfileName(input: UpdateProfileNameInput): Promise<CurrentUserDto> {
    const firstName = input.firstName.trim();
    if (!firstName) throw new Error("First name is required");
    return this.repository.updateProfileName({
      firstName,
      lastName: input.lastName.trim(),
    });
  }

  updateBio(bio: string): Promise<void> {
    const trimmed = bio.trim();
    if (trimmed.length > MAX_BIO_LENGTH) {
      throw new Error(`Bio must be at most ${MAX_BIO_LENGTH} characters`);
    }
    return this.repository.updateBio(trimmed);
  }

  checkUsernameAvailability(username: string): Promise<UsernameAvailability> {
    const trimmed = username.trim();
    if (!trimmed) throw new Error("Username is required");
    return this.repository.checkUsernameAvailability(trimmed);
  }

  setUsername(username: string): Promise<CurrentUserDto> {
    // An empty username removes it; validation belongs to Telegram.
    return this.repository.setUsername(username.trim());
  }

  setProfilePhoto(file: TelegramUploadFile): Promise<CurrentUserDto> {
    if (!file.mimeType.startsWith("image/")) {
      throw new Error("Profile photo must be an image");
    }
    return this.repository.setProfilePhoto(file);
  }

  addContactByPhone(
    input: AddContactByPhoneInput,
  ): Promise<TelegramContactDto | null> {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    // tdesktop's AddContactBox: one name part is enough, the phone decides.
    if (!firstName && !lastName) {
      throw new Error("Contact name is required");
    }
    if (!input.phone.replace(/\D/g, "")) {
      throw new Error("Phone number is required");
    }
    return this.repository.addContactByPhone({
      firstName,
      lastName,
      phone: input.phone,
    });
  }

  setPeerContact(input: SetPeerContactInput): Promise<void> {
    if (!input.userId.trim()) throw new Error("User id is required");
    // Telegram's addContact requires a non-empty contact first name.
    if (!input.firstName.trim()) throw new Error("First name is required");
    return this.repository.setPeerContact({
      userId: input.userId.trim(),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      sharePhoneNumber: input.sharePhoneNumber,
    });
  }

  removePeerContact(userId: string): Promise<void> {
    if (!userId.trim()) throw new Error("User id is required");
    return this.repository.removePeerContact(userId.trim());
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

  listContacts(): Promise<ReadonlyArray<TelegramContactDto>> {
    return this.repository.listContacts();
  }

  openPrivateChat(userId: string): Promise<ChatDto> {
    if (!userId.trim()) throw new Error("User id is required");
    return this.repository.openPrivateChat(userId.trim());
  }

  createGroup(input: CreateTelegramGroupInput): Promise<ChatDto> {
    const title = validateChatTitle(input.title);
    if (input.userIds.length === 0) {
      throw new Error("Select at least one group member");
    }
    const userIds = input.userIds.map((id) => id.trim());
    if (userIds.some((id) => !id)) throw new Error("User id is required");
    if (new Set(userIds).size !== userIds.length) {
      throw new Error("Group members contain duplicates");
    }
    return this.repository.createGroup({ title, userIds });
  }

  createChannel(input: CreateTelegramChannelInput): Promise<ChatDto> {
    const title = validateChatTitle(input.title);
    const description = input.description?.trim() ?? "";
    if (description.length > 255) {
      throw new Error("Channel description must be at most 255 characters");
    }
    return this.repository.createChannel({ title, description });
  }

  listCalls(cursor: string | null = null): Promise<TelegramCallPageDto> {
    return this.repository.listCalls(cursor?.trim() || null);
  }

  postStory(
    file: TelegramUploadFile,
    input: PostStoryInput,
  ): Promise<PostedStoryDto> {
    if (
      !file.mimeType.startsWith("image/") &&
      !file.mimeType.startsWith("video/")
    ) {
      throw new Error("Stories require a photo or video");
    }
    if (file.mimeType.startsWith("video/")) {
      const duration = input.durationSeconds ?? 0;
      if (duration <= 0 || duration > 60) {
        throw new Error("Story videos must be between 1 and 60 seconds");
      }
    }
    return this.repository.postStory(file, {
      ...input,
      caption: input.caption?.trim() ?? "",
    });
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

  getChatFolder(folderId: number): Promise<ChatFolderDetailsDto | null> {
    validateChatFolderId(folderId);
    return this.repository.getChatFolder(folderId);
  }

  createChatFolder(input: ChatFolderInput): Promise<ChatFolderDto> {
    return this.repository.createChatFolder(validateChatFolderInput(input));
  }

  editChatFolder(input: UpdateChatFolderInput): Promise<ChatFolderDto> {
    validateChatFolderId(input.id);
    return this.repository.editChatFolder({
      ...validateChatFolderInput(input),
      id: input.id,
    });
  }

  deleteChatFolder(folderId: number): Promise<void> {
    validateChatFolderId(folderId);
    return this.repository.deleteChatFolder(folderId);
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

  async sendSticker(
    chatId: string,
    stickerId: string,
    clientId?: string,
  ): Promise<MessageDto> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (!stickerId.trim()) throw new Error("Sticker id is required");
    const chat = await this.repository.getChat(chatId);
    if (chat) assertCanSendContent(chat, "stickers");
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

  async sendMessage(
    chatId: string,
    body: string,
    input?: SendMessageInput,
  ): Promise<MessageDto> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (!body.trim()) throw new Error("Message body is required");
    if (input?.sendAt !== undefined) validateSendAt(input.sendAt);
    const trimmed = trimOutgoingMessage(body, input?.entities);
    const chat = await this.repository.getChat(chatId);
    if (chat) assertCanSendContent(chat, "text");
    return this.repository.sendMessage(
      chatId,
      trimmed.body,
      input?.replyToId,
      input?.clientId,
      input?.silent,
      trimmed.entities,
      input?.sendAt,
    );
  }

  /**
   * Creates a poll (TDLib `inputMessagePoll`). Validation mirrors the
   * composer dialog: a question and 2-10 non-empty options, and a quiz
   * names its correct option because TDLib's `inputPollTypeQuiz` requires
   * it. Polls gate on the plain-text write permission — tdesktop offers
   * the poll creator wherever messages can be posted.
   */
  async sendPoll(chatId: string, input: SendPollInput): Promise<MessageDto> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    const question = input.question.trim();
    if (!question) throw new Error("Poll question is required");
    const options = input.options.map((option) => option.trim());
    if (
      options.length < POLL_OPTIONS_MIN ||
      options.length > POLL_OPTIONS_MAX
    ) {
      throw new Error(
        `A poll needs ${POLL_OPTIONS_MIN}-${POLL_OPTIONS_MAX} options`,
      );
    }
    if (options.some((option) => !option)) {
      throw new Error("Poll options can't be empty");
    }
    if (input.kind !== "regular" && input.kind !== "quiz") {
      throw new Error("Poll kind must be regular or quiz");
    }
    if (input.kind === "quiz") {
      const correct = input.correctOptionId;
      if (
        correct === undefined ||
        !Number.isInteger(correct) ||
        correct < 0 ||
        correct >= options.length
      ) {
        throw new Error("A quiz needs a correct option");
      }
    }
    const chat = await this.repository.getChat(chatId);
    if (chat) assertCanSendContent(chat, "text");
    return this.repository.sendPoll(chatId, {
      ...input,
      question,
      options,
      // Multiple answers is a regular-poll flag; a quiz is always
      // single-answer in Telegram.
      allowMultipleAnswers:
        input.kind === "regular" ? Boolean(input.allowMultipleAnswers) : false,
    });
  }

  listScheduledMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    return this.repository.listScheduledMessages(chatId);
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

  async sendMedia(
    chatId: string,
    files: ReadonlyArray<TelegramUploadFile>,
    input: SendMediaInput,
  ): Promise<ReadonlyArray<MessageDto>> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (!input.uploadId.trim()) throw new Error("Upload id is required");
    if (files.length < 1 || files.length > MAX_ALBUM_FILES) {
      throw new Error(`Select from 1 to ${MAX_ALBUM_FILES} files`);
    }
    for (const file of files) {
      if (!file.source.trim() || !file.name.trim()) {
        throw new Error("Every upload requires a source and file name");
      }
      if (!Number.isSafeInteger(file.size) || file.size < 1) {
        throw new Error(`Upload size is invalid for ${file.name}`);
      }
    }
    const chat = await this.repository.getChat(chatId);
    if (chat) assertCanSendContent(chat, "media");
    const uploads = input.voiceNote
      ? markVoiceNoteUpload(files, input.voiceNote.durationSeconds)
      : files;
    return this.repository.sendMedia(
      chatId,
      uploads,
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

  async setTyping(chatId: string, typing: boolean): Promise<void> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    const chat = await this.repository.getChat(chatId);
    // Typing is best-effort: a read-only chat silently skips the signal
    // instead of failing the composer.
    if (chat && !canSendContent(chat, "text")) return;
    return this.repository.setTyping(chatId, typing);
  }

  async saveDraft(chatId: string, text: string): Promise<void> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    const chat = await this.repository.getChat(chatId);
    if (chat) assertCanSendContent(chat, "text");
    return this.repository.saveDraft(chatId, text);
  }
}

function validateChatTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error("Chat title is required");
  if (title.length > 128) {
    throw new Error("Chat title must be at most 128 characters");
  }
  return title;
}

/**
 * Telegram dialog filter ids are positive integers assigned by the server;
 * the Archive (1) is not a custom folder and is rejected downstream as
 * unknown rather than edited.
 */
function validateChatFolderId(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Folder id is required");
  }
}

function validateChatFolderInput(input: ChatFolderInput): ChatFolderInput {
  const title = input.title.trim();
  if (!title) throw new Error("Folder name is required");
  if (title.length > 128) {
    throw new Error("Folder name must be at most 128 characters");
  }
  const chatIds = input.chatIds.map((id) => id.trim());
  if (chatIds.some((id) => !id)) throw new Error("Chat id is required");
  if (new Set(chatIds).size !== chatIds.length) {
    throw new Error("Folder chats contain duplicates");
  }
  return { title, chatIds };
}

function validateChatCursor(
  cursor: NonNullable<ChatPageInput["cursor"]>,
): void {
  if (!cursor.trim()) throw new Error("Chat cursor is required");
}

/**
 * A voice note is always a single audio recording (TDLib voice notes cannot
 * ride an album), so the marker is validated before it is stamped on the
 * staged file. The duration the TDLib payload carries is the recorder's
 * wall-clock measure; tdesktop decodes the opus stream instead, but the
 * bytes are not readable in the renderer.
 */
function markVoiceNoteUpload(
  files: ReadonlyArray<TelegramUploadFile>,
  durationSeconds: number,
): ReadonlyArray<TelegramUploadFile> {
  if (files.length !== 1) {
    throw new Error("A voice note send carries exactly one recording");
  }
  const [file] = files;
  if (!file.mimeType.startsWith("audio/")) {
    throw new Error("A voice note upload must be an audio recording");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error("Voice note duration is invalid");
  }
  return [{ ...file, kind: "voice", durationSeconds }];
}

/**
 * A scheduled send must land in the future (TDLib bounds it to 367 days out
 * and rejects past dates; the future check is what the composer can act on,
 * so it fails here instead of surfacing a raw TDLib error).
 */
function validateSendAt(sendAt: number): void {
  if (!Number.isFinite(sendAt) || sendAt * 1000 <= Date.now()) {
    throw new Error("Schedule time must be in the future");
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
