import type {
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
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";

export interface TelegramRepository {
  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void;
  getCurrentUser(): Promise<CurrentUserDto>;
  listChatPage(input: ChatPageInput): Promise<ChatPageDto>;
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
  /** Sends (or cancels) the local user's typing signal for a chat. */
  setTyping(chatId: string, typing: boolean): Promise<void>;
  /** Persists the composer draft server-side; an empty string clears it. */
  saveDraft(chatId: string, text: string): Promise<void>;
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

export interface TelegramSessionRepository {
  get(): Promise<string>;
  save(session: string): Promise<void>;
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
