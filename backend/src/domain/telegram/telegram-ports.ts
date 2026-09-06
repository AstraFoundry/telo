import type {
  AnimatedEmojiEffectDto,
  BotCallbackAnswerDto,
  ChatDto,
  ChatFolderDto,
  ChatMemberDto,
  ChatPageCursorDto,
  ChatPageDto,
  ChatPageInput,
  CurrentUserDto,
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
  GlobalSearchResultDto,
  MessageDto,
  MessageEntityDto,
  MessagePageDto,
  MessagePageInput,
  MessageSearchPageDto,
  MessageSearchPageInput,
  PeerProfileDto,
  SetMessageReactionInput,
  StickerItemDto,
  StickerCatalogDto,
  StickerSetDto,
  StickerSetReferenceDto,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";

export interface TelegramRepository {
  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void;
  getCurrentUser(): Promise<CurrentUserDto>;
  listChatPage(input: ChatPageInput): Promise<ChatPageDto>;
  /** Starts a device-local E2EE secret chat with the given user. */
  createSecretChat(userId: string): Promise<ChatDto>;
  /**
   * Opens Saved Messages even when that chat is not in the loaded dialog
   * page. TDLib's Saved Messages chat id is `getMe().id`.
   */
  openSavedMessages(): Promise<ChatDto>;
  /**
   * Lists the chat folders (custom folders plus the Archive when it holds
   * chats) with server-computed unread counts.
   */
  listFolders(): Promise<ReadonlyArray<ChatFolderDto>>;
  listMessagePage(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto>;
  /**
   * The chat's shared media: photo, video, and file messages, paged with the
   * same cursor semantics as `listMessagePage`.
   */
  listSharedMedia(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto>;
  /** The chat's pinned messages, most recently pinned first. */
  listPinnedMessages(chatId: string): Promise<ReadonlyArray<MessageDto>>;
  /**
   * Members of a group chat, for mention autocomplete. Empty for chats
   * without a member list (direct, channel, Saved Messages).
   */
  listChatMembers(chatId: string): Promise<ReadonlyArray<ChatMemberDto>>;
  /**
   * Identity card for one peer, for message authors that have no dialog to
   * open (group members, channel posters).
   */
  getPeerProfile(peerId: string): Promise<PeerProfileDto>;
  /**
   * The account's installed sticker sets, each with its stickers. Sticker ids
   * are media keys the download pipeline understands, so the picker draws
   * them through the same path as the transcript.
   */
  listStickerSets(): Promise<ReadonlyArray<StickerSetDto>>;
  getStickerCatalog(): Promise<StickerCatalogDto>;
  reorderStickerSets(setIds: ReadonlyArray<string>): Promise<void>;
  setStickerFavorite(stickerId: string, favorite: boolean): Promise<void>;
  removeRecentSticker(stickerId: string): Promise<void>;
  clearRecentStickers(): Promise<void>;
  searchStickers(query: string): Promise<ReadonlyArray<StickerItemDto>>;
  /** Sends one sticker from an installed set into a chat. */
  sendSticker(
    chatId: string,
    stickerId: string,
    clientId?: string,
  ): Promise<MessageDto>;
  /**
   * One set by short name, for the sheet a received sticker opens. Unlike
   * the picker's list this can return a set the account has not installed.
   */
  getStickerSet(reference: StickerSetReferenceDto): Promise<StickerSetDto>;
  /** Adds the set to the account's stickers, or removes it. */
  setStickerSetInstalled(shortName: string, installed: boolean): Promise<void>;
  /**
   * Resolves the documents behind `custom-emoji` entities. They are sticker
   * documents, so the results carry the same media ids as set stickers.
   */
  getCustomEmoji(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<StickerItemDto>>;
  /** Server-side global search across chat titles and message bodies. */
  searchGlobal(query: string): Promise<GlobalSearchResultDto>;
  /** Server-side search within one chat; ids come back newest first. */
  searchMessages(
    chatId: string,
    query: string,
    input: MessageSearchPageInput,
  ): Promise<MessageSearchPageDto>;
  sendMessage(
    chatId: string,
    body: string,
    replyToId?: string,
    clientId?: string,
    /** Telegram "send without sound" flag. */
    silent?: boolean,
    /**
     * Composer-authored formatting spans (UTF-16 ranges over `body`);
     * adapters map them onto Telegram message entities at send time.
     */
    entities?: ReadonlyArray<MessageEntityDto>,
  ): Promise<MessageDto>;
  downloadMedia(mediaId: string): Promise<void>;
  cancelMediaDownload(mediaId: string): Promise<void>;
  /**
   * Ensures the media is present in the local cache (downloading it when
   * needed) and resolves to the cached file's absolute path. The path is an
   * opaque infrastructure detail, like `TelegramUploadFile.source`.
   */
  resolveMediaFile(mediaId: string): Promise<string>;
  sendMedia(
    chatId: string,
    files: ReadonlyArray<TelegramUploadFile>,
    caption: string,
    replyToId: string | undefined,
    clientId: string | undefined,
    uploadId: string,
  ): Promise<ReadonlyArray<MessageDto>>;
  cancelMediaUpload(uploadId: string): Promise<void>;
  /**
   * Edits an outgoing message. Telegram only allows editing one's own
   * messages; adapters reject non-outgoing targets.
   */
  editMessage(input: EditMessageInput): Promise<void>;
  deleteMessage(input: DeleteMessageInput): Promise<void>;
  /**
   * Forwards a message to another chat. The forwarded copy is a new outgoing
   * message in the target chat and never carries a replyTo snapshot.
   */
  forwardMessage(input: ForwardMessageInput): Promise<void>;
  setChatPinned(chatId: string, pinned: boolean): Promise<void>;
  setChatMuted(chatId: string, muted: boolean): Promise<void>;
  /**
   * Marks a dialog read or unread. Read clears the unread counter; unread
   * flags the dialog (`unreadCount` becomes 1 in the demo workspace).
   */
  setChatRead(chatId: string, read: boolean): Promise<void>;
  /**
   * Moves a dialog into or out of the Archive (`folder_id` 1 ↔ 0). Archive
   * membership is the dialog's `folderId`; unread counts are untouched.
   */
  setChatArchived(chatId: string, archived: boolean): Promise<void>;
  /** Sends (or cancels) the local user's typing signal for a chat. */
  setTyping(chatId: string, typing: boolean): Promise<void>;
  /** Persists the composer draft server-side; an empty string clears it. */
  saveDraft(chatId: string, text: string): Promise<void>;
  /**
   * Presses a `"callback"` inline keyboard button. Adapters look the
   * button's opaque callback payload up from the message it belongs to, so
   * the bytes Telegram expects never leave the main process. Pressing a
   * button of any other kind, or one the adapter can no longer resolve,
   * rejects — a press that silently answered "nothing happened" would be
   * indistinguishable from a bot that chose to stay silent.
   */
  answerBotCallback(
    chatId: string,
    messageId: string,
    buttonId: string,
  ): Promise<BotCallbackAnswerDto>;
  /**
   * Adds or removes this account's reaction on a message.
   */
  setMessageReaction(input: SetMessageReactionInput): Promise<void>;
  /**
   * Emoji the picker may offer, in Telegram's own order. Prefer the
   * per-message list (`getMessageAvailableReactions`) when `messageId` is
   * given; otherwise the chat's allowed set / the account's active emoji.
   */
  listAvailableReactions(
    chatId: string,
    messageId?: string,
  ): Promise<ReadonlyArray<string>>;
  /**
   * Reports a click on an animated-emoji message and answers with the
   * oversized sticker to play over it, or null when Telegram has none and the
   * bubble's own animation should simply replay.
   */
  clickAnimatedEmoji(
    chatId: string,
    messageId: string,
  ): Promise<AnimatedEmojiEffectDto | null>;
  /**
   * Ends the current session: disconnects the client and clears the stored
   * session. A no-op for the demo workspace; the demo reset is owned by the
   * renderer clearing the demoWorkspace preference.
   */
  logout(): Promise<void>;
}

export interface TelegramUploadFile {
  /** Opaque source understood only by the infrastructure adapter. */
  readonly source: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
}

/**
 * Per-account TDLib database directory plus a `safeStorage`-derived
 * encryption key. Park leaves the directory; logout deletes it.
 */
export interface TelegramAccountDatabase {
  readonly directory: string;
  encryptionKey(): Promise<string>;
  clear(): Promise<void>;
}

export interface TelegramConnectionProfile {
  readonly apiId: number;
  readonly apiHash: string;
  readonly phoneNumber: string;
}

export interface TelegramConnectionProfileRepository {
  get(): Promise<TelegramConnectionProfile | null>;
  save(profile: TelegramConnectionProfile): Promise<void>;
}

/**
 * Disk snapshot of the dialog list, mirroring Nicegram's SQLite cache: the
 * workspace can paint chats while Telegram is still connecting, and folder
 * badges are computed from this list instead of a second full GetDialogs.
 */
export interface TelegramDialogSnapshot {
  readonly version: 1;
  readonly chats: ReadonlyArray<ChatDto>;
  readonly folders: ReadonlyArray<ChatFolderDto>;
  readonly nextCursor: ChatPageCursorDto | null;
}

export interface TelegramDialogSnapshotRepository {
  get(): Promise<TelegramDialogSnapshot | null>;
  save(snapshot: TelegramDialogSnapshot): Promise<void>;
  clear(): Promise<void>;
}
