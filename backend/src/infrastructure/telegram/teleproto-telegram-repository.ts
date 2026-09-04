import path from "node:path";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";

import { Api, helpers, TelegramClient, utils } from "teleproto";
import { CustomFile } from "teleproto/client/uploads.js";
import {
  DeletedMessage,
  EditedMessage,
  MessageRead,
  NewMessage,
  Raw,
  UserUpdate,
  type DeletedMessageEvent,
  type EditedMessageEvent,
  type MessageReadEvent,
  type NewMessageEvent,
  type UserUpdateEvent,
} from "teleproto/events/index.js";
import { StringSession } from "teleproto/sessions/index.js";
import {
  ConnectionTCPObfuscated,
  UpdateConnectionState,
} from "teleproto/network/index.js";
import { ChannelInvalidError, FloodWaitError } from "teleproto/errors/index.js";

import type {
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
  MessageForwardDto,
  MessagePageDto,
  MessagePageInput,
  MessageReplyToDto,
  MessageSearchPageDto,
  MessageSearchPageInput,
  PeerProfileDto,
  SetMessageReactionInput,
  StickerFormat,
  StickerCatalogDto,
  StickerItemDto,
  StickerSetDto,
  StickerSetReferenceDto,
  StickerSetSummaryDto,
  TelegramAuthState,
  TelegramLoginConfigurationDto,
  TelegramLoginInput,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";
import { ARCHIVE_FOLDER_ID } from "../../../../contracts/src/ipc";
import type {
  TelegramDialogSnapshot,
  TelegramDialogSnapshotRepository,
  TelegramRepository,
  TelegramUploadFile,
  TelegramConnectionProfileRepository,
  TelegramSessionRepository,
} from "../../domain/telegram/telegram-ports";
import { DemoTelegramRepository } from "./demo-telegram-repository";
import {
  MemoryTelegramDialogSnapshotRepository,
  dialogSnapshotPage,
} from "./file-telegram-dialog-snapshot-repository";
import {
  MEDIA_CACHE_MAX_BYTES,
  avatarCacheFileName,
  avatarMediaUrl,
  chatIdFromAvatarFileName,
  enforceMediaCacheLimit,
  listCachedAvatarUrls,
  touchMediaCacheFile,
} from "./media-cache";
import {
  mapMessageEntities,
  mapMessageEntitiesForSend,
} from "./teleproto-message-entities";
import {
  isServiceMessage,
  mapMessageMedia,
  messageGroupedId,
  stickerFormat,
} from "./teleproto-message-media";
import { mapMessageReactions } from "./teleproto-message-reactions";
import { mapBotCallbackAnswer, mapReplyMarkup } from "./teleproto-reply-markup";
import { stickerOutlineOf } from "./sticker-outline";
import { countStickersHash } from "./sticker-hash";
import {
  buildChatFolders,
  dialogFolderId,
  mapDialogFilter,
  type ChatFolderFilter,
  type FolderDialogFacts,
} from "./teleproto-folders";

type Challenge = {
  readonly kind: "code" | "password";
  readonly resolve: (value: string) => void;
};

type UploadProgress = ((progress: number) => void) & { isCanceled?: boolean };
type AvatarEntity = Parameters<TelegramClient["downloadProfilePhoto"]>[0];
// What `client.downloadMedia` accepts: a whole message, whose input chat also
// refreshes an expired file reference, or a bare media object — the only
// handle a sticker resolved outside any message has.
type DownloadableMedia = Parameters<TelegramClient["downloadMedia"]>[0];

// Telegram peers name themselves differently by kind: users carry a first and
// last name, channels and groups a title, and either may only have a username.
type NamedPeer = {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly title?: string;
  readonly username?: string;
};

type ResolvedSender = {
  /** Peer id keying the avatar cache; empty when the peer did not resolve. */
  readonly id: string;
  readonly name: string;
  /** The peer to download the photo from, undefined when none resolved. */
  readonly entity: AvatarEntity | undefined;
};

// Where following a forward attribution leads: the peer to open and, when the
// header pins one down, the message to scroll to inside it.
type ForwardTarget = {
  readonly peer: Api.TypePeer;
  readonly messageId: string | null;
};

// Lightweight installed-set navigation as last returned by Telegram. Pack
// documents are deliberately absent: mature clients resolve only the active
// pack instead of blocking the picker on every installed pack.
type CachedStickerSets = {
  readonly hash: bigint;
  readonly sets: ReadonlyArray<StickerSetSummaryDto>;
};

// The picker's reaction emoji as this adapter last resolved them. `hash` is
// the value messages.getAvailableReactions is to be called with, so an
// unchanged set answers not-modified and these glyphs stand.
type CachedAvailableReactions = {
  readonly hash: number;
  readonly emoji: ReadonlyArray<string>;
};

const AVATAR_DOWNLOAD_CONCURRENCY = 3;
const AVATAR_CACHE_LIMIT = 200;
// Global search scans the most recent dialogs for title matches; message
// bodies still match server-side across the full history.
const GLOBAL_SEARCH_DIALOG_SCAN = 200;
const GLOBAL_SEARCH_MESSAGE_LIMIT = 50;
// Shared media is the photo/video/file slice of a chat's history; link
// previews and non-visual documents (audio, stickers, …) stay out.
const SHARED_MEDIA_KINDS = new Set(["photo", "video", "file"]);
// A set sticker has no carrying message, so its media id cannot name one.
// This prefix marks the ids the download path resolves from the documents the
// sticker set requests kept instead of from `messages.GetMessages`.
const STICKER_MEDIA_PREFIX = "sticker/";
// Those documents live in memory so the download and send paths can reach the
// sticker the picker listed, or the one the set sheet opened, without a second
// GetStickerSet. Telegram caps an account at 200 installed sets, but a
// realistic install is a few dozen sets of some 30 stickers each; this holds
// such an install many times over, and evicting the least recently used ids
// past it only costs another listing.
const STICKER_DOCUMENT_CACHE_LIMIT = 4000;
// Callback payloads of the inline keyboards this connection has mapped, so a
// press can hand Telegram back the exact bytes the bot authored. Keyboards
// are rare next to plain messages and only a mapped one can be pressed, so a
// few transcript pages' worth is generous; the least recently used message
// falls out past it, and its buttons then report themselves as gone rather
// than sending a payload from the wrong message.
const CALLBACK_DATA_MESSAGE_LIMIT = 500;
// The cache file name carries the extension the renderer sniffs a sticker's
// encoding from. Set documents rarely publish a filename attribute, so the
// name comes from the format their mime type already decides.
const STICKER_FILE_NAMES: Record<StickerFormat, string> = {
  animated: "sticker.tgs",
  video: "sticker.webm",
  static: "sticker.webp",
};

class SerialTaskQueue {
  private readonly tasks: Array<() => Promise<void>> = [];
  private running = false;

  constructor(private readonly onError: (error: unknown) => void) {}

  enqueue(task: () => Promise<void>): void {
    this.tasks.push(task);
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.tasks.length > 0) {
        const task = this.tasks.shift();
        if (!task) continue;
        try {
          await task();
        } catch (error) {
          this.onError(error);
        }
      }
    } finally {
      this.running = false;
      if (this.tasks.length > 0) void this.drain();
    }
  }
}

/**
 * Telegram rate-limits `messages.GetDialogs`. Keep overlapping calls
 * exclusive so a paged chat-list fetch never races a search scan.
 */
class ExclusiveTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export class TelegramClientCoordinator implements TelegramRepository {
  private readonly listeners = new Set<
    (event: TelegramWorkspaceEvent) => void
  >();
  private repository: TelegramRepository;
  private unsubscribeRepository: () => void;
  private state: TelegramAuthState = { status: "idle" };
  private challenge: Challenge | null = null;
  private client: TelegramClient | null = null;
  private snapshot: TelegramDialogSnapshot | null = null;

  constructor(
    private readonly sessions: TelegramSessionRepository,
    private readonly profiles: TelegramConnectionProfileRepository,
    private readonly applicationCredentials: {
      readonly apiId: number;
      readonly apiHash: string;
    } | null,
    private readonly onState: (state: TelegramAuthState) => void,
    private readonly mediaCacheDirectory = "",
    private readonly snapshots: TelegramDialogSnapshotRepository = new MemoryTelegramDialogSnapshotRepository(),
    /** Reads the user's media-cache ceiling in bytes at eviction time. */
    private readonly mediaCacheLimitBytes: () => Promise<number> = async () =>
      MEDIA_CACHE_MAX_BYTES,
  ) {
    this.repository = this.createDemoRepository();
    this.unsubscribeRepository = this.repository.subscribe((event) =>
      this.publish(event),
    );
  }

  // The demo workspace shares the media cache directory with the live one so
  // demo downloads exercise the same cache, protocol, and LRU path.
  private createDemoRepository(): DemoTelegramRepository {
    return new DemoTelegramRepository({
      mediaCacheDirectory: this.mediaCacheDirectory || undefined,
      mediaCacheLimitBytes: this.mediaCacheLimitBytes,
      // The e2e profile stretches the counterpart's reply delay: the
      // automation spec's contract is that a settings round trip lands inside
      // the reply window, and 1400ms no longer fits it when the suite runs
      // several Electron instances in parallel. Interactive demo sessions
      // keep the snappier default.
      autoReplyDelayMs: process.env.TELO_E2E === "1" ? 3000 : undefined,
    });
  }

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getAuthState(): TelegramAuthState {
    return this.state;
  }

  async getLoginConfiguration(): Promise<TelegramLoginConfigurationDto> {
    return {
      applicationCredentialsConfigured: Boolean(
        this.applicationCredentials ?? (await this.profiles.get()),
      ),
    };
  }

  async initialize(): Promise<void> {
    try {
      const session = await this.sessions.get();
      const profile = await this.profiles.get();
      const credentials = this.applicationCredentials ?? profile;
      this.snapshot = await this.snapshots.get();
      if (!session || !credentials) return;

      this.setState({ status: "restoring" });
      const client = this.createClient(
        session,
        credentials.apiId,
        credentials.apiHash,
      );
      this.client = client;
      await client.connect();
      if (!(await client.checkAuthorization())) {
        await client.disconnect();
        this.client = null;
        await this.snapshots.clear();
        this.snapshot = null;
        this.setState({ status: "idle" });
        return;
      }
      this.replaceRepository(
        new TeleprotoRepository(
          client,
          this.mediaCacheDirectory,
          this.mediaCacheLimitBytes,
          this.snapshots,
          this.snapshot,
        ),
      );
      // This adapter has no persisted pts/qts state to diff from. The paged
      // dialogs/messages reads below are the authoritative startup snapshot;
      // a catch-up here would only delay `ready` and dispatch events before
      // the renderer has subscribed. Teleproto still tracks gaps for the live
      // connection, and the repository catches up after an actual reconnect.
      this.setState({ status: "ready" });
    } catch (error) {
      this.client = null;
      this.setState({ status: "error", message: safeError(error) });
    }
  }

  async beginLogin(input: TelegramLoginInput): Promise<void> {
    const savedProfile = await this.profiles.get();
    const apiId =
      this.applicationCredentials?.apiId ?? savedProfile?.apiId ?? input.apiId;
    const apiHash =
      this.applicationCredentials?.apiHash ??
      savedProfile?.apiHash ??
      input.apiHash?.trim();
    if (!Number.isInteger(apiId) || !apiId || apiId <= 0)
      throw new Error("Telegram API id is invalid");
    if (!apiHash) throw new Error("Telegram API hash is required");
    if (!input.phoneNumber.trim()) throw new Error("Phone number is required");

    await this.disconnectCurrentClient();
    const client = this.createClient(await this.sessions.get(), apiId, apiHash);
    const profile = { apiId, apiHash, phoneNumber: input.phoneNumber.trim() };
    this.client = client;
    this.setState({ status: "connecting" });

    void client
      .start({
        phoneNumber: input.phoneNumber.trim(),
        phoneCode: () => this.waitForChallenge("code"),
        password: (hint) => {
          this.setState({ status: "password-required", hint: hint || null });
          return this.waitForChallenge("password", false);
        },
        onError: (error) => {
          this.setState({ status: "error", message: safeError(error) });
        },
      })
      .then(async () => {
        await this.sessions.save(client.session.save() as string);
        await this.profiles.save(profile);
        this.replaceRepository(
          new TeleprotoRepository(
            client,
            this.mediaCacheDirectory,
            this.mediaCacheLimitBytes,
            this.snapshots,
            null,
          ),
        );
        // A newly authorized session starts from Telegram's current update
        // state; dialogs/messages provide the initial workspace snapshot.
        this.setState({ status: "ready" });
      })
      .catch((error: unknown) => {
        this.setState({ status: "error", message: safeError(error) });
      });
  }

  async submitChallenge(value: string): Promise<void> {
    const challenge = this.challenge;
    if (!challenge)
      throw new Error("Telegram is not waiting for a login challenge");
    if (!value.trim()) throw new Error("Telegram login value is required");
    this.challenge = null;
    this.setState({ status: "connecting" });
    challenge.resolve(value.trim());
  }

  getCurrentUser(): Promise<CurrentUserDto> {
    return this.repository.getCurrentUser();
  }

  async listChatPage(input: ChatPageInput = {}): Promise<ChatPageDto> {
    if (
      !(this.repository instanceof TeleprotoRepository) &&
      this.snapshot &&
      this.state.status === "restoring"
    ) {
      return dialogSnapshotPage(
        await this.snapshotWithCachedAvatars(this.snapshot),
        input,
      );
    }
    return this.repository.listChatPage(input);
  }

  private async snapshotWithCachedAvatars(
    snapshot: TelegramDialogSnapshot,
  ): Promise<TelegramDialogSnapshot> {
    const urls = this.mediaCacheDirectory
      ? await listCachedAvatarUrls(this.mediaCacheDirectory)
      : new Map<string, string>();
    return {
      ...snapshot,
      chats: snapshot.chats.map((chat) => {
        const avatarDataUrl = urls.get(chat.id) ?? chat.avatarDataUrl;
        return {
          ...chat,
          avatarDataUrl,
          avatarPending: !avatarDataUrl,
        };
      }),
    };
  }

  listFolders(): Promise<ReadonlyArray<ChatFolderDto>> {
    if (
      !(this.repository instanceof TeleprotoRepository) &&
      this.snapshot &&
      this.state.status === "restoring"
    ) {
      return Promise.resolve(this.snapshot.folders);
    }
    return this.repository.listFolders();
  }

  listMessagePage(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    return this.repository.listMessagePage(chatId, input);
  }

  listSharedMedia(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    return this.repository.listSharedMedia(chatId, input);
  }

  listPinnedMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    return this.repository.listPinnedMessages(chatId);
  }

  listChatMembers(chatId: string): Promise<ReadonlyArray<ChatMemberDto>> {
    return this.repository.listChatMembers(chatId);
  }

  getPeerProfile(peerId: string): Promise<PeerProfileDto> {
    return this.repository.getPeerProfile(peerId);
  }

  listStickerSets(): Promise<ReadonlyArray<StickerSetDto>> {
    return this.repository.listStickerSets();
  }

  getStickerCatalog(): Promise<StickerCatalogDto> {
    return this.repository.getStickerCatalog();
  }

  reorderStickerSets(setIds: ReadonlyArray<string>): Promise<void> {
    return this.repository.reorderStickerSets(setIds);
  }

  setStickerFavorite(stickerId: string, favorite: boolean): Promise<void> {
    return this.repository.setStickerFavorite(stickerId, favorite);
  }

  removeRecentSticker(stickerId: string): Promise<void> {
    return this.repository.removeRecentSticker(stickerId);
  }

  clearRecentStickers(): Promise<void> {
    return this.repository.clearRecentStickers();
  }

  searchStickers(query: string): Promise<ReadonlyArray<StickerItemDto>> {
    return this.repository.searchStickers(query);
  }

  sendSticker(chatId: string, stickerId: string): Promise<MessageDto> {
    return this.repository.sendSticker(chatId, stickerId);
  }

  getStickerSet(reference: StickerSetReferenceDto): Promise<StickerSetDto> {
    return this.repository.getStickerSet(reference);
  }

  getCustomEmoji(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<StickerItemDto>> {
    return this.repository.getCustomEmoji(documentIds);
  }

  setStickerSetInstalled(shortName: string, installed: boolean): Promise<void> {
    return this.repository.setStickerSetInstalled(shortName, installed);
  }

  searchGlobal(query: string): Promise<GlobalSearchResultDto> {
    return this.repository.searchGlobal(query);
  }

  searchMessages(
    chatId: string,
    query: string,
    input: MessageSearchPageInput,
  ): Promise<MessageSearchPageDto> {
    return this.repository.searchMessages(chatId, query, input);
  }

  sendMessage(
    chatId: string,
    body: string,
    replyToId?: string,
    clientId?: string,
    silent?: boolean,
    entities?: ReadonlyArray<MessageEntityDto>,
  ): Promise<MessageDto> {
    return this.repository.sendMessage(
      chatId,
      body,
      replyToId,
      clientId,
      silent,
      entities,
    );
  }

  downloadMedia(mediaId: string): Promise<void> {
    return this.repository.downloadMedia(mediaId);
  }

  cancelMediaDownload(mediaId: string): Promise<void> {
    return this.repository.cancelMediaDownload(mediaId);
  }

  resolveMediaFile(mediaId: string): Promise<string> {
    return this.repository.resolveMediaFile(mediaId);
  }

  sendMedia(
    chatId: string,
    files: ReadonlyArray<TelegramUploadFile>,
    caption: string,
    replyToId: string | undefined,
    clientId: string | undefined,
    uploadId: string,
  ): Promise<ReadonlyArray<MessageDto>> {
    return this.repository.sendMedia(
      chatId,
      files,
      caption,
      replyToId,
      clientId,
      uploadId,
    );
  }

  cancelMediaUpload(uploadId: string): Promise<void> {
    return this.repository.cancelMediaUpload(uploadId);
  }

  setTyping(chatId: string, typing: boolean): Promise<void> {
    return this.repository.setTyping(chatId, typing);
  }

  saveDraft(chatId: string, text: string): Promise<void> {
    return this.repository.saveDraft(chatId, text);
  }

  editMessage(input: EditMessageInput): Promise<void> {
    return this.repository.editMessage(input);
  }

  deleteMessage(input: DeleteMessageInput): Promise<void> {
    return this.repository.deleteMessage(input);
  }

  forwardMessage(input: ForwardMessageInput): Promise<void> {
    return this.repository.forwardMessage(input);
  }

  answerBotCallback(
    chatId: string,
    messageId: string,
    buttonId: string,
  ): Promise<BotCallbackAnswerDto> {
    return this.repository.answerBotCallback(chatId, messageId, buttonId);
  }

  setMessageReaction(input: SetMessageReactionInput): Promise<void> {
    return this.repository.setMessageReaction(input);
  }

  listAvailableReactions(chatId: string): Promise<ReadonlyArray<string>> {
    return this.repository.listAvailableReactions(chatId);
  }

  setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    return this.repository.setChatPinned(chatId, pinned);
  }

  setChatMuted(chatId: string, muted: boolean): Promise<void> {
    return this.repository.setChatMuted(chatId, muted);
  }

  setChatRead(chatId: string, read: boolean): Promise<void> {
    return this.repository.setChatRead(chatId, read);
  }

  setChatArchived(chatId: string, archived: boolean): Promise<void> {
    return this.repository.setChatArchived(chatId, archived);
  }

  async logout(): Promise<void> {
    await this.disconnectCurrentClient();
    this.client = null;
    this.challenge = null;
    this.snapshot = null;
    await this.snapshots.clear();
    this.replaceRepository(this.createDemoRepository());
    await this.sessions.clear();
    this.setState({ status: "idle" });
  }

  /**
   * Parks the connection without ending the session: the client
   * disconnects and the workspace falls back to the demo adapter, but the
   * stored session and dialog snapshot stay on disk so `initialize()` can
   * restore them. The account switcher calls this when another account
   * becomes active; `logout()` is the variant that ends the session.
   */
  async disconnect(): Promise<void> {
    await this.disconnectCurrentClient();
    this.client = null;
    this.challenge = null;
    this.replaceRepository(this.createDemoRepository());
    this.setState({ status: "idle" });
  }

  private waitForChallenge(
    kind: Challenge["kind"],
    announce = true,
  ): Promise<string> {
    if (announce) this.setState({ status: "code-required" });
    return new Promise((resolve) => {
      this.challenge = { kind, resolve };
    });
  }

  private createClient(
    session: string,
    apiId: number,
    apiHash: string,
  ): TelegramClient {
    return new TelegramClient(new StringSession(session), apiId, apiHash, {
      // TCPFull frames each packet with a length+CRC32 header that DPI
      // middleboxes fingerprint and RST ~5s after connect. Official
      // clients use obfuscated abridged on :443 instead.
      connection: ConnectionTCPObfuscated,
      connectionRetries: 5,
      timeout: 15,
      // Sleeping inside invoke keeps GetDialogs on the exclusive queue for
      // the whole flood. Throw instead; the dialog refresh waits the server
      // delay outside that lock and retries one page.
      floodSleepThreshold: 0,
    });
  }

  private setState(state: TelegramAuthState): void {
    this.state = state;
    this.onState(state);
  }

  private async disconnectCurrentClient(): Promise<void> {
    if (this.repository instanceof TeleprotoRepository) {
      await this.repository.logout();
    } else {
      await this.client?.disconnect();
    }
  }

  private replaceRepository(repository: TelegramRepository): void {
    this.unsubscribeRepository();
    this.repository = repository;
    this.unsubscribeRepository = repository.subscribe((event) =>
      this.publish(event),
    );
  }

  private publish(event: TelegramWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

class TeleprotoRepository implements TelegramRepository {
  private readonly listeners = new Set<
    (event: TelegramWorkspaceEvent) => void
  >();
  private readonly messageChats = new Map<string, Set<string>>();
  private readonly avatarCache = new Map<string, string | null>();
  private readonly pendingAvatars: Array<{
    readonly chatId: string;
    readonly entity: AvatarEntity;
  }> = [];
  private readonly queuedAvatarChatIds = new Set<string>();
  private activeAvatarDownloads = 0;
  private connectionState: "offline" | "synchronizing" | "connected" =
    "connected";
  private connectionGeneration = 0;
  private catchUpPromise: Promise<void> | null = null;
  // True after this connection's first successful dialog page. Reconnect
  // clears it so the next catch-up refreshes the list again.
  private dialogsLive = false;
  private dialogRefresh: Promise<void> | null = null;
  private readonly updateQueue = new SerialTaskQueue((error) =>
    this.emitSyncError(error),
  );
  private readonly dialogFetchQueue = new ExclusiveTaskQueue();
  private readonly mediaDownloads = new Map<string, AbortController>();
  // In-flight downloads keyed by media id; resolveMediaFile and duplicate
  // downloadMedia calls join the same task instead of re-downloading.
  private readonly mediaDownloadTasks = new Map<
    string,
    Promise<string | null>
  >();
  // Sticker documents resolved by listStickerSets and getStickerSet, keyed by
  // the media id the picker or the set sheet hands back. Least-recently-used
  // order, bounded like the avatars.
  private readonly stickerDocuments = new Map<string, Api.Document>();
  // Inline keyboard callback payloads, indexed per message: the outer key is
  // `chatId:messageId` and the inner one is the button id, so a press names
  // the triple it was mapped under. The message is the eviction unit because
  // a keyboard's buttons live and die together — half a keyboard is never
  // useful, and pressing any of them refreshes the whole message's recency.
  // Least-recently-used order, bounded like the sticker documents.
  private readonly messageCallbackData = new Map<
    string,
    ReadonlyMap<string, Buffer>
  >();
  // The picker's installed sets, kept beside the hash Telegram is to be asked
  // with next time. While the account's list is unchanged Telegram answers
  // that hash with messages.allStickersNotModified, which is the whole point:
  // reopening the picker then costs one request instead of one per set.
  private stickerSets: CachedStickerSets | null = null;
  // The reaction picker's emoji, cached for the same reason: reopening it
  // then costs a not-modified answer instead of the full animated set.
  private availableReactions: CachedAvailableReactions | null = null;
  private readonly mediaUploads = new Map<string, UploadProgress>();
  // Cached dialog filters (custom folders); loaded with the first chat page
  // and refreshed when Telegram reports filter/folder changes.
  private dialogFilters: ReadonlyArray<ChatFolderFilter> | null = null;
  private readonly newMessageBuilder = new NewMessage({});
  private readonly editedMessageBuilder = new EditedMessage({});
  private readonly deletedMessageBuilder = new DeletedMessage({});
  private readonly inboxReadBuilder = new MessageRead({ inbox: true });
  private readonly outboxReadBuilder = new MessageRead({ inbox: false });
  private readonly onNewMessage = (event: NewMessageEvent) => {
    this.updateQueue.enqueue(() => this.handleMessageUpsert("new", event));
  };
  private readonly onEditedMessage = (event: EditedMessageEvent) => {
    this.updateQueue.enqueue(() => this.handleMessageUpsert("edited", event));
  };
  private readonly onDeletedMessage = (event: DeletedMessageEvent) => {
    this.updateQueue.enqueue(() => this.handleMessageDelete(event));
  };
  private readonly onMessageRead = (event: MessageReadEvent) => {
    this.handleMessageRead(event);
  };
  private readonly userUpdateBuilder = new UserUpdate({});
  private readonly draftUpdateBuilder = new Raw({
    types: [Api.UpdateDraftMessage],
  });
  private readonly notifySettingsUpdateBuilder = new Raw({
    types: [Api.UpdateNotifySettings],
  });
  private readonly dialogPinnedUpdateBuilder = new Raw({
    types: [Api.UpdateDialogPinned],
  });
  private readonly pinnedMessagesUpdateBuilder = new Raw({
    types: [Api.UpdatePinnedMessages, Api.UpdatePinnedChannelMessages],
  });
  private readonly messageReactionsUpdateBuilder = new Raw({
    types: [Api.UpdateMessageReactions],
  });
  private readonly dialogFilterUpdateBuilder = new Raw({
    types: [
      Api.UpdateDialogFilter,
      Api.UpdateDialogFilters,
      Api.UpdateDialogFilterOrder,
    ],
  });
  private readonly folderPeersUpdateBuilder = new Raw({
    types: [Api.UpdateFolderPeers],
  });
  private readonly userStatusUpdateBuilder = new Raw({
    types: [Api.UpdateUserStatus],
  });
  private readonly stickerCatalogUpdateBuilder = new Raw({
    types: [
      Api.UpdateNewStickerSet,
      Api.UpdateStickerSets,
      Api.UpdateStickerSetsOrder,
      Api.UpdateMoveStickerSetToTop,
      Api.UpdateRecentStickers,
      Api.UpdateFavedStickers,
    ],
  });
  private readonly onUserUpdate = (event: UserUpdateEvent) => {
    this.handleUserUpdate(event);
  };
  private readonly onUserStatusUpdate = (update: Api.UpdateUserStatus) => {
    this.handleUserStatusUpdate(update);
  };
  private readonly onDraftUpdate = (update: Api.UpdateDraftMessage) => {
    this.updateQueue.enqueue(() => this.handleDraftUpdate(update));
  };
  private readonly onNotifySettingsUpdate = (
    update: Api.UpdateNotifySettings,
  ) => {
    this.updateQueue.enqueue(() => this.handleNotifySettingsUpdate(update));
  };
  private readonly onDialogPinnedUpdate = (update: Api.UpdateDialogPinned) => {
    this.updateQueue.enqueue(() => this.handleDialogPinnedUpdate(update));
  };
  private readonly onPinnedMessagesUpdate = (
    update: Api.UpdatePinnedMessages | Api.UpdatePinnedChannelMessages,
  ) => {
    this.updateQueue.enqueue(() => this.handlePinnedMessagesUpdate(update));
  };
  private readonly onMessageReactionsUpdate = (
    update: Api.UpdateMessageReactions,
  ) => {
    this.updateQueue.enqueue(() => this.handleMessageReactionsUpdate(update));
  };
  private readonly onFolderUpdate = () => {
    this.updateQueue.enqueue(() => this.handleFolderUpdate());
  };
  private readonly onStickerCatalogUpdate = () => {
    this.stickerSets = null;
    this.emit({ type: "sticker-catalog-changed" });
  };
  private readonly stopConnectionListener: () => void;
  private cachedDialogs: Array<{
    chat: ChatDto;
    facts: FolderDialogFacts;
  }> = [];
  private cachedNextCursor: ChatPageCursorDto | null = null;
  private avatarsHydrated = false;
  constructor(
    private readonly client: TelegramClient,
    private readonly mediaCacheDirectory: string,
    /**
     * Reads the user's cache ceiling. Consulted at each eviction rather than
     * captured once, so changing the preference governs the next download
     * without reconnecting the client.
     */
    private readonly mediaCacheLimitBytes: () => Promise<number>,
    private readonly snapshots: TelegramDialogSnapshotRepository | null = null,
    initialSnapshot: TelegramDialogSnapshot | null = null,
  ) {
    if (initialSnapshot) {
      this.cachedDialogs = initialSnapshot.chats.map((chat) => ({
        chat: {
          ...chat,
          avatarPending: !chat.avatarDataUrl,
        },
        facts: factsFromChat(chat),
      }));
      this.cachedNextCursor = initialSnapshot.nextCursor;
    }
    client.addEventHandler(this.onNewMessage, this.newMessageBuilder);
    client.addEventHandler(this.onEditedMessage, this.editedMessageBuilder);
    client.addEventHandler(this.onDeletedMessage, this.deletedMessageBuilder);
    client.addEventHandler(this.onMessageRead, this.inboxReadBuilder);
    client.addEventHandler(this.onMessageRead, this.outboxReadBuilder);
    client.addEventHandler(this.onUserUpdate, this.userUpdateBuilder);
    client.addEventHandler(this.onDraftUpdate, this.draftUpdateBuilder);
    client.addEventHandler(
      this.onNotifySettingsUpdate,
      this.notifySettingsUpdateBuilder,
    );
    client.addEventHandler(
      this.onDialogPinnedUpdate,
      this.dialogPinnedUpdateBuilder,
    );
    client.addEventHandler(
      this.onPinnedMessagesUpdate,
      this.pinnedMessagesUpdateBuilder,
    );
    client.addEventHandler(
      this.onMessageReactionsUpdate,
      this.messageReactionsUpdateBuilder,
    );
    client.addEventHandler(this.onFolderUpdate, this.dialogFilterUpdateBuilder);
    client.addEventHandler(this.onFolderUpdate, this.folderPeersUpdateBuilder);
    client.addEventHandler(
      this.onUserStatusUpdate,
      this.userStatusUpdateBuilder,
    );
    client.addEventHandler(
      this.onStickerCatalogUpdate,
      this.stickerCatalogUpdateBuilder,
    );
    this.stopConnectionListener = client.updates.on(
      "connectionState",
      async (update, next) => {
        await this.handleConnectionState(update);
        await next();
      },
    );
    client.onError = async (error) => {
      if (isSkippableEntityError(error)) return;
      console.error("Telegram client error", error);
    };
  }

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getCurrentUser(): Promise<CurrentUserDto> {
    const user = await this.client.getMe();
    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.username ||
      user.phone;
    if (!displayName) throw new Error("Telegram account has no display name");
    const avatarDataUrl = await this.avatarDataUrl(user.id.toString(), user);

    return {
      id: user.id.toString(),
      displayName,
      username: user.username ?? null,
      initials: initials(displayName),
      avatarDataUrl,
    };
  }

  async listChatPage(input: ChatPageInput): Promise<ChatPageDto> {
    await this.ensureDialogFilters();
    await this.hydrateAvatarsFromDisk();
    const limit = input.limit ?? 50;
    // The snapshot is the chat list. A live GetDialogs is a refresh, not a
    // blocking read — otherwise flood-wait sleeps occupy the exclusive queue
    // and the renderer never paints.
    if (!input.cursor && this.cachedDialogs.length > 0) {
      const generation = this.connectionGeneration;
      void this.refreshMainDialogs(generation).catch((error: unknown) => {
        if (generation === this.connectionGeneration) this.emitSyncError(error);
      });
      return {
        items: this.cachedDialogs.slice(0, limit).map((entry) => entry.chat),
        nextCursor: this.cachedNextCursor,
      };
    }
    return this.fetchDialogPage(input);
  }

  private async fetchDialogPage(input: ChatPageInput): Promise<ChatPageDto> {
    const limit = input.limit ?? 50;
    // A short flood wait is absorbed here, sleeping outside the exclusive
    // queue so other dialog reads keep flowing. The caller only ever sees a
    // page or a real failure — "Please wait N seconds" is a transport detail
    // the renderer must never have to render.
    const dialogs = await retryOnShortFloodWait(() =>
      this.dialogFetchQueue.run(() =>
        this.client.getDialogs({
          limit: limit + 1,
          offsetDate: input.cursor
            ? Math.floor(Date.parse(input.cursor.updatedAt) / 1000)
            : undefined,
          offsetId: input.cursor
            ? telegramMessageId(input.cursor.topMessageId)
            : undefined,
          offsetPeer: input.cursor?.chatId,
          ignorePinned: Boolean(input.cursor),
          // Teleproto 1.229 inverts its ignoreMigrated predicate and returns
          // only legacy Chat entities when this is true. Fetch the unfiltered
          // slice and apply the intended predicate below.
          ignoreMigrated: false,
        }),
      ),
    );
    // Advance the cursor by the raw server slice, not the filtered result.
    // A page containing a migrated legacy group may therefore render short,
    // and the sidebar sentinel will immediately request the following page
    // without skipping or repeating a visible dialog.
    const rawPage = dialogs.slice(0, limit);
    const page = rawPage.filter((dialog) => !isMigratedDialog(dialog));
    const last = rawPage.at(-1);
    const chats = page.map((dialog) => this.toChat(dialog));
    const facts = page.map((dialog) => this.folderFacts(dialog));
    this.ingestDialogs(chats, facts, !input.cursor);
    this.cachedNextCursor =
      dialogs.length > limit && last
        ? {
            chatId: this.dialogId(last),
            topMessageId: String(last.dialog.topMessage),
            updatedAt: this.dialogDate(last).toISOString(),
          }
        : null;
    if (!input.cursor) this.dialogsLive = true;
    await this.persistSnapshot();
    return { items: chats, nextCursor: this.cachedNextCursor };
  }

  async listFolders(): Promise<ReadonlyArray<ChatFolderDto>> {
    await this.ensureDialogFilters();
    return this.computeFolders();
  }

  private async ensureDialogFilters(): Promise<void> {
    if (this.dialogFilters) return;
    await this.refreshDialogFilters();
  }

  private async refreshDialogFilters(): Promise<void> {
    const result = await this.client.getDialogFilters();
    this.dialogFilters = result.filters
      .map(mapDialogFilter)
      .filter((filter): filter is ChatFolderFilter => filter !== null);
  }

  // Folder unread badges sum the unread counts of dialogs already in the
  // local snapshot — the same in-memory walk Nicegram does. Never issue a
  // second unbounded GetDialogs just to compute badges.
  private async computeFolders(): Promise<ReadonlyArray<ChatFolderDto>> {
    return buildChatFolders(
      this.dialogFilters ?? [],
      this.cachedDialogs.map((entry) => entry.facts),
    );
  }

  private ingestDialogs(
    chats: ReadonlyArray<ChatDto>,
    facts: ReadonlyArray<FolderDialogFacts>,
    replacePrefix: boolean,
  ): void {
    const incoming = chats.map((chat, index) => ({
      chat,
      facts: facts[index]!,
    }));
    if (replacePrefix) {
      const incomingIds = new Set(chats.map((chat) => chat.id));
      const rest = this.cachedDialogs.filter(
        (entry) => !incomingIds.has(entry.chat.id),
      );
      this.cachedDialogs = [...incoming, ...rest];
      return;
    }
    for (const entry of incoming) {
      const index = this.cachedDialogs.findIndex(
        (cached) => cached.chat.id === entry.chat.id,
      );
      if (index >= 0) this.cachedDialogs[index] = entry;
      else this.cachedDialogs.push(entry);
    }
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.snapshots) return;
    try {
      await this.snapshots.save({
        version: 1,
        chats: this.cachedDialogs.map((entry) => entry.chat),
        folders: await this.computeFolders(),
        nextCursor: this.cachedNextCursor,
      });
    } catch (error) {
      console.error("Telegram dialog snapshot failed", error);
    }
  }

  private folderFacts(dialog: TeleprotoDialog): FolderDialogFacts {
    const entity = dialog.entity;
    const user = entity instanceof Api.User ? entity : null;
    return {
      peerId: entity?.id?.toString() ?? this.dialogId(dialog),
      isUser: dialog.isUser,
      isGroup: dialog.isGroup,
      isBroadcast: dialog.isChannel && !dialog.isGroup,
      isBot: Boolean(user?.bot),
      isContact: Boolean(user?.contact),
      muted: this.dialogMuted(dialog),
      unreadCount: dialog.unreadCount,
      archived: dialog.archived,
    };
  }

  async listMessagePage(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    const limit = input.limit ?? 50;
    const messages = await retryOnShortFloodWait(() =>
      this.client.getMessages(chatId, {
        limit: limit + 1,
        offsetId: input.beforeMessageId
          ? telegramMessageId(input.beforeMessageId)
          : undefined,
      }),
    );
    const page = messages.slice(0, limit);
    const replyTo = await this.replySnapshots(chatId, page);
    page.forEach((message) => this.indexMessage(chatId, message));
    const items = (
      await Promise.all(
        page.map((message) =>
          this.toMessage(
            chatId,
            message,
            replyTo.get(message.id.toString()) ?? null,
          ),
        ),
      )
    ).sort((left, right) => left.sentAt.localeCompare(right.sentAt));
    return {
      items,
      nextCursor:
        messages.length > limit ? (page.at(-1)?.id.toString() ?? null) : null,
    };
  }

  // Global search has two halves, mirroring Telegram's result sections: chat
  // titles match against the most recent dialogs (the same data Telegram
  // Desktop filters locally), and message bodies hit the server-side
  // messages.searchGlobal (teleproto runs it when getMessages has no entity).
  async searchGlobal(query: string): Promise<GlobalSearchResultDto> {
    const [dialogs, found] = await Promise.all([
      this.dialogFetchQueue.run(() =>
        this.client.getDialogs({
          limit: GLOBAL_SEARCH_DIALOG_SCAN,
          // See fetchDialogPage: Teleproto 1.229's built-in predicate is
          // inverted, so migrated legacy groups are filtered locally.
          ignoreMigrated: false,
        }),
      ),
      this.client.getMessages(undefined, {
        search: query,
        limit: GLOBAL_SEARCH_MESSAGE_LIMIT,
      }),
    ]);
    const term = query.toLocaleLowerCase();
    const chats = dialogs
      .filter((dialog) => !isMigratedDialog(dialog))
      .filter((dialog) =>
        (dialog.title || dialog.name || "").toLocaleLowerCase().includes(term),
      )
      .map((dialog) => this.toChat(dialog));
    const messages = (
      await Promise.all(
        found.map(async (message) => {
          const chatId = message.chatId?.toString();
          if (!chatId) return null;
          this.indexMessage(chatId, message);
          return this.toMessage(chatId, message, null);
        }),
      )
    ).filter((message): message is MessageDto => message !== null);
    return { chats, messages };
  }

  async searchMessages(
    chatId: string,
    query: string,
    input: MessageSearchPageInput,
  ): Promise<MessageSearchPageDto> {
    const limit = input.limit ?? 50;
    // messages.Search via teleproto: results arrive newest first, and
    // offsetId is the exclusive cursor for the next older page of matches.
    const found = await this.client.getMessages(chatId, {
      search: query,
      limit: limit + 1,
      offsetId: input.beforeMessageId
        ? telegramMessageId(input.beforeMessageId)
        : undefined,
    });
    const page = found.slice(0, limit);
    page.forEach((message) => this.indexMessage(chatId, message));
    return {
      messageIds: page.map((message) => message.id.toString()),
      // teleproto always reports the server-side match count on search
      // results (MessagesSlice.count, or the full length when unpaginated).
      totalCount: found.total ?? page.length,
      nextCursor:
        found.length > limit ? (page.at(-1)?.id.toString() ?? null) : null,
    };
  }

  // Shared media rides two server-side media filters (photos+videos and
  // documents) because Telegram has no combined "visual + files" filter. Both
  // histories page by the same offsetId, so the merged feed keeps the
  // transcript's exclusive-cursor semantics.
  async listSharedMedia(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    const limit = input.limit ?? 50;
    const offsetId = input.beforeMessageId
      ? telegramMessageId(input.beforeMessageId)
      : undefined;
    const [visual, documents] = await Promise.all([
      this.client.getMessages(chatId, {
        limit: limit + 1,
        offsetId,
        filter: new Api.InputMessagesFilterPhotoVideo(),
      }),
      this.client.getMessages(chatId, {
        limit: limit + 1,
        offsetId,
        filter: new Api.InputMessagesFilterDocument(),
      }),
    ]);
    const byId = new Map<number, TeleprotoMessage>();
    for (const message of [...visual, ...documents]) {
      byId.set(message.id, message);
    }
    const merged = [...byId.values()].sort((left, right) => right.id - left.id);
    const page = merged.slice(0, limit);
    page.forEach((message) => this.indexMessage(chatId, message));
    const items = (
      await Promise.all(
        page.map((message) => this.toMessage(chatId, message, null)),
      )
    )
      .filter(
        (message) =>
          message.media !== null &&
          message.media.kind !== "webpage" &&
          SHARED_MEDIA_KINDS.has(message.media.kind),
      )
      .sort((left, right) => left.sentAt.localeCompare(right.sentAt));
    return {
      items,
      nextCursor:
        merged.length > limit ? (page.at(-1)?.id.toString() ?? null) : null,
    };
  }

  async listPinnedMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    // InputMessagesFilterPinned pages the pinned subset of the history; chats
    // pin a handful of messages, so one page covers the realistic range.
    const found = await this.client.getMessages(chatId, {
      limit: 50,
      filter: new Api.InputMessagesFilterPinned(),
    });
    found.forEach((message) => this.indexMessage(chatId, message));
    return Promise.all(
      found.map((message) => this.toMessage(chatId, message, null)),
    );
  }

  async listChatMembers(chatId: string): Promise<ReadonlyArray<ChatMemberDto>> {
    // Mention autocomplete works from one page of participants; groups far
    // outgrow the useful suggestion set long before 200 members.
    const participants = await this.client.getParticipants(chatId, {
      limit: 200,
    });
    return participants.map((member) => {
      const id = member.id.toString();
      // Photos ride the same per-peer avatar queue as message authors, so a
      // member row and that member's transcript rows share one download and
      // one settling `chat-avatar` event.
      const avatarPending = !this.avatarCache.has(id);
      if (avatarPending) this.scheduleAvatar(id, member);
      return {
        id,
        displayName:
          [member.firstName, member.lastName].filter(Boolean).join(" ") ||
          (member.username ? `@${member.username}` : id),
        username: member.username ?? null,
        avatarDataUrl: this.cachedAvatar(id),
        avatarPending,
      };
    });
  }

  // The identity card of a peer the user may have no dialog with: a group
  // member, a channel poster. Nicegram opens the same card from an avatar tap.
  async getPeerProfile(peerId: string): Promise<PeerProfileDto> {
    const entity = await this.peerEntity(peerId);
    // Teleproto's entity union splits the name across constructors; NamedPeer
    // is the one shape every one of them answers (see its declaration).
    const named = entity as NamedPeer;
    const title = namedPeerTitle(named);
    if (!title) throw new Error(`Telegram peer ${peerId} has no title`);
    const user = entity instanceof Api.User ? entity : null;
    const channel = entity instanceof Api.Channel ? entity : null;
    // The photo rides the shared per-peer avatar queue: the same cache,
    // the same disk file, and the same "chat-avatar" event the chat list
    // already listens to, so a profile never opens a second download path.
    const avatarPending = !this.avatarCache.has(peerId);
    const avatarDataUrl = this.cachedAvatar(peerId);
    if (avatarPending) this.scheduleAvatar(peerId, entity);
    const { bio, phone } = await this.peerFullInfo(entity);
    return {
      id: peerId,
      title,
      username: named.username ?? null,
      kind: user?.self
        ? "saved"
        : channel?.broadcast
          ? "channel"
          : channel || entity instanceof Api.Chat
            ? "group"
            : "direct",
      avatarDataUrl,
      avatarPending,
      bio,
      phone,
    };
  }

  private async peerEntity(peerId: string): Promise<AvatarEntity> {
    try {
      return await this.client.getEntity(peerId);
    } catch (error) {
      // A peer Telegram cannot resolve has no profile to show. Reporting the
      // failure is the honest answer; a placeholder card would claim the
      // account exists.
      throw new Error(`Telegram peer ${peerId} was not found`, {
        cause: error,
      });
    }
  }

  // Telegram keeps the about text and the phone number out of the peer entity,
  // behind a separate full-peer request and behind the peer's privacy
  // settings. That request failing — privacy, a flood wait, a peer whose full
  // info Telegram refuses — must not cost the caller the identity fields it
  // already resolved, so these two degrade to null instead of rejecting.
  private async peerFullInfo(
    entity: AvatarEntity,
  ): Promise<{ bio: string | null; phone: string | null }> {
    try {
      if (entity instanceof Api.User) {
        const full = await this.client.invoke(
          new Api.users.GetFullUser({ id: entity }),
        );
        const resolved = full.users.find(
          (candidate): candidate is Api.User => candidate instanceof Api.User,
        );
        return {
          bio: full.fullUser.about?.trim() || null,
          // Telegram only fills `phone` when the peer shares its number.
          phone: resolved?.phone?.trim() || null,
        };
      }
      // Broadcast channels and supergroups both answer channels.GetFullChannel;
      // a basic group carries no about text worth a round trip.
      if (entity instanceof Api.Channel) {
        const full = await this.client.invoke(
          new Api.channels.GetFullChannel({ channel: entity }),
        );
        const about =
          "about" in full.fullChat ? full.fullChat.about : undefined;
        return { bio: about?.trim() || null, phone: null };
      }
    } catch (error) {
      console.error("Telegram peer details failed", error);
    }
    return { bio: null, phone: null };
  }

  // Compatibility path for callers that explicitly request every pack. The
  // composer catalog below never calls this; it resolves one selected pack.
  async listStickerSets(): Promise<ReadonlyArray<StickerSetDto>> {
    const summaries = await this.listStickerSetSummaries();
    const sets: StickerSetDto[] = [];
    for (const summary of summaries) {
      try {
        sets.push(await this.getStickerSet(summary.reference));
      } catch (error) {
        console.error(
          `Telegram sticker set ${summary.shortName} failed`,
          error,
        );
      }
    }
    return sets;
  }

  private async listStickerSetSummaries(): Promise<
    ReadonlyArray<StickerSetSummaryDto>
  > {
    const cached = this.stickerSets;
    const installed = await this.client.invoke(
      new Api.messages.GetAllStickers({
        // teleproto's TL layer takes big-integer values, not native bigint.
        hash: helpers.returnBigInt(cached?.hash ?? 0n),
      }),
    );
    if (!("sets" in installed)) {
      return cached?.sets ?? [];
    }
    const sets = installed.sets.map((set) => this.stickerSetSummaryOf(set));
    this.stickerSets = {
      hash: countStickersHash(installed.sets),
      sets,
    };
    return sets;
  }

  async getStickerCatalog(): Promise<StickerCatalogDto> {
    const [sets, recentResult, favoriteResult] = await Promise.all([
      this.listStickerSetSummaries(),
      this.client.invoke(
        new Api.messages.GetRecentStickers({
          attached: false,
          hash: helpers.returnBigInt(0n),
        }),
      ),
      this.client.invoke(
        new Api.messages.GetFavedStickers({ hash: helpers.returnBigInt(0n) }),
      ),
    ]);
    // A zero hash asks for the full vectors. Keeping the guard makes an
    // unexpected not-modified response harmless without fabricating items.
    const recent =
      "stickers" in recentResult
        ? stickerDocumentsOf(recentResult.stickers).map((document) =>
            this.stickerItem(document),
          )
        : [];
    const favorites =
      "stickers" in favoriteResult
        ? stickerDocumentsOf(favoriteResult.stickers).map((document) =>
            this.stickerItem(document),
          )
        : [];
    return { recent, favorites, sets };
  }

  async reorderStickerSets(setIds: ReadonlyArray<string>): Promise<void> {
    const installed = await this.listStickerSetSummaries();
    const currentIds = new Set(installed.map((set) => set.id));
    if (
      setIds.length !== installed.length ||
      setIds.some((id) => !currentIds.has(id))
    ) {
      throw new Error("Sticker set order must contain every installed set");
    }
    await this.client.invoke(
      new Api.messages.ReorderStickerSets({
        order: setIds.map((id) => helpers.returnBigInt(BigInt(id))),
      }),
    );
    this.stickerSets = null;
    this.emit({ type: "sticker-catalog-changed" });
  }

  async setStickerFavorite(
    stickerId: string,
    favorite: boolean,
  ): Promise<void> {
    await this.client.invoke(
      new Api.messages.FaveSticker({
        id: utils.getInputDocument(this.stickerDocument(stickerId)),
        unfave: !favorite,
      }),
    );
    this.emit({ type: "sticker-catalog-changed" });
  }

  async removeRecentSticker(stickerId: string): Promise<void> {
    await this.client.invoke(
      new Api.messages.SaveRecentSticker({
        attached: false,
        id: utils.getInputDocument(this.stickerDocument(stickerId)),
        unsave: true,
      }),
    );
    this.emit({ type: "sticker-catalog-changed" });
  }

  async clearRecentStickers(): Promise<void> {
    await this.client.invoke(
      new Api.messages.ClearRecentStickers({ attached: false }),
    );
    this.emit({ type: "sticker-catalog-changed" });
  }

  async searchStickers(query: string): Promise<ReadonlyArray<StickerItemDto>> {
    const result = await this.client.invoke(
      new Api.messages.SearchStickers({
        q: query,
        emoticon: query,
        langCode: [],
        offset: 0,
        limit: 80,
        hash: helpers.returnBigInt(0n),
      }),
    );
    return "stickers" in result
      ? stickerDocumentsOf(result.stickers).map((document) =>
          this.stickerItem(document),
        )
      : [];
  }

  async getStickerSet(
    reference: StickerSetReferenceDto,
  ): Promise<StickerSetDto> {
    let resolved: Api.messages.TypeStickerSet;
    try {
      resolved = await this.client.invoke(
        new Api.messages.GetStickerSet({
          stickerset: inputStickerSet(reference),
          hash: 0,
        }),
      );
    } catch (error) {
      throw new Error("Telegram sticker set was not found", {
        cause: error,
      });
    }
    // messages.stickerSetNotModified answers a hash this adapter never sends,
    // so a set without documents is one Telegram did not resolve.
    if (!("documents" in resolved)) {
      throw new Error("Telegram sticker set was not found");
    }
    return this.stickerSetOf(
      resolved.set,
      stickerDocumentsOf(resolved.documents),
      // teleproto materializes an unset flag as null from the wire, so the
      // marker is a null check, not undefined.
      resolved.set.installedDate != null,
    );
  }

  async setStickerSetInstalled(
    shortName: string,
    installed: boolean,
  ): Promise<void> {
    const stickerset = new Api.InputStickerSetShortName({ shortName });
    if (installed) {
      // archived: false adds the set to the account's active stickers rather
      // than straight into its archive.
      await this.client.invoke(
        new Api.messages.InstallStickerSet({ stickerset, archived: false }),
      );
    } else {
      await this.client.invoke(
        new Api.messages.UninstallStickerSet({ stickerset }),
      );
    }
    // The cache is a claim about which sets the account has installed, and
    // this call just falsified it. Telegram would also refuse the now-stale
    // hash and answer with the full list, but that is the server noticing a
    // change this client made itself: dropping the cache here keeps the claim
    // honest without waiting to be corrected.
    this.stickerSets = null;
    this.emit({ type: "sticker-catalog-changed" });
  }

  // A custom-emoji entity names a bare document id. Those documents are
  // stickers, so they map through the same item mapper and land in the same
  // cache — the inline emoji then downloads on the path set stickers use.
  async getCustomEmoji(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<StickerItemDto>> {
    if (documentIds.length === 0) return [];
    const documents = await this.client.invoke(
      new Api.messages.GetCustomEmojiDocuments({
        // teleproto's TL layer takes big-integer values, not native bigint.
        documentId: documentIds.map((id) => helpers.returnBigInt(id)),
      }),
    );
    return (
      documents
        // documentEmpty is an emoji Telegram no longer serves; a missing one is
        // simply absent from the answer, which is not a failure.
        .filter((document): document is Api.Document => "mimeType" in document)
        .map((document) => this.stickerItem(document))
    );
  }

  // Both sticker paths — the picker's selected pack and a set opened from a
  // received message — end at the same set and documents, so they map here.
  private stickerSetOf(
    set: Api.StickerSet,
    documents: ReadonlyArray<Api.Document>,
    installed: boolean,
  ): StickerSetDto {
    return {
      id: set.id.toString(),
      title: set.title,
      shortName: set.shortName,
      reference: stickerSetReferenceOf(set),
      installed,
      stickers: documents.map((document) => this.stickerItem(document)),
    };
  }

  private stickerSetSummaryOf(set: Api.StickerSet): StickerSetSummaryDto {
    return {
      id: set.id.toString(),
      title: set.title,
      shortName: set.shortName,
      reference: stickerSetReferenceOf(set),
    };
  }

  private stickerItem(document: Api.Document): StickerItemDto {
    const mediaId = `${STICKER_MEDIA_PREFIX}${document.id}`;
    this.cacheStickerDocument(mediaId, document);
    const { width, height } = stickerDimensions(document);
    return {
      id: mediaId,
      emoji: stickerEmoji(document),
      format: stickerFormat(document.mimeType),
      width,
      height,
      outlinePath: stickerOutlineOf(document),
    };
  }

  async sendSticker(chatId: string, stickerId: string): Promise<MessageDto> {
    // Telegram already stores the document, so sending it costs no upload:
    // teleproto turns the document into an InputMediaDocument by id.
    const sent = await this.client.sendFile(chatId, {
      file: this.stickerDocument(stickerId),
    });
    // Telegram does not infer the recent list from sendMedia. Its API asks
    // clients to record a manually chosen sticker after it was used. The send
    // is already committed at this point, so a secondary-list failure is
    // reported to diagnostics without turning a delivered message into a
    // failed composer bubble.
    try {
      await this.client.invoke(
        new Api.messages.SaveRecentSticker({
          attached: false,
          id: utils.getInputDocument(this.stickerDocument(stickerId)),
          unsave: false,
        }),
      );
    } catch (error) {
      console.error("Telegram recent sticker update failed", error);
    }
    this.indexMessage(chatId, sent);
    return this.toMessage(chatId, sent);
  }

  // A set sticker has no message to fall back on: listing a set or opening one
  // is what resolved the document, so an id this cache no longer holds cannot
  // be downloaded or sent at all.
  private stickerDocument(mediaId: string): Api.Document {
    const document = this.stickerDocuments.get(mediaId);
    if (!document) throw new Error(`Telegram sticker ${mediaId} was not found`);
    this.cacheStickerDocument(mediaId, document);
    return document;
  }

  private cacheStickerDocument(mediaId: string, document: Api.Document): void {
    this.stickerDocuments.delete(mediaId);
    this.stickerDocuments.set(mediaId, document);
    while (this.stickerDocuments.size > STICKER_DOCUMENT_CACHE_LIMIT) {
      const oldest = this.stickerDocuments.keys().next().value;
      if (oldest === undefined) break;
      this.stickerDocuments.delete(oldest);
    }
  }

  async sendMessage(
    chatId: string,
    body: string,
    replyToId?: string,
    clientId?: string,
    silent?: boolean,
    entities?: ReadonlyArray<MessageEntityDto>,
  ): Promise<MessageDto> {
    const sent = await this.client.sendMessage(chatId, {
      message: body,
      // Disable Teleproto's default Markdown parser so punctuation never
      // creates entities the user did not author through a formatting
      // control; authored spans ride the explicit formattingEntities list.
      parseMode: false,
      formattingEntities: mapMessageEntitiesForSend(body, entities),
      replyTo: replyToId ? Number(replyToId) : undefined,
      silent,
    });
    const replyTo = replyToId
      ? ((await this.replySnapshots(chatId, [sent])).get(sent.id.toString()) ??
        null)
      : null;
    this.indexMessage(chatId, sent);
    const message = await this.toMessage(chatId, sent, replyTo);
    return clientId ? { ...message, clientId } : message;
  }

  async downloadMedia(mediaId: string): Promise<void> {
    // Duplicate triggers (auto-preload plus an explicit click) share one
    // in-flight download instead of starting parallel transfers.
    if (this.mediaDownloadTasks.has(mediaId)) return;
    // A cancelled download resolves to null; the "cancelled" event was
    // already published, so the UI path simply stops here.
    await this.ensureMediaFile(mediaId);
  }

  async resolveMediaFile(mediaId: string): Promise<string> {
    const file = await this.ensureMediaFile(mediaId);
    if (!file) throw new Error("Media download was cancelled");
    return file;
  }

  private ensureMediaFile(mediaId: string): Promise<string | null> {
    const active = this.mediaDownloadTasks.get(mediaId);
    if (active) return active;
    const task = this.performMediaDownload(mediaId).finally(() => {
      this.mediaDownloadTasks.delete(mediaId);
    });
    this.mediaDownloadTasks.set(mediaId, task);
    return task;
  }

  // Resolves to the cached file path, or null when the user cancelled.
  private async performMediaDownload(mediaId: string): Promise<string | null> {
    if (mediaId.startsWith(STICKER_MEDIA_PREFIX)) {
      const document = this.stickerDocument(mediaId);
      return this.downloadToCache(
        mediaId,
        new Api.MessageMediaDocument({ document }),
        cacheFileName(
          mediaId,
          STICKER_FILE_NAMES[stickerFormat(document.mimeType)],
        ),
        numericSize(document.size),
      );
    }
    const { chatId, messageId } = parseMediaId(mediaId);
    const [message] = await this.client.getMessages(chatId, {
      ids: [telegramMessageId(messageId)],
    });
    if (!message) {
      throw new Error(`Telegram media ${messageId} was not found`);
    }
    // MessageService actions (chat photo, pin, title) are not user media.
    if (isServiceMessage(message) || !mapMessageMedia(message)) {
      return null;
    }
    // The whole message, not its media: teleproto reads the input chat off it
    // to refresh a file reference Telegram has expired.
    return this.downloadToCache(
      mediaId,
      message,
      cacheFileName(mediaId, message.file?.name),
      numericSize(message.file?.size),
    );
  }

  // Everything a download shares whatever resolved it: one cache file per
  // media id, the abort token cancelMediaDownload reaches for, and the
  // progress and ready events the renderer paints from.
  private async downloadToCache(
    mediaId: string,
    media: DownloadableMedia,
    fileName: string,
    totalBytes: number | null,
  ): Promise<string | null> {
    if (!this.mediaCacheDirectory)
      throw new Error("Media cache is unavailable");
    await mkdir(this.mediaCacheDirectory, { recursive: true });
    const outputFile = path.join(this.mediaCacheDirectory, fileName);
    try {
      const existing = await stat(outputFile);
      await touchMediaCacheFile(outputFile);
      this.publishMediaReady(mediaId, fileName, existing.size);
      return outputFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const controller = new AbortController();
    this.mediaDownloads.set(mediaId, controller);
    this.emit({
      type: "media-download",
      mediaId,
      state: "downloading",
      downloadedBytes: 0,
      totalBytes,
      url: null,
      error: null,
    });
    try {
      await this.client.downloadMedia(media, {
        outputFile,
        signal: controller.signal,
        progressCallback: (downloaded, total) =>
          this.emit({
            type: "media-download",
            mediaId,
            state: "downloading",
            downloadedBytes: Number(downloaded.toString()),
            totalBytes: numericSize(total),
            url: null,
            error: null,
          }),
      });
      const downloaded = await stat(outputFile);
      this.publishMediaReady(mediaId, fileName, downloaded.size);
      await enforceMediaCacheLimit(
        this.mediaCacheDirectory,
        await this.mediaCacheLimitBytes(),
      );
      return outputFile;
    } catch (error) {
      this.emit({
        type: "media-download",
        mediaId,
        state: controller.signal.aborted ? "cancelled" : "failed",
        downloadedBytes: 0,
        totalBytes,
        url: null,
        error: controller.signal.aborted ? null : safeError(error),
      });
      if (!controller.signal.aborted) throw error;
      return null;
    } finally {
      this.mediaDownloads.delete(mediaId);
    }
  }

  async cancelMediaDownload(mediaId: string): Promise<void> {
    this.mediaDownloads.get(mediaId)?.abort();
  }

  async sendMedia(
    chatId: string,
    files: ReadonlyArray<TelegramUploadFile>,
    caption: string,
    replyToId: string | undefined,
    clientId: string | undefined,
    uploadId: string,
  ): Promise<ReadonlyArray<MessageDto>> {
    if (this.mediaUploads.has(uploadId))
      throw new Error("Upload is already active");
    // teleproto reports 0→1 progress per file and restarts at 0 for every
    // file of an album, so fold the per-file value into an overall 0–1
    // progress that never moves backwards.
    let completedFiles = 0;
    let lastFileProgress = 0;
    const progress: UploadProgress = (value) => {
      const current = Math.max(0, Math.min(1, value));
      if (current < lastFileProgress) {
        completedFiles = Math.min(completedFiles + 1, files.length - 1);
      }
      lastFileProgress = current;
      this.emit({
        type: "media-upload",
        uploadId,
        state: "uploading",
        progress: (completedFiles + current) / files.length,
        error: null,
      });
    };
    this.mediaUploads.set(uploadId, progress);
    progress(0);
    try {
      const uploadFiles = files.map(
        (file) => new CustomFile(file.name, file.size, file.source),
      );
      const raw = await this.client.sendFile(chatId, {
        file: uploadFiles.length === 1 ? uploadFiles[0] : uploadFiles,
        caption:
          uploadFiles.length === 1
            ? caption
            : uploadFiles.map((_, index) => (index === 0 ? caption : "")),
        parseMode: false,
        replyTo: replyToId ? Number(replyToId) : undefined,
        supportsStreaming: files.some((file) => file.mimeType === "video/mp4"),
        progressCallback: progress,
      });
      const sent = (
        Array.isArray(raw) ? raw : [raw]
      ) as ReadonlyArray<TeleprotoMessage>;
      const replyTo = replyToId
        ? await this.replySnapshots(chatId, sent)
        : new Map();
      const messages = await Promise.all(
        sent.map(async (message, index) => {
          this.indexMessage(chatId, message);
          const mapped = await this.toMessage(
            chatId,
            message,
            replyTo.get(message.id.toString()) ?? null,
          );
          return index === 0 && clientId ? { ...mapped, clientId } : mapped;
        }),
      );
      this.emit({
        type: "media-upload",
        uploadId,
        state: "ready",
        progress: 1,
        error: null,
      });
      return messages;
    } catch (error) {
      const cancelled = Boolean(progress.isCanceled);
      this.emit({
        type: "media-upload",
        uploadId,
        state: cancelled ? "cancelled" : "failed",
        progress: 0,
        error: cancelled ? null : safeError(error),
      });
      if (cancelled) {
        throw new Error("Media upload was cancelled", { cause: error });
      }
      throw error;
    } finally {
      this.mediaUploads.delete(uploadId);
    }
  }

  async cancelMediaUpload(uploadId: string): Promise<void> {
    const progress = this.mediaUploads.get(uploadId);
    if (progress) progress.isCanceled = true;
  }

  async editMessage(input: EditMessageInput): Promise<void> {
    // Telegram rejects edits of other users' messages, so no local check.
    await this.client.editMessage(input.chatId, {
      message: Number(input.messageId),
      text: input.body,
      parseMode: false,
    });
  }

  async deleteMessage(input: DeleteMessageInput): Promise<void> {
    // revoke=true deletes for every participant; scope "me" only hides the
    // message for this account. An omitted scope keeps the adapter's
    // historical delete-for-everyone behavior.
    await this.client.deleteMessages(input.chatId, [Number(input.messageId)], {
      revoke: input.scope !== "me",
    });
  }

  async forwardMessage(input: ForwardMessageInput): Promise<void> {
    await this.client.forwardMessages(input.toChatId, {
      messages: [Number(input.messageId)],
      fromPeer: input.fromChatId,
      // "Hide sender" maps to Telegram's dropAuthor: the forwarded copy loses
      // its author attribution and reads as the sender's own message.
      dropAuthor: input.hideSender ?? false,
    });
  }

  async answerBotCallback(
    chatId: string,
    messageId: string,
    buttonId: string,
  ): Promise<BotCallbackAnswerDto> {
    const answer = await this.client.invoke(
      new Api.messages.GetBotCallbackAnswer({
        peer: chatId,
        msgId: telegramMessageId(messageId),
        data: this.callbackData(chatId, messageId, buttonId),
      }),
    );
    return mapBotCallbackAnswer(answer);
  }

  async setMessageReaction(input: SetMessageReactionInput): Promise<void> {
    // sendReaction writes the account's whole reaction set for the message,
    // so clearing it is an empty list rather than a separate call, and one
    // emoji replaces the previous one without a remove first. `addToRecent`
    // is what Telegram's own clients send for a hand-picked reaction: it
    // promotes the emoji in the picker's recent row.
    await this.client.invoke(
      new Api.messages.SendReaction({
        peer: input.chatId,
        msgId: telegramMessageId(input.messageId),
        reaction:
          input.emoji === null
            ? []
            : [new Api.ReactionEmoji({ emoticon: input.emoji })],
        addToRecent: true,
      }),
    );
  }

  // The picker's emoji, kept beside the hash Telegram is to be asked with
  // next time. Every picker open calls this and the answer is heavy — each
  // entry ships five animation documents — so while the account's set is
  // unchanged Telegram answers that hash with
  // messages.availableReactionsNotModified and the cached glyphs stand, the
  // way the installed sticker sets are cached above.
  //
  // A chat can narrow the set further (`ChatFull.availableReactions`, i.e.
  // `Api.ChatReactionsSome`), but that lives behind channels.getFullChannel /
  // messages.getFullChat and this adapter keeps no full-chat cache, so
  // honoring it would add a round trip to every picker open. Telegram
  // rejects a reaction the chat forbids (REACTION_INVALID), so the narrowing
  // is enforced where it is authoritative instead of guessed at here — which
  // is why the chat is accepted but unread.
  async listAvailableReactions(chatId: string): Promise<ReadonlyArray<string>> {
    void chatId;
    const cached = this.availableReactions;
    const available = await this.client.invoke(
      new Api.messages.GetAvailableReactions({ hash: cached?.hash ?? 0 }),
    );
    if (available instanceof Api.messages.AvailableReactionsNotModified) {
      // Telegram only answers not-modified to a hash this adapter sent, and
      // it only sends a hash it has a list for.
      if (!cached) {
        throw new Error("Telegram reported unchanged reactions without a list");
      }
      return cached.emoji;
    }
    // `inactive` entries are reactions Telegram has retired: they still map
    // the buckets of messages that carry them, but no client offers them for
    // a new reaction. Server order is the order the picker draws.
    const emoji = available.reactions
      .filter((entry) => !entry.inactive)
      .map((entry) => entry.reaction);
    this.availableReactions = { hash: available.hash, emoji };
    return emoji;
  }

  // Only a mapped keyboard can be pressed, and only its callback buttons
  // carry a payload. An id that resolves to neither is not a press this
  // client can make: the button may be a url or copy control the renderer
  // should have handled itself, or it may belong to a message this cache has
  // since evicted. Either way, guessing a payload would press the wrong
  // button, so the press fails naming the button — the way an unknown
  // sticker id fails its download.
  private callbackData(
    chatId: string,
    messageId: string,
    buttonId: string,
  ): Buffer {
    const key = `${chatId}:${messageId}`;
    const buttons = this.messageCallbackData.get(key);
    const data = buttons?.get(buttonId);
    if (!buttons || !data) {
      throw new Error(
        `Telegram callback button ${buttonId} of message ${messageId} was not found`,
      );
    }
    this.cacheCallbackData(key, buttons);
    return data;
  }

  private cacheCallbackData(
    key: string,
    buttons: ReadonlyMap<string, Buffer>,
  ): void {
    this.messageCallbackData.delete(key);
    this.messageCallbackData.set(key, buttons);
    while (this.messageCallbackData.size > CALLBACK_DATA_MESSAGE_LIMIT) {
      const oldest = this.messageCallbackData.keys().next().value;
      if (oldest === undefined) break;
      this.messageCallbackData.delete(oldest);
    }
  }

  async setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    await this.client.api.messages.toggleDialogPin({ pinned, peer: chatId });
  }

  async setChatMuted(chatId: string, muted: boolean): Promise<void> {
    // A far-future muteUntil mutes the dialog forever; 0 restores notifications.
    await this.client.updateNotifySettings(chatId, {
      muteUntil: muted ? 2147483647 : 0,
    });
  }

  async setChatRead(chatId: string, read: boolean): Promise<void> {
    if (read) {
      await this.client.markAsRead(chatId);
    } else {
      await this.client.api.messages.markDialogUnread({
        unread: true,
        peer: chatId,
      });
    }
  }

  async setTyping(chatId: string, typing: boolean): Promise<void> {
    await this.client.setTyping(chatId, typing ? "typing" : "cancel");
  }

  async setChatArchived(chatId: string, archived: boolean): Promise<void> {
    // folders.editPeerFolders: folder 1 is the Archive, 0 the main list.
    // teleproto resolves the chat id to an InputPeer and wraps it in an
    // InputFolderPeer — the same entity resolution toggleDialogPin relies on.
    await this.client.editPeerFolders(chatId, archived ? ARCHIVE_FOLDER_ID : 0);
  }

  async saveDraft(chatId: string, text: string): Promise<void> {
    // An empty message clears the draft (see teleproto's SaveDraftParams).
    await this.client.saveDraft(chatId, { message: text });
  }

  async logout(): Promise<void> {
    for (const download of this.mediaDownloads.values()) download.abort();
    this.mediaDownloads.clear();
    for (const upload of this.mediaUploads.values()) upload.isCanceled = true;
    this.mediaUploads.clear();
    this.removeEventHandlers();
    this.stopConnectionListener();
    await this.client.disconnect();
  }

  private async handleConnectionState(
    update: UpdateConnectionState,
  ): Promise<void> {
    if (update.state !== UpdateConnectionState.connected) {
      this.connectionGeneration += 1;
      this.dialogsLive = false;
      this.emitConnectionState("offline");
      return;
    }

    if (this.connectionState === "connected") return;

    if (this.catchUpPromise) {
      await this.catchUpPromise;
      if (this.connectionState === "offline") {
        await this.handleConnectionState(update);
      }
      return;
    }

    const generation = this.connectionGeneration;
    this.emitConnectionState("synchronizing");
    const catchUp = this.client.catchUp();
    this.catchUpPromise = catchUp;
    try {
      await catchUp;
      if (generation === this.connectionGeneration) {
        await this.refreshMainDialogs(generation);
        if (generation === this.connectionGeneration && this.dialogsLive) {
          this.emitConnectionState("connected");
        }
      }
    } catch (error) {
      this.emitSyncError(error);
    } finally {
      if (this.catchUpPromise === catchUp) this.catchUpPromise = null;
    }
  }

  private emitConnectionState(
    state: "offline" | "synchronizing" | "connected",
  ): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.emit({ type: "connection-state", state });
  }

  private async refreshMainDialogs(generation: number): Promise<void> {
    if (this.dialogsLive) return;
    if (this.dialogRefresh) {
      await this.dialogRefresh;
      return;
    }
    const refresh = this.runDialogRefresh(generation);
    this.dialogRefresh = refresh;
    try {
      await refresh;
    } finally {
      if (this.dialogRefresh === refresh) this.dialogRefresh = null;
    }
  }

  private async runDialogRefresh(generation: number): Promise<void> {
    while (generation === this.connectionGeneration) {
      try {
        await this.fetchDialogPage({ limit: 50 });
        this.emit({
          type: "chats",
          chats: this.cachedDialogs.map((entry) => entry.chat),
          nextCursor: this.cachedNextCursor,
        });
        return;
      } catch (error) {
        const wait = floodWaitSeconds(error);
        if (wait == null) throw error;
        await sleep(wait * 1000);
      }
    }
  }

  private async handleMessageUpsert(
    cause: "new" | "edited",
    event: NewMessageEvent | EditedMessageEvent,
  ): Promise<void> {
    const chatId = event.message.chatId?.toString();
    if (!chatId) throw new Error("Telegram update has no chat id");
    this.indexMessage(chatId, event.message);
    const replyTo = (await this.replySnapshots(chatId, [event.message])).get(
      event.message.id.toString(),
    );
    const message = await this.toMessage(
      chatId,
      event.message,
      replyTo ?? null,
    );
    this.emit({ type: "message-upsert", cause, message });
  }

  private async handleMessageDelete(event: DeletedMessageEvent): Promise<void> {
    const ids = event.deletedIds.map(String);
    const explicitChatId = event.peer
      ? await this.client.getPeerId(event.peer)
      : null;
    const chatIds = new Set<string>();
    if (explicitChatId) chatIds.add(explicitChatId);
    for (const id of ids) {
      for (const chatId of this.messageChats.get(id) ?? []) chatIds.add(chatId);
    }
    for (const chatId of chatIds) {
      this.emit({ type: "message-delete", chatId, messageIds: ids });
    }
    for (const id of ids) this.messageChats.delete(id);
  }

  private handleUserUpdate(event: UserUpdateEvent): void {
    if (event.typing === undefined && event.cancel === undefined) return;
    const chatId = event.chatId?.toString();
    if (!chatId) return;
    this.emit({
      type: "typing",
      chatId,
      typing: Boolean(event.typing) && !event.cancel,
    });
  }

  // Direct-chat dialog ids are user ids, so a user status update maps onto
  // the chat key without a peer lookup; groups and channels never receive
  // these updates.
  private handleUserStatusUpdate(update: Api.UpdateUserStatus): void {
    this.emit({
      type: "chat-presence",
      chatId: update.userId.toString(),
      online: update.status instanceof Api.UserStatusOnline,
    });
  }

  private async handleDraftUpdate(
    update: Api.UpdateDraftMessage,
  ): Promise<void> {
    const chatId = await this.client.getPeerId(update.peer);
    this.emit({
      type: "draft",
      chatId,
      draftPreview:
        update.draft instanceof Api.DraftMessage ? update.draft.message : null,
    });
  }

  // Mute/pin changes made from another Telegram client (or the mobile app)
  // arrive here and patch the sidebar without a full reload. The folder id
  // carried by UpdateDialogPinned names the folder the pin applies to; pins
  // are modeled globally, so it is not needed to route the patch.
  private async handleNotifySettingsUpdate(
    update: Api.UpdateNotifySettings,
  ): Promise<void> {
    if (!(update.peer instanceof Api.NotifyPeer)) return; // Global default, not a single chat.
    const chatId = await this.client.getPeerId(update.peer.peer);
    const muteUntil = update.notifySettings.muteUntil;
    const muted =
      typeof muteUntil === "number" &&
      muteUntil > Math.floor(Date.now() / 1000);
    this.emit({ type: "chat-mute", chatId, muted });
  }

  private async handlePinnedMessagesUpdate(
    update: Api.UpdatePinnedMessages | Api.UpdatePinnedChannelMessages,
  ): Promise<void> {
    try {
      const chatId =
        update instanceof Api.UpdatePinnedChannelMessages
          ? (
              await this.client.getPeerId(
                new Api.PeerChannel({ channelId: update.channelId }),
              )
            ).toString()
          : (await this.client.getPeerId(update.peer)).toString();
      this.emit({ type: "pinned-messages", chatId });
    } catch (error) {
      if (isSkippableEntityError(error)) return;
      throw error;
    }
  }

  // Reaction changes arrive as their own update rather than a message edit,
  // so a chip repaint never redraws the bubble. The update carries the whole
  // bucket list for the message, which is exactly what the event publishes —
  // reactions have no delta form on the wire.
  private async handleMessageReactionsUpdate(
    update: Api.UpdateMessageReactions,
  ): Promise<void> {
    const chatId = await this.client.getPeerId(update.peer);
    this.emit({
      type: "message-reactions",
      chatId,
      messageId: String(update.msgId),
      reactions: mapMessageReactions(update.reactions),
    });
  }

  private async handleDialogPinnedUpdate(
    update: Api.UpdateDialogPinned,
  ): Promise<void> {
    if (!(update.peer instanceof Api.DialogPeer)) return; // Folder-only pin update.
    const chatId = await this.client.getPeerId(update.peer.peer);
    this.emit({ type: "chat-pin", chatId, pinned: Boolean(update.pinned) });
  }

  // Folder edits made from another Telegram client arrive as filter updates
  // (structure) or UpdateFolderPeers (a chat moved between folders). Both are
  // answered with a fresh folder snapshot; the chat list picks up the new
  // membership on its next page load.
  private async handleFolderUpdate(): Promise<void> {
    await this.refreshDialogFilters();
    const folders = await this.computeFolders();
    await this.persistSnapshot();
    this.emit({ type: "folders", folders });
  }

  private handleMessageRead(event: MessageReadEvent): void {
    const chatId = event.chatId?.toString();
    if (!chatId || event.contents) return;
    this.emit({
      type: "message-read",
      chatId,
      maxMessageId: String(event.maxId),
      direction: event.outbox ? "outbox" : "inbox",
    });
  }

  private indexMessage(chatId: string, message: TeleprotoMessage): void {
    const id = message.id.toString();
    const chats = this.messageChats.get(id) ?? new Set<string>();
    chats.add(chatId);
    this.messageChats.set(id, chats);
  }

  private removeEventHandlers(): void {
    this.client.removeEventHandler(this.onNewMessage, this.newMessageBuilder);
    this.client.removeEventHandler(
      this.onEditedMessage,
      this.editedMessageBuilder,
    );
    this.client.removeEventHandler(
      this.onDeletedMessage,
      this.deletedMessageBuilder,
    );
    this.client.removeEventHandler(this.onMessageRead, this.inboxReadBuilder);
    this.client.removeEventHandler(this.onMessageRead, this.outboxReadBuilder);
    this.client.removeEventHandler(this.onUserUpdate, this.userUpdateBuilder);
    this.client.removeEventHandler(this.onDraftUpdate, this.draftUpdateBuilder);
    this.client.removeEventHandler(
      this.onNotifySettingsUpdate,
      this.notifySettingsUpdateBuilder,
    );
    this.client.removeEventHandler(
      this.onDialogPinnedUpdate,
      this.dialogPinnedUpdateBuilder,
    );
    this.client.removeEventHandler(
      this.onPinnedMessagesUpdate,
      this.pinnedMessagesUpdateBuilder,
    );
    this.client.removeEventHandler(
      this.onMessageReactionsUpdate,
      this.messageReactionsUpdateBuilder,
    );
    this.client.removeEventHandler(
      this.onFolderUpdate,
      this.dialogFilterUpdateBuilder,
    );
    this.client.removeEventHandler(
      this.onFolderUpdate,
      this.folderPeersUpdateBuilder,
    );
    this.client.removeEventHandler(
      this.onUserStatusUpdate,
      this.userStatusUpdateBuilder,
    );
    this.client.removeEventHandler(
      this.onStickerCatalogUpdate,
      this.stickerCatalogUpdateBuilder,
    );
  }

  private emit(event: TelegramWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private emitSyncError(error: unknown): void {
    // Sync failures stay in the main-process log. They are never published
    // as workspace events: the conversation header has no error strip, and
    // Telegram's own chrome never raises a second surface for reconnect or
    // catch-up work the reader cannot act on.
    console.error("Telegram sync failed", error);
    if (isLanguageError(error) || isSkippableEntityError(error)) return;
    // A request that failed because the transport is down is a connection
    // state. Telegram reports exactly this through ConnectionsManager —
    // the chat list title reads "Connecting…" — and never as an error
    // surface. teleproto rejects with a bare Error carrying prose, so the
    // client's own connection flag is the signal rather than the message.
    if (!this.client.connected) {
      this.emitConnectionState("offline");
    }
  }

  private dialogMuted(dialog: TeleprotoDialog): boolean {
    const notifySettings = dialog.dialog.notifySettings;
    return (
      "muteUntil" in notifySettings &&
      typeof notifySettings.muteUntil === "number" &&
      notifySettings.muteUntil > Math.floor(Date.now() / 1000)
    );
  }

  private toChat(dialog: TeleprotoDialog): ChatDto {
    const title = dialog.title || dialog.name;
    if (!title) throw new Error("Telegram dialog has no title");
    const chatId = this.dialogId(dialog);
    const muted = this.dialogMuted(dialog);
    const saved =
      dialog.isUser &&
      Boolean((dialog.entity as { self?: boolean } | undefined)?.self);
    const user = dialog.entity instanceof Api.User ? dialog.entity : null;
    const draft = "draft" in dialog.dialog ? dialog.dialog.draft : undefined;
    const readInboxMaxId =
      "readInboxMaxId" in dialog.dialog ? dialog.dialog.readInboxMaxId : 0;
    const avatarPending = !this.avatarCache.has(chatId);
    const avatarDataUrl = this.cachedAvatar(chatId);
    if (avatarPending && dialog.entity) {
      // Channel and migrated-group ids are not sufficient to resolve a peer:
      // Telegram also needs the access hash carried by the dialog entity.
      // Nicegram likewise hands its image loader the complete peer object.
      this.scheduleAvatar(chatId, dialog.entity);
    }
    return {
      id: chatId,
      title,
      preview: dialog.message?.message || "",
      updatedAt: this.dialogDate(dialog).toISOString(),
      unreadCount: dialog.unreadCount,
      // readInboxMaxId 0 means Telegram has no read boundary for the dialog.
      lastReadMessageId: readInboxMaxId ? String(readInboxMaxId) : null,
      muted,
      pinned: dialog.pinned,
      kind: saved
        ? "saved"
        : dialog.isChannel
          ? "channel"
          : dialog.isGroup
            ? "group"
            : "direct",
      initials: initials(title),
      avatarDataUrl,
      avatarPending,
      draftPreview: draft instanceof Api.DraftMessage ? draft.message : null,
      // A fresh list snapshot has no live typing state; subsequent "typing"
      // events (see handleUserUpdate) patch it in the renderer's store.
      typing: false,
      presence: user?.status instanceof Api.UserStatusOnline ? "online" : null,
      folderId: dialogFolderId(
        this.folderFacts(dialog),
        this.dialogFilters ?? [],
      ),
    };
  }

  private cachedAvatar(entity: string): string | null {
    const avatar = this.avatarCache.get(entity) ?? null;
    if (this.avatarCache.has(entity)) {
      this.avatarCache.delete(entity);
      this.avatarCache.set(entity, avatar);
    }
    return avatar;
  }

  private scheduleAvatar(chatId: string, entity: AvatarEntity): void {
    if (this.queuedAvatarChatIds.has(chatId)) return;
    this.queuedAvatarChatIds.add(chatId);
    this.pendingAvatars.push({ chatId, entity });
    this.drainAvatarQueue();
  }

  private drainAvatarQueue(): void {
    while (
      this.activeAvatarDownloads < AVATAR_DOWNLOAD_CONCURRENCY &&
      this.pendingAvatars.length > 0
    ) {
      const task = this.pendingAvatars.shift();
      if (!task) return;
      this.activeAvatarDownloads += 1;
      void this.avatarDataUrl(task.chatId, task.entity)
        .then((avatarDataUrl) => {
          this.cacheAvatar(task.chatId, avatarDataUrl);
          this.patchCachedAvatar(task.chatId, avatarDataUrl);
          this.emit({
            type: "chat-avatar",
            chatId: task.chatId,
            avatarDataUrl,
          });
          void this.persistSnapshot();
        })
        .finally(() => {
          this.queuedAvatarChatIds.delete(task.chatId);
          this.activeAvatarDownloads -= 1;
          this.drainAvatarQueue();
        });
    }
  }

  private cacheAvatar(entity: string, avatarDataUrl: string | null): void {
    this.avatarCache.delete(entity);
    this.avatarCache.set(entity, avatarDataUrl);
    while (this.avatarCache.size > AVATAR_CACHE_LIMIT) {
      const oldest = this.avatarCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.avatarCache.delete(oldest);
    }
  }

  private async hydrateAvatarsFromDisk(): Promise<void> {
    if (this.avatarsHydrated) return;
    this.avatarsHydrated = true;
    if (!this.mediaCacheDirectory) return;
    try {
      const entries = await readdir(this.mediaCacheDirectory);
      for (const entry of entries) {
        const chatId = chatIdFromAvatarFileName(entry);
        if (!chatId) continue;
        const url = avatarMediaUrl(entry);
        this.cacheAvatar(chatId, url);
        this.patchCachedAvatar(chatId, url);
      }
    } catch (error) {
      if (!isMissingPath(error)) {
        console.error("Telegram avatar cache failed", error);
      }
    }
  }

  private patchCachedAvatar(
    chatId: string,
    avatarDataUrl: string | null,
  ): void {
    const index = this.cachedDialogs.findIndex(
      (entry) => entry.chat.id === chatId,
    );
    if (index < 0) return;
    const entry = this.cachedDialogs[index]!;
    this.cachedDialogs[index] = {
      ...entry,
      chat: { ...entry.chat, avatarDataUrl, avatarPending: false },
    };
  }

  private async avatarDataUrl(
    chatId: string,
    entity: AvatarEntity,
  ): Promise<string | null> {
    const fileName = avatarCacheFileName(chatId);
    if (this.mediaCacheDirectory) {
      const filePath = path.join(this.mediaCacheDirectory, fileName);
      try {
        await stat(filePath);
        await touchMediaCacheFile(filePath);
        return avatarMediaUrl(fileName);
      } catch (error) {
        if (!isMissingPath(error)) {
          console.error("Telegram avatar cache failed", error);
        }
      }
    }
    try {
      const photo = await this.client.downloadProfilePhoto(entity, {
        isBig: false,
      });
      if (photo && typeof photo !== "string" && photo.byteLength > 0) {
        const bytes = Buffer.from(photo);
        if (this.mediaCacheDirectory) {
          await mkdir(this.mediaCacheDirectory, { recursive: true });
          await writeFile(path.join(this.mediaCacheDirectory, fileName), bytes);
          await enforceMediaCacheLimit(
            this.mediaCacheDirectory,
            await this.mediaCacheLimitBytes(),
          );
          return avatarMediaUrl(fileName);
        }
        return `data:image/jpeg;base64,${bytes.toString("base64")}`;
      }
    } catch {
      // A missing or inaccessible profile photo should not block the workspace.
    }
    return null;
  }

  private dialogId(dialog: TeleprotoDialog): string {
    if (!dialog.id) throw new Error("Telegram dialog has no id");
    return dialog.id.toString();
  }

  private dialogDate(dialog: TeleprotoDialog): Date {
    if (typeof dialog.date !== "number") {
      throw new Error(
        `Telegram dialog ${this.dialogId(dialog)} has no timestamp`,
      );
    }
    return new Date(dialog.date * 1000);
  }

  private async replySnapshots(
    chatId: string,
    messages: ReadonlyArray<TeleprotoMessage>,
  ): Promise<Map<string, MessageReplyToDto>> {
    const ids = [
      ...new Set(
        messages
          .map((message) => message.replyToMsgId)
          .filter((id): id is number => typeof id === "number"),
      ),
    ];
    const snapshots = new Map<string, MessageReplyToDto>();
    if (ids.length === 0) return snapshots;
    const replied = await this.client.getMessages(chatId, { ids });
    const byId = new Map(replied.map((entry) => [entry.id, entry]));
    for (const message of messages) {
      if (typeof message.replyToMsgId !== "number") continue;
      const source = byId.get(message.replyToMsgId);
      if (!source) continue;
      snapshots.set(message.id.toString(), {
        id: source.id.toString(),
        senderName: (await resolveSender(source)).name,
        body: telegramMessageBody(source),
        entities: mapMessageEntities(
          telegramMessageBody(source),
          source.entities,
        ),
      });
    }
    return snapshots;
  }

  private async toMessage(
    chatId: string,
    message: TeleprotoMessage,
    replyTo: MessageReplyToDto | null = null,
  ): Promise<MessageDto> {
    const sender = await resolveSender(message);
    // Pending must mean "a download is on its way", or the row keeps a
    // skeleton nothing will ever clear. Outgoing rows paint the account's own
    // photo, so fetching the self photo once per sent message would be pure
    // waste, and a peer that did not resolve has nothing to fetch at all —
    // both settle immediately as "no photo".
    const photoEntity =
      this.avatarCache.has(sender.id) || message.out || !sender.id
        ? undefined
        : sender.entity;
    if (photoEntity) this.scheduleAvatar(sender.id, photoEntity);
    const senderAvatarPending = Boolean(photoEntity);
    const senderAvatarUrl = this.cachedAvatar(sender.id);
    // Mapping the keyboard is also what makes it pressable: the callback
    // payloads are indexed here, under the ids the returned buttons carry.
    const keyboard = mapReplyMarkup(message.replyMarkup);
    if (keyboard) {
      this.cacheCallbackData(`${chatId}:${message.id}`, keyboard.callbackData);
    }
    const reactions = mapMessageReactions(message.reactions);
    return {
      id: message.id.toString(),
      chatId,
      senderId: sender.id,
      senderName: sender.name,
      senderAvatarUrl,
      senderAvatarPending,
      body: telegramMessageBody(message),
      entities: mapMessageEntities(
        telegramMessageBody(message),
        message.entities,
      ),
      media: mapMessageMedia(message, `${chatId}/${message.id}`),
      groupedId: messageGroupedId(message),
      sentAt: new Date(message.date * 1000).toISOString(),
      outgoing: Boolean(message.out),
      status: message.out ? "sent" : "read",
      replyTo,
      editedAt:
        typeof message.editDate === "number"
          ? new Date(message.editDate * 1000).toISOString()
          : null,
      forwardedFrom: await this.resolveForward(message),
      keyboard: keyboard?.keyboard ?? null,
      // Absent rather than empty on a message nobody reacted to: the field
      // is optional so the common case adds nothing to the IPC payload.
      ...(reactions.length > 0 ? { reactions } : {}),
    };
  }

  // The attribution of a forwarded message: who wrote it and where following
  // the header leads. `fromName` covers authors who hide their account on
  // forwards; an ordinary forward only carries peers, resolved through the
  // client's entity cache. A peer that fails to resolve must not fail the
  // message mapping — the copy stays unattributed, like a hidden-sender
  // forward, and a target that fails to resolve simply cannot be followed.
  private async resolveForward(
    message: TeleprotoMessage,
  ): Promise<MessageForwardDto | null> {
    const header = message.fwdFrom;
    if (!header) return null;
    const target = forwardTarget(header);
    // The header names its author independently of where the jump lands: a
    // copy saved out of a chat keeps the original sender's name while
    // pointing back at the chat it was saved from, so the name falls back to
    // `fromId` and only then to the target peer (a bare `savedFromPeer`).
    const senderName =
      header.fromName ||
      (await this.forwardPeerTitle(header.fromId ?? target?.peer));
    if (!senderName) return null;
    let senderId: string | null = null;
    if (target) {
      try {
        senderId = await this.client.getPeerId(target.peer);
      } catch {
        // A target peer the client cannot resolve has nothing to open; the
        // attribution still names its author.
      }
    }
    return {
      senderName,
      senderId,
      // A message id is only addressable inside a peer that resolved.
      messageId: senderId ? (target?.messageId ?? null) : null,
      postAuthor: header.postAuthor ?? null,
    };
  }

  private async forwardPeerTitle(
    peer: Api.TypePeer | undefined,
  ): Promise<string | null> {
    if (!peer) return null;
    try {
      // Teleproto's entity union splits the name across constructors;
      // NamedPeer is the one shape every one of them answers.
      const entity = (await this.client.getEntity(peer)) as
        NamedPeer | undefined;
      return namedPeerTitle(entity);
    } catch {
      return null;
    }
  }

  private publishMediaReady(
    mediaId: string,
    fileName: string,
    size: number,
  ): void {
    this.emit({
      type: "media-download",
      mediaId,
      state: "ready",
      downloadedBytes: size,
      totalBytes: size,
      url: `telo-media://cache/${encodeURIComponent(fileName)}`,
      error: null,
    });
  }
}

type TeleprotoMessage = Awaited<ReturnType<TelegramClient["sendMessage"]>>;
type TeleprotoDialog = Awaited<
  ReturnType<TelegramClient["getDialogs"]>
>[number];

function isMigratedDialog(dialog: TeleprotoDialog): boolean {
  const entity = dialog.entity as { readonly migratedTo?: unknown } | undefined;
  return entity?.migratedTo != null;
}

// The name a peer paints itself with, in Telegram's own order of preference:
// the first and last name of a user, the title of a channel or group, and a
// bare username when the peer publishes nothing else. Null when the peer
// carries no name at all — a deleted account, or a peer resolved as `min`.
function namedPeerTitle(peer: NamedPeer | undefined): string | null {
  return (
    [peer?.firstName, peer?.lastName].filter(Boolean).join(" ") ||
    peer?.title ||
    peer?.username ||
    null
  );
}

// The author of a message: peer id, display name, and the peer entity, all
// from a single `getSender()` round trip. `toMessage` needs the entity as well
// as the name — the avatar download takes a peer, not a bare id, because
// channels and migrated groups are only addressable with their access hash.
async function resolveSender(
  message: TeleprotoMessage,
): Promise<ResolvedSender> {
  const sender = await message.getSender();
  const senderDisplayName = namedPeerTitle(sender as NamedPeer | undefined);
  // A channel post has no sender: the channel authors it, so its own peer
  // carries both the signature fallback and the photo to paint.
  const chat = senderDisplayName ? undefined : await message.getChat();
  const chatNamed = chat as NamedPeer | undefined;
  const name =
    senderDisplayName ||
    message.postAuthor ||
    chatNamed?.title ||
    chatNamed?.firstName ||
    chatNamed?.username;
  if (!name) throw new Error(`Telegram message ${message.id} has no sender`);
  const peer = sender ?? chat;
  return { id: peer?.id?.toString() ?? "", name, entity: peer };
}

// Where a forward attribution points, resolved in the order both reference
// clients use (Desktop's history_item_components.cpp, Web K's
// appMessagesManager):
//   1. `savedFromPeer` + `savedFromMsgId` — the explicit pointer Telegram
//      sets on copies in Saved Messages and on the discussion group's copy of
//      a channel post.
//   2. a `channelPost` authored by a channel `fromId`. Such a header carries
//      no `saved_from_*` at all, which is why forwarding a channel post into
//      a private chat still knows the post it came from.
//   3. a bare `fromId` — only the author is known, so following the
//      attribution opens the peer itself.
//   4. nothing: a `fromName`-only header means the original sender forbade
//      linking back, and there is nowhere to go.
function forwardTarget(header: Api.MessageFwdHeader): ForwardTarget | null {
  if (header.savedFromPeer && typeof header.savedFromMsgId === "number") {
    return {
      peer: header.savedFromPeer,
      messageId: header.savedFromMsgId.toString(),
    };
  }
  if (
    typeof header.channelPost === "number" &&
    header.fromId instanceof Api.PeerChannel
  ) {
    return { peer: header.fromId, messageId: header.channelPost.toString() };
  }
  if (header.fromId) return { peer: header.fromId, messageId: null };
  return null;
}

// documentEmpty is a sticker Telegram no longer serves: it carries no mime
// type, so there is nothing to draw or send, and it drops out before anything
// downstream has to narrow the union again.
function stickerDocumentsOf(
  documents: ReadonlyArray<Api.TypeDocument>,
): ReadonlyArray<Api.Document> {
  return documents.filter(
    (document): document is Api.Document => "mimeType" in document,
  );
}

function stickerSetReferenceOf(set: Api.StickerSet): StickerSetReferenceDto {
  return set.accessHash != null
    ? {
        kind: "id",
        id: set.id.toString(),
        accessHash: set.accessHash.toString(),
      }
    : { kind: "short-name", shortName: set.shortName };
}

function inputStickerSet(
  reference: StickerSetReferenceDto,
): Api.TypeInputStickerSet {
  return reference.kind === "id"
    ? new Api.InputStickerSetID({
        id: helpers.returnBigInt(BigInt(reference.id)),
        accessHash: helpers.returnBigInt(BigInt(reference.accessHash)),
      })
    : new Api.InputStickerSetShortName({ shortName: reference.shortName });
}

// Telegram keeps the emoji a sticker stands for on DocumentAttributeSticker,
// and DocumentAttributeCustomEmoji publishes the same field for the documents
// an emoji pack is made of. A set sticker missing it still belongs in the
// picker, drawn without its emoji label.
function stickerEmoji(document: Api.Document): string | null {
  for (const attribute of document.attributes) {
    if ("alt" in attribute) return attribute.alt.trim() || null;
  }
  return null;
}

// The pixel size the picker reserves before the bytes arrive. Static stickers
// declare it on the image attribute, WebM ones on the video attribute, and a
// `.tgs` declares nothing — Lottie carries its own canvas size.
function stickerDimensions(document: Api.Document): {
  readonly width: number | null;
  readonly height: number | null;
} {
  for (const attribute of document.attributes) {
    if ("w" in attribute) return { width: attribute.w, height: attribute.h };
  }
  return { width: null, height: null };
}

function parseMediaId(mediaId: string): { chatId: string; messageId: string } {
  const separator = mediaId.lastIndexOf("/");
  const chatId = mediaId.slice(0, separator);
  const messageId = mediaId.slice(separator + 1);
  if (separator < 1 || !chatId || !messageId)
    throw new Error("Media id is invalid");
  return { chatId, messageId };
}

function cacheFileName(mediaId: string, originalName: unknown): string {
  const stem = mediaId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const extension =
    typeof originalName === "string"
      ? path
          .extname(originalName)
          .toLowerCase()
          .replace(/[^.a-z0-9]/g, "")
      : "";
  return `${stem}${extension.slice(0, 12)}`;
}

function numericSize(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : Number((value as { toString?: () => string } | null)?.toString?.());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function telegramMessageId(value: string): number {
  if (!/^\d+$/.test(value))
    throw new Error(`Invalid Telegram message id ${value}`);
  return Number(value);
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Telegram authentication failed";
}

function isLanguageError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof RangeError ||
    (error instanceof Error && isInternalExceptionMessage(error.message))
  );
}

function isInternalExceptionMessage(message: string): boolean {
  return /is not callable|is not a function|instanceof|Cannot read propert/i.test(
    message,
  );
}

function factsFromChat(chat: ChatDto): FolderDialogFacts {
  return {
    peerId: chat.id,
    isUser: chat.kind === "direct" || chat.kind === "saved",
    isGroup: chat.kind === "group",
    isBroadcast: chat.kind === "channel",
    isBot: false,
    isContact: false,
    muted: chat.muted,
    unreadCount: chat.unreadCount,
    archived: chat.folderId === ARCHIVE_FOLDER_ID,
  };
}

function telegramMessageBody(message: { readonly message?: unknown }): string {
  return typeof message.message === "string" ? message.message : "";
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function floodWaitSeconds(error: unknown): number | null {
  if (!(error instanceof FloodWaitError)) return null;
  return error.seconds > 0 ? error.seconds : null;
}

/**
 * Longest flood wait a paged read sits through before failing. Telegram's
 * usual waits on GetDialogs / GetHistory are a handful of seconds, which a
 * loading skeleton covers; a long ban is a real failure the caller should
 * hear about instead of a request that silently takes a minute.
 */
const FLOOD_WAIT_RETRY_CAP_SECONDS = 30;

async function retryOnShortFloodWait<T>(request: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      return await request();
    } catch (error) {
      const wait = floodWaitSeconds(error);
      if (wait == null || wait > FLOOD_WAIT_RETRY_CAP_SECONDS) throw error;
      await sleep(wait * 1000);
    }
  }
}

function isSkippableEntityError(error: unknown): boolean {
  return error instanceof ChannelInvalidError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
