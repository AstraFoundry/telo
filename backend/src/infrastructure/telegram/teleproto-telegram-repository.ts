import path from "node:path";
import { mkdir, stat } from "node:fs/promises";

import { Api, TelegramClient } from "teleproto";
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
import {
  ChannelInvalidError,
  FloodWaitError,
} from "teleproto/errors/index.js";

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
  MessageReplyToDto,
  MessageSearchPageDto,
  MessageSearchPageInput,
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
import { enforceMediaCacheLimit, touchMediaCacheFile } from "./media-cache";
import {
  mapMessageEntities,
  mapMessageEntitiesForSend,
} from "./teleproto-message-entities";
import {
  isServiceMessage,
  mapMessageMedia,
  messageGroupedId,
} from "./teleproto-message-media";
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

const AVATAR_DOWNLOAD_CONCURRENCY = 3;
const AVATAR_CACHE_LIMIT = 200;
// Global search scans the most recent dialogs for title matches; message
// bodies still match server-side across the full history.
const GLOBAL_SEARCH_DIALOG_SCAN = 200;
const GLOBAL_SEARCH_MESSAGE_LIMIT = 50;
// Shared media is the photo/video/file slice of a chat's history; link
// previews and non-visual documents (audio, stickers, …) stay out.
const SHARED_MEDIA_KINDS = new Set(["photo", "video", "file"]);

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

  listChatPage(input: ChatPageInput = {}): Promise<ChatPageDto> {
    if (
      !(this.repository instanceof TeleprotoRepository) &&
      this.snapshot &&
      this.state.status === "restoring"
    ) {
      return Promise.resolve(dialogSnapshotPage(this.snapshot, input));
    }
    return this.repository.listChatPage(input);
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
  ): Promise<MessageDto> {
    return this.repository.sendMessage(
      chatId,
      body,
      replyToId,
      clientId,
      silent,
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

  setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    return this.repository.setChatPinned(chatId, pinned);
  }

  setChatMuted(chatId: string, muted: boolean): Promise<void> {
    return this.repository.setChatMuted(chatId, muted);
  }

  setChatRead(chatId: string, read: boolean): Promise<void> {
    return this.repository.setChatRead(chatId, read);
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
    readonly entity: string;
  }> = [];
  private readonly queuedAvatarEntities = new Set<string>();
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
  private readonly onFolderUpdate = () => {
    this.updateQueue.enqueue(() => this.handleFolderUpdate());
  };
  private readonly stopConnectionListener: () => void;
  private cachedDialogs: Array<{
    chat: ChatDto;
    facts: FolderDialogFacts;
  }> = [];
  private cachedNextCursor: ChatPageCursorDto | null = null;
  constructor(
    private readonly client: TelegramClient,
    private readonly mediaCacheDirectory: string,
    private readonly snapshots: TelegramDialogSnapshotRepository | null = null,
    initialSnapshot: TelegramDialogSnapshot | null = null,
  ) {
    if (initialSnapshot) {
      this.cachedDialogs = initialSnapshot.chats.map((chat) => ({
        chat,
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
    client.addEventHandler(this.onFolderUpdate, this.dialogFilterUpdateBuilder);
    client.addEventHandler(this.onFolderUpdate, this.folderPeersUpdateBuilder);
    client.addEventHandler(
      this.onUserStatusUpdate,
      this.userStatusUpdateBuilder,
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
    const avatarDataUrl = await this.avatarDataUrl("me");

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
    const limit = input.limit ?? 50;
    // The snapshot is the chat list. A live GetDialogs is a refresh, not a
    // blocking read — otherwise flood-wait sleeps occupy the exclusive queue
    // and the renderer never paints.
    if (!input.cursor && this.cachedDialogs.length > 0) {
      return {
        items: this.cachedDialogs.slice(0, limit).map((entry) => entry.chat),
        nextCursor: this.cachedNextCursor,
      };
    }
    return this.fetchDialogPage(input);
  }

  private async fetchDialogPage(input: ChatPageInput): Promise<ChatPageDto> {
    const limit = input.limit ?? 50;
    const dialogs = await this.dialogFetchQueue.run(() =>
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
        ignoreMigrated: true,
      }),
    );
    const page = dialogs.slice(0, limit);
    const last = page.at(-1);
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
    const messages = await this.client.getMessages(chatId, {
      limit: limit + 1,
      offsetId: input.beforeMessageId
        ? telegramMessageId(input.beforeMessageId)
        : undefined,
    });
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
          ignoreMigrated: true,
        }),
      ),
      this.client.getMessages(undefined, {
        search: query,
        limit: GLOBAL_SEARCH_MESSAGE_LIMIT,
      }),
    ]);
    const term = query.toLocaleLowerCase();
    const chats = dialogs
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
    return participants.map((member) => ({
      id: member.id.toString(),
      displayName:
        [member.firstName, member.lastName].filter(Boolean).join(" ") ||
        (member.username ? `@${member.username}` : member.id.toString()),
      username: member.username ?? null,
    }));
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
    if (!this.mediaCacheDirectory)
      throw new Error("Media cache is unavailable");
    await mkdir(this.mediaCacheDirectory, { recursive: true });
    const fileName = cacheFileName(mediaId, message.file?.name);
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
      totalBytes: numericSize(message.file?.size),
      url: null,
      error: null,
    });
    try {
      await this.client.downloadMedia(message, {
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
      await enforceMediaCacheLimit(this.mediaCacheDirectory);
      return outputFile;
    } catch (error) {
      this.emit({
        type: "media-download",
        mediaId,
        state: controller.signal.aborted ? "cancelled" : "failed",
        downloadedBytes: 0,
        totalBytes: numericSize(message.file?.size),
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
  }

  private emit(event: TelegramWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private emitSyncError(error: unknown): void {
    // Language-level failures belong in the main-process log. Crossing IPC
    // with `error.message` would paint TypeError text into the conversation
    // banner, which is not a user-actionable sync state.
    console.error("Telegram sync failed", error);
    if (isLanguageError(error) || isSkippableEntityError(error)) return;
    this.emit({ type: "sync-error", message: safeError(error) });
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
    const avatarDataUrl = this.cachedAvatar(chatId);
    if (!this.avatarCache.has(chatId)) this.scheduleAvatar(chatId, chatId);
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

  private scheduleAvatar(chatId: string, entity: string): void {
    if (this.queuedAvatarEntities.has(entity)) return;
    this.queuedAvatarEntities.add(entity);
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
      void this.avatarDataUrl(task.entity)
        .then((avatarDataUrl) => {
          this.cacheAvatar(task.entity, avatarDataUrl);
          if (avatarDataUrl) {
            this.emit({
              type: "chat-avatar",
              chatId: task.chatId,
              avatarDataUrl,
            });
          }
        })
        .finally(() => {
          this.queuedAvatarEntities.delete(task.entity);
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

  private async avatarDataUrl(entity: string): Promise<string | null> {
    try {
      const photo = await this.client.downloadProfilePhoto(entity, {
        isBig: false,
      });
      if (photo && typeof photo !== "string" && photo.byteLength > 0) {
        return `data:image/jpeg;base64,${Buffer.from(photo).toString("base64")}`;
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
        senderName: await senderName(source),
        body: telegramMessageBody(source),
        entities: mapMessageEntities(telegramMessageBody(source), source.entities),
      });
    }
    return snapshots;
  }

  private async toMessage(
    chatId: string,
    message: TeleprotoMessage,
    replyTo: MessageReplyToDto | null = null,
  ): Promise<MessageDto> {
    return {
      id: message.id.toString(),
      chatId,
      senderName: await senderName(message),
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
      forwardedFrom: await this.forwardedFromName(message),
    };
  }

  // The original author of a forwarded message. `fromName` covers authors
  // who hide their account on forwards; an ordinary forward only carries the
  // peer, resolved through the client's entity cache. A peer that fails to
  // resolve must not fail the message mapping — the copy stays unattributed,
  // like a hidden-sender forward.
  private async forwardedFromName(
    message: TeleprotoMessage,
  ): Promise<string | null> {
    const header = message.fwdFrom;
    if (!header) return null;
    if (header.fromName) return header.fromName;
    if (!header.fromId) return null;
    try {
      const entity = (await this.client.getEntity(header.fromId)) as
        | {
            firstName?: string;
            lastName?: string;
            title?: string;
            username?: string;
          }
        | undefined;
      return (
        [entity?.firstName, entity?.lastName].filter(Boolean).join(" ") ||
        entity?.title ||
        entity?.username ||
        null
      );
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

async function senderName(message: TeleprotoMessage): Promise<string> {
  const sender = (await message.getSender()) as
    | {
        firstName?: string;
        lastName?: string;
        title?: string;
        username?: string;
      }
    | undefined;
  const senderDisplayName = sender
    ? [sender.firstName, sender.lastName].filter(Boolean).join(" ") ||
      sender.title ||
      sender.username
    : undefined;
  const chat = senderDisplayName
    ? undefined
    : ((await message.getChat()) as
        { title?: string; firstName?: string; username?: string } | undefined);
  const name =
    senderDisplayName ||
    message.postAuthor ||
    chat?.title ||
    chat?.firstName ||
    chat?.username;
  if (!name) throw new Error(`Telegram message ${message.id} has no sender`);
  return name;
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

function floodWaitSeconds(error: unknown): number | null {
  if (!(error instanceof FloodWaitError)) return null;
  return error.seconds > 0 ? error.seconds : null;
}

function isSkippableEntityError(error: unknown): boolean {
  return error instanceof ChannelInvalidError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
