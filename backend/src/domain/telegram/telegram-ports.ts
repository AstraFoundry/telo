import type {
  ChatDto,
  ChatFolderDetailsDto,
  ChatFolderDto,
  ChatFolderInput,
  ChatMemberDto,
  ChatPageCursorDto,
  ChatPageDto,
  ChatPageInput,
  CreateTelegramChannelInput,
  CreateTelegramGroupInput,
  UpdateChatFolderInput,
} from "./chat";
import type { TelegramCallPageDto } from "./call";
import type {
  AddContactByPhoneInput,
  SetPeerContactInput,
  TelegramContactDto,
} from "./contact";
import type {
  BotCallbackAnswerDto,
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
  PinMessageInput,
  SetMessageReactionInput,
} from "./message";
import type {
  CurrentUserDto,
  PeerProfileDto,
  UpdateProfileNameInput,
  UsernameAvailability,
} from "./profile";
import type { PostedStoryDto, PostStoryInput } from "./story";
import type {
  AnimatedEmojiEffectDto,
  StickerCatalogDto,
  StickerItemDto,
  StickerSetDto,
  StickerSetReferenceDto,
} from "./sticker";
import type { SendPollInput } from "./poll";
import type { TelegramWorkspaceEvent } from "./workspace-event";

export interface TelegramRepository {
  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void;
  getCurrentUser(): Promise<CurrentUserDto>;
  listChatPage(input: ChatPageInput): Promise<ChatPageDto>;
  /**
   * One chat by id, or null when the adapter has not loaded it. Send paths
   * read the chat's permission flags through this lookup before posting.
   */
  getChat(chatId: string): Promise<ChatDto | null>;
  /**
   * Renames the account (Telegram `setName`) and returns the refreshed
   * identity. First name must be non-empty.
   */
  updateProfileName(input: UpdateProfileNameInput): Promise<CurrentUserDto>;
  /**
   * Sets the account bio (Telegram `setBio`); an empty string clears it.
   * Telegram bios hold no line feeds, so adapters flatten them.
   */
  updateBio(bio: string): Promise<void>;
  /**
   * Checks a personal username (Telegram `checkChatUsername` on the Saved
   * Messages chat) without claiming it.
   */
  checkUsernameAvailability(username: string): Promise<UsernameAvailability>;
  /**
   * Claims or replaces the account username (Telegram `setUsername`); an
   * empty string removes it.
   */
  setUsername(username: string): Promise<CurrentUserDto>;
  /** Replaces the account profile photo (Telegram `setProfilePhoto`). */
  setProfilePhoto(file: TelegramUploadFile): Promise<CurrentUserDto>;
  /**
   * Phone-first contact creation (Telegram `importContacts`). Resolves to
   * null when the number is not registered on Telegram.
   */
  addContactByPhone(
    input: AddContactByPhoneInput,
  ): Promise<TelegramContactDto | null>;
  /** Adds or edits a known peer as a contact (Telegram `addContact`). */
  setPeerContact(input: SetPeerContactInput): Promise<void>;
  /** Removes a peer from the contact list (Telegram `removeContacts`). */
  removePeerContact(userId: string): Promise<void>;
  /** Starts a device-local E2EE secret chat with the given user. */
  createSecretChat(userId: string): Promise<ChatDto>;
  listContacts(): Promise<ReadonlyArray<TelegramContactDto>>;
  openPrivateChat(userId: string): Promise<ChatDto>;
  createGroup(input: CreateTelegramGroupInput): Promise<ChatDto>;
  createChannel(input: CreateTelegramChannelInput): Promise<ChatDto>;
  listCalls(cursor?: string | null): Promise<TelegramCallPageDto>;
  postStory(
    file: TelegramUploadFile,
    input: PostStoryInput,
  ): Promise<PostedStoryDto>;
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
  /**
   * One native folder's edit state (title plus included chats) for the
   * folder editor (TDLib `getChatFolder`). Resolves to null when the id is
   * not a known custom folder — the Archive is not editable.
   */
  getChatFolder(folderId: number): Promise<ChatFolderDetailsDto | null>;
  /**
   * Creates a native dialog filter (TDLib `createChatFolder`). The server
   * echoes the change as `updateChatFolders`, which the adapters surface as
   * a `folders` event.
   */
  createChatFolder(input: ChatFolderInput): Promise<ChatFolderDto>;
  /**
   * Renames a folder and replaces its always-included chats (TDLib
   * `editChatFolder`), preserving the filter's other flags — tdesktop's
   * editor keeps them when only the name or chat list changes.
   */
  editChatFolder(input: UpdateChatFolderInput): Promise<ChatFolderDto>;
  /**
   * Removes a native dialog filter (TDLib `deleteChatFolder`); member chats
   * fall back to the main list.
   */
  deleteChatFolder(folderId: number): Promise<void>;
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
    /**
     * Unix seconds of the scheduled delivery (TDLib
     * `messageSchedulingStateSendAtDate`). When set the message lands in the
     * chat's scheduled list instead of the live transcript.
     */
    sendAt?: number,
  ): Promise<MessageDto>;
  /**
   * The chat's scheduled messages, soonest delivery first (TDLib
   * `getChatScheduledMessages`).
   */
  listScheduledMessages(chatId: string): Promise<ReadonlyArray<MessageDto>>;
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
  /**
   * Pins or unpins a message in its chat (TDLib `pinChatMessage` /
   * `unpinChatMessage`). See `PinMessageInput` for the notification
   * semantics of `silent`.
   */
  pinMessage(input: PinMessageInput): Promise<void>;
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
   * Sets this account's answer on a poll (TDLib `setPollAnswer`; older TDLib
   * schemas named the same method `setMessagePollAnswer`). `optionIds` are
   * 0-based option indexes; an empty list retracts the answer. The new
   * tally arrives as an edited-message upsert.
   */
  setMessagePollAnswer(
    chatId: string,
    messageId: string,
    optionIds: ReadonlyArray<number>,
  ): Promise<void>;
  /**
   * Creates a poll in the chat (TDLib `sendMessage` with
   * `inputMessagePoll`). Kept off the text `sendMessage` path because the
   * input carries no body and passes different validation.
   */
  sendPoll(chatId: string, input: SendPollInput): Promise<MessageDto>;
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
  /**
   * `"voice"` marks a composer-recorded voice note: the TDLib adapter sends
   * `inputMessageVoiceNote` instead of deriving the content type from
   * `mimeType`. Omitted means a regular photo/video/document upload.
   */
  readonly kind?: "voice";
  /**
   * Recorder-measured duration in seconds, set when `kind` is `"voice"`.
   * Wall-clock from the composer's MediaRecorder session, not a decode of
   * the stream the way tdesktop measures it.
   */
  readonly durationSeconds?: number;
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
