import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

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
  TelegramAccountDto,
  TelegramAuthState,
  TelegramLoginConfigurationDto,
  TelegramLoginInput,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";
import type {
  TelegramAccountRecord,
  TelegramAccountRegistry,
  TelegramAccountRegistrySnapshot,
} from "../../domain/telegram/telegram-account-registry";
import type {
  TelegramRepository,
  TelegramUploadFile,
} from "../../domain/telegram/telegram-ports";

/**
 * tdesktop caps a free client at three signed-in accounts
 * (`Main::Domain::kMaxAccounts`); the switcher follows the same ceiling.
 */
export const TELEGRAM_MAX_ACCOUNTS = 3;

/** Per-account on-disk locations; the container binds them under userData. */
export interface TelegramAccountPaths {
  readonly session: string;
  readonly profile: string;
  readonly snapshot: string;
  readonly mediaCacheDirectory: string;
  readonly tdlibDirectory: string;
  readonly tdlibKey: string;
}

/**
 * The slice of one account's client coordinator the switcher drives.
 * `TdlibClientCoordinator` satisfies it structurally; tests inject a
 * stubbed factory instead of a live TDLib connection.
 */
export type TelegramAccountClient = TelegramRepository & {
  getAuthState(): TelegramAuthState;
  getLoginConfiguration(): Promise<TelegramLoginConfigurationDto>;
  initialize(): Promise<void>;
  beginLogin(input: TelegramLoginInput): Promise<void>;
  submitChallenge(value: string): Promise<void>;
  /** Parks the connection without ending the stored session. */
  disconnect(): Promise<void>;
};

export interface TelegramAccountCoordinatorOptions {
  readonly registry: TelegramAccountRegistry;
  readonly paths: (accountId: string) => TelegramAccountPaths;
  /**
   * Pre-TDLib GramJS files. They cannot be imported; the coordinator only
   * deletes them so a leftover session does not look restorable.
   */
  readonly legacyPaths: Omit<
    TelegramAccountPaths,
    "mediaCacheDirectory" | "tdlibDirectory" | "tdlibKey"
  > | null;
  readonly createCoordinator: (
    accountId: string,
    onState: (state: TelegramAuthState) => void,
  ) => TelegramAccountClient;
  readonly onState: (state: TelegramAuthState) => void;
  /** TELO_DEMO_WORKSPACE=1: seed the two deterministic demo accounts. */
  readonly demoWorkspace?: boolean;
  readonly createAccountId?: () => string;
}

// The pre-login delegate: with zero accounts there is nothing to attach to,
// but workspace calls still need a (demo-backed) repository behind them.
// Its per-account files are never written — it never logs in and has no
// session — so the reserved id costs no disk state.
const SCRATCH_ACCOUNT_ID = "scratch";

/**
 * Multi-account façade over the per-account `TelegramAccountClient`s,
 * tdesktop-style: every signed-in account keeps its own TDLib database, profile,
 * and media cache; exactly one — the active one — is connected, and every
 * workspace method and event addresses it alone.
 */
export class TelegramAccountCoordinator implements TelegramRepository {
  private readonly listeners = new Set<
    (event: TelegramWorkspaceEvent) => void
  >();
  private readonly coordinators = new Map<string, TelegramAccountClient>();
  private readonly demoAccountIds = new Set<string>();
  private snapshot: TelegramAccountRegistrySnapshot | null = null;
  private foregroundId: string | null = null;
  private pendingNewAccountId: string | null = null;
  private readyQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: TelegramAccountCoordinatorOptions) {}

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getAuthState(): TelegramAuthState {
    const foreground = this.foregroundId
      ? this.coordinators.get(this.foregroundId)
      : undefined;
    return foreground?.getAuthState() ?? { status: "idle" };
  }

  getLoginConfiguration(): Promise<TelegramLoginConfigurationDto> {
    return this.delegate().getLoginConfiguration();
  }

  /**
   * First boot: run the legacy migration (or demo seeding), then restore
   * the active account's session. With no accounts at all the workspace
   * stays on the scratch delegate until the first login registers one.
   */
  async initialize(): Promise<void> {
    const snapshot = await this.loadSnapshot();
    const activeId =
      snapshot.activeAccountId ?? snapshot.accounts[0]?.id ?? null;
    if (!activeId) {
      this.foregroundId = SCRATCH_ACCOUNT_ID;
      return;
    }
    this.foregroundId = activeId;
    await this.coordinatorFor(activeId).initialize();
  }

  async beginLogin(input: TelegramLoginInput): Promise<void> {
    const snapshot = await this.loadSnapshot();
    const foreground = this.foregroundId
      ? this.coordinators.get(this.foregroundId)
      : undefined;
    const foregroundIsAccount =
      this.foregroundId !== null &&
      (this.pendingNewAccountId === this.foregroundId ||
        snapshot.accounts.some((account) => account.id === this.foregroundId));
    if (
      foreground &&
      foregroundIsAccount &&
      foreground.getAuthState().status !== "ready"
    ) {
      // The foreground account is mid-login (or its session died and it is
      // signing back in): continue its own flow rather than adding one.
      await foreground.beginLogin(input);
      return;
    }
    if (snapshot.accounts.length >= TELEGRAM_MAX_ACCOUNTS) {
      throw new Error(
        `Telo supports at most ${TELEGRAM_MAX_ACCOUNTS} Telegram accounts on one device`,
      );
    }
    // tdesktop semantics: signing in while an account is ready adds another
    // account instead of replacing it. The login runs on a fresh coordinator
    // with its own session/profile and becomes foreground immediately; the
    // previous account keeps its connection until the new one is ready.
    const accountId = this.newAccountId();
    const coordinator = this.coordinatorFor(accountId);
    this.pendingNewAccountId = accountId;
    this.foregroundId = accountId;
    await coordinator.beginLogin(input);
  }

  submitChallenge(value: string): Promise<void> {
    return this.delegate().submitChallenge(value);
  }

  async listAccounts(): Promise<ReadonlyArray<TelegramAccountDto>> {
    const snapshot = await this.loadSnapshot();
    return snapshot.accounts.map((account) => ({
      id: account.id,
      displayName: account.displayName,
      username: account.username,
      avatarDataUrl: account.avatarDataUrl,
      avatarPlaceholder: account.avatarPlaceholder,
      active: account.id === snapshot.activeAccountId,
      unreadCount: account.unreadCount,
    }));
  }

  async setActiveAccount(accountId: string): Promise<void> {
    let snapshot = await this.loadSnapshot();
    const target = snapshot.accounts.find(
      (account) => account.id === accountId,
    );
    if (!target) throw new Error(`Unknown Telegram account "${accountId}"`);
    if (
      snapshot.activeAccountId === accountId &&
      this.foregroundId === accountId
    ) {
      return;
    }
    // Switching away abandons any in-flight add-account login.
    await this.discardPendingLogin();
    const previousId = snapshot.activeAccountId;
    // Active-first is the switcher's display order, so the registry write
    // doubles as the reorder.
    snapshot = {
      accounts: [
        target,
        ...snapshot.accounts.filter((account) => account.id !== accountId),
      ],
      activeAccountId: accountId,
    };
    await this.persist(snapshot);
    // Move foreground before parking so the disconnected account's `idle`
    // never reaches the renderer: the switch emits only the target's
    // restore sequence (restoring → ready, or idle when its session died).
    this.foregroundId = accountId;
    if (previousId && previousId !== accountId) {
      await this.parkAccount(previousId);
    }
    await this.coordinatorFor(accountId).initialize();
  }

  async logout(): Promise<void> {
    await this.discardPendingLogin();
    const snapshot = await this.loadSnapshot();
    const activeId = snapshot.activeAccountId;
    if (!activeId) {
      // Nobody signed in: reset the scratch delegate, mirroring the old
      // single-account no-op logout on the pre-login workspace.
      await this.coordinators.get(SCRATCH_ACCOUNT_ID)?.logout();
      return;
    }
    if (this.demoAccountIds.has(activeId)) {
      // The seeded demo accounts have no session to end: logout stays the
      // documented demo no-op (a state reset only), and the registry keeps
      // both accounts so the next demo launch looks the same.
      await this.coordinators.get(activeId)?.logout();
      return;
    }
    // Swallow the outgoing account's own `idle`: the renderer hears either
    // the next account's restore or one final idle below, never both.
    this.foregroundId = null;
    await this.coordinators.get(activeId)?.logout();
    // The coordinator's logout cleared the session and snapshot through
    // their repositories, but the profile has no clear() port and a
    // never-connected account has no coordinator — delete all three files
    // directly. The media cache directory goes too: its bytes are
    // re-downloadable, and a removed account should not leave media behind.
    const paths = this.options.paths(activeId);
    await rm(paths.session, { force: true });
    await rm(paths.profile, { force: true });
    await rm(paths.snapshot, { force: true });
    await rm(paths.mediaCacheDirectory, { recursive: true, force: true });
    await rm(paths.tdlibDirectory, { recursive: true, force: true });
    await rm(paths.tdlibKey, { force: true });
    this.coordinators.delete(activeId);
    const remaining = snapshot.accounts.filter(
      (account) => account.id !== activeId,
    );
    const next = remaining[0];
    if (!next) {
      await this.persist({ accounts: [], activeAccountId: null });
      this.foregroundId = SCRATCH_ACCOUNT_ID;
      this.options.onState({ status: "idle" });
      return;
    }
    await this.persist({
      accounts: [
        { ...next, lastActiveAt: new Date().toISOString() },
        ...remaining.slice(1),
      ],
      activeAccountId: next.id,
    });
    this.foregroundId = next.id;
    await this.coordinatorFor(next.id).initialize();
  }

  /**
   * Cache root the media protocol serves from: the foreground account's
   * directory. Resolved per request because the active account — and with
   * it the root — changes when the switcher swaps accounts.
   */
  activeMediaCacheDirectory(): string {
    return this.options.paths(this.foregroundId ?? SCRATCH_ACCOUNT_ID)
      .mediaCacheDirectory;
  }

  getCurrentUser(): Promise<CurrentUserDto> {
    return this.delegate().getCurrentUser();
  }

  listChatPage(input: ChatPageInput = {}): Promise<ChatPageDto> {
    return this.delegate().listChatPage(input);
  }

  createSecretChat(userId: string): Promise<ChatDto> {
    return this.delegate().createSecretChat(userId);
  }

  openSavedMessages(): Promise<ChatDto> {
    return this.delegate().openSavedMessages();
  }

  listFolders(): Promise<ReadonlyArray<ChatFolderDto>> {
    return this.delegate().listFolders();
  }

  listMessagePage(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    return this.delegate().listMessagePage(chatId, input);
  }

  listSharedMedia(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    return this.delegate().listSharedMedia(chatId, input);
  }

  listPinnedMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    return this.delegate().listPinnedMessages(chatId);
  }

  listChatMembers(chatId: string): Promise<ReadonlyArray<ChatMemberDto>> {
    return this.delegate().listChatMembers(chatId);
  }

  getPeerProfile(peerId: string): Promise<PeerProfileDto> {
    return this.delegate().getPeerProfile(peerId);
  }

  listStickerSets(): Promise<ReadonlyArray<StickerSetDto>> {
    return this.delegate().listStickerSets();
  }

  getStickerCatalog(): Promise<StickerCatalogDto> {
    return this.delegate().getStickerCatalog();
  }

  reorderStickerSets(setIds: ReadonlyArray<string>): Promise<void> {
    return this.delegate().reorderStickerSets(setIds);
  }

  setStickerFavorite(stickerId: string, favorite: boolean): Promise<void> {
    return this.delegate().setStickerFavorite(stickerId, favorite);
  }

  removeRecentSticker(stickerId: string): Promise<void> {
    return this.delegate().removeRecentSticker(stickerId);
  }

  clearRecentStickers(): Promise<void> {
    return this.delegate().clearRecentStickers();
  }

  searchStickers(query: string): Promise<ReadonlyArray<StickerItemDto>> {
    return this.delegate().searchStickers(query);
  }

  sendSticker(
    chatId: string,
    stickerId: string,
    clientId?: string,
  ): Promise<MessageDto> {
    return this.delegate().sendSticker(chatId, stickerId, clientId);
  }

  getStickerSet(reference: StickerSetReferenceDto): Promise<StickerSetDto> {
    return this.delegate().getStickerSet(reference);
  }

  setStickerSetInstalled(shortName: string, installed: boolean): Promise<void> {
    return this.delegate().setStickerSetInstalled(shortName, installed);
  }

  getCustomEmoji(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<StickerItemDto>> {
    return this.delegate().getCustomEmoji(documentIds);
  }

  searchGlobal(query: string): Promise<GlobalSearchResultDto> {
    return this.delegate().searchGlobal(query);
  }

  searchMessages(
    chatId: string,
    query: string,
    input: MessageSearchPageInput,
  ): Promise<MessageSearchPageDto> {
    return this.delegate().searchMessages(chatId, query, input);
  }

  sendMessage(
    chatId: string,
    body: string,
    replyToId?: string,
    clientId?: string,
    silent?: boolean,
    entities?: ReadonlyArray<MessageEntityDto>,
  ): Promise<MessageDto> {
    return this.delegate().sendMessage(
      chatId,
      body,
      replyToId,
      clientId,
      silent,
      entities,
    );
  }

  downloadMedia(mediaId: string): Promise<void> {
    return this.delegate().downloadMedia(mediaId);
  }

  cancelMediaDownload(mediaId: string): Promise<void> {
    return this.delegate().cancelMediaDownload(mediaId);
  }

  resolveMediaFile(mediaId: string): Promise<string> {
    return this.delegate().resolveMediaFile(mediaId);
  }

  sendMedia(
    chatId: string,
    files: ReadonlyArray<TelegramUploadFile>,
    caption: string,
    replyToId: string | undefined,
    clientId: string | undefined,
    uploadId: string,
  ): Promise<ReadonlyArray<MessageDto>> {
    return this.delegate().sendMedia(
      chatId,
      files,
      caption,
      replyToId,
      clientId,
      uploadId,
    );
  }

  cancelMediaUpload(uploadId: string): Promise<void> {
    return this.delegate().cancelMediaUpload(uploadId);
  }

  editMessage(input: EditMessageInput): Promise<void> {
    return this.delegate().editMessage(input);
  }

  deleteMessage(input: DeleteMessageInput): Promise<void> {
    return this.delegate().deleteMessage(input);
  }

  forwardMessage(input: ForwardMessageInput): Promise<void> {
    return this.delegate().forwardMessage(input);
  }

  setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    return this.delegate().setChatPinned(chatId, pinned);
  }

  setChatMuted(chatId: string, muted: boolean): Promise<void> {
    return this.delegate().setChatMuted(chatId, muted);
  }

  setChatRead(chatId: string, read: boolean): Promise<void> {
    return this.delegate().setChatRead(chatId, read);
  }

  setChatArchived(chatId: string, archived: boolean): Promise<void> {
    return this.delegate().setChatArchived(chatId, archived);
  }

  setTyping(chatId: string, typing: boolean): Promise<void> {
    return this.delegate().setTyping(chatId, typing);
  }

  saveDraft(chatId: string, text: string): Promise<void> {
    return this.delegate().saveDraft(chatId, text);
  }

  answerBotCallback(
    chatId: string,
    messageId: string,
    buttonId: string,
  ): Promise<BotCallbackAnswerDto> {
    return this.delegate().answerBotCallback(chatId, messageId, buttonId);
  }

  setMessageReaction(input: SetMessageReactionInput): Promise<void> {
    return this.delegate().setMessageReaction(input);
  }

  listAvailableReactions(
    chatId: string,
    messageId?: string,
  ): Promise<ReadonlyArray<string>> {
    return this.delegate().listAvailableReactions(chatId, messageId);
  }

  clickAnimatedEmoji(
    chatId: string,
    messageId: string,
  ): Promise<AnimatedEmojiEffectDto | null> {
    return this.delegate().clickAnimatedEmoji(chatId, messageId);
  }

  private delegate(): TelegramAccountClient {
    return this.coordinatorFor(this.foregroundId ?? SCRATCH_ACCOUNT_ID);
  }

  private coordinatorFor(accountId: string): TelegramAccountClient {
    const existing = this.coordinators.get(accountId);
    if (existing) return existing;
    const coordinator = this.options.createCoordinator(accountId, (state) =>
      this.onAccountState(accountId, state),
    );
    coordinator.subscribe((event) => {
      // Only the foreground account is attached to the workspace; a parked
      // account's connection is down and must not leak events.
      if (accountId === this.foregroundId) {
        for (const listener of this.listeners) listener(event);
      }
    });
    this.coordinators.set(accountId, coordinator);
    return coordinator;
  }

  private onAccountState(accountId: string, state: TelegramAuthState): void {
    if (accountId !== this.foregroundId) return;
    this.options.onState(state);
    // Ready handling mutates the registry, so it is queued: two accounts
    // reaching `ready` at once (a restore racing a fresh login) apply in
    // emission order rather than interleaving their writes.
    if (state.status === "ready") {
      this.readyQueue = this.readyQueue
        .then(() => this.onAccountReady(accountId))
        .catch(() => undefined);
    }
  }

  /**
   * A `ready` account is signed in, so the registry learns (or refreshes)
   * its identity from `CurrentUserDto`. A freshly authorized pending
   * account additionally becomes active and parks the previous one.
   */
  private async onAccountReady(accountId: string): Promise<void> {
    const coordinator = this.coordinators.get(accountId);
    if (!coordinator) return;
    let user: CurrentUserDto;
    try {
      user = await coordinator.getCurrentUser();
    } catch {
      // Identity refresh is best-effort; the registry keeps what it has.
      return;
    }
    const snapshot = await this.loadSnapshot();
    const existing = snapshot.accounts.find(
      (account) => account.id === accountId,
    );
    const record: TelegramAccountRecord = {
      id: accountId,
      displayName: user.displayName,
      username: user.username,
      avatarDataUrl: user.avatarDataUrl,
      avatarPlaceholder: user.avatarPlaceholder,
      unreadCount: existing?.unreadCount ?? 0,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    if (!existing && this.pendingNewAccountId === accountId) {
      this.pendingNewAccountId = null;
      await this.persist({
        accounts: [record, ...snapshot.accounts],
        activeAccountId: accountId,
      });
      const previousId = snapshot.activeAccountId;
      if (previousId && previousId !== accountId) {
        await this.parkAccount(previousId);
      }
      return;
    }
    if (this.foregroundId !== accountId) {
      await this.refreshAccountIdentity(accountId, record);
      return;
    }
    await this.persist({
      accounts: [
        record,
        ...snapshot.accounts.filter((account) => account.id !== accountId),
      ],
      activeAccountId: accountId,
    });
  }

  /**
   * Identity refresh for an account that is no longer foreground (its
   * `ready` raced a switch): update its record in place without touching
   * the active pointer or the switcher's order.
   */
  private async refreshAccountIdentity(
    accountId: string,
    record: TelegramAccountRecord,
  ): Promise<void> {
    const snapshot = await this.loadSnapshot();
    if (!snapshot.accounts.some((account) => account.id === accountId)) return;
    await this.persist({
      ...snapshot,
      accounts: snapshot.accounts.map((account) =>
        account.id === accountId ? record : account,
      ),
    });
  }

  /**
   * Parks a connected account: persists its unread total for the switcher
   * badge, then drops the connection. The TDLib directory stays on disk —
   * `disconnect()` parks, `logout()` ends — so switching back restores it.
   */
  private async parkAccount(accountId: string): Promise<void> {
    const unreadCount = await this.captureUnread(accountId);
    const snapshot = await this.loadSnapshot();
    await this.persist({
      ...snapshot,
      accounts: snapshot.accounts.map((account) =>
        account.id === accountId ? { ...account, unreadCount } : account,
      ),
    });
    await this.coordinators.get(accountId)?.disconnect();
  }

  /**
   * Sum unread across the live chat list. TDLib does not write
   * `dialogs.json`; the adapter's in-memory chats (SQLite-backed after
   * restore) are the source of truth.
   */
  private async captureUnread(accountId: string): Promise<number> {
    const client = this.coordinators.get(accountId);
    if (!client) return 0;
    let total = 0;
    let cursor: ChatPageCursorDto | null = null;
    do {
      const page = await client.listChatPage({
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      total += page.items.reduce((sum, chat) => sum + chat.unreadCount, 0);
      cursor = page.nextCursor;
    } while (cursor);
    return total;
  }

  private async discardPendingLogin(): Promise<void> {
    if (!this.pendingNewAccountId) return;
    const pendingId = this.pendingNewAccountId;
    this.pendingNewAccountId = null;
    const snapshot = await this.loadSnapshot();
    this.foregroundId = snapshot.activeAccountId ?? SCRATCH_ACCOUNT_ID;
    const coordinator = this.coordinators.get(pendingId);
    this.coordinators.delete(pendingId);
    // A login that never completed saved no session, so plain disconnect is
    // the whole cleanup; there is nothing on disk to remove.
    await coordinator?.disconnect();
  }

  private async loadSnapshot(): Promise<TelegramAccountRegistrySnapshot> {
    if (this.snapshot) return this.snapshot;
    const stored = await this.options.registry.get();
    if (stored && stored.accounts.length > 0) {
      this.snapshot = stored;
      return stored;
    }
    // First boot: leftover GramJS session files cannot be imported.
    await this.discardLegacyGramjsFiles();
    this.snapshot = (await this.registerDemoAccounts()) ?? {
      accounts: [],
      activeAccountId: null,
    };
    return this.snapshot;
  }

  private async persist(
    snapshot: TelegramAccountRegistrySnapshot,
  ): Promise<void> {
    this.snapshot = snapshot;
    await this.options.registry.save(snapshot);
  }

  /**
   * GramJS StringSession files cannot become a TDLib database. Delete them
   * so they are not mistaken for a restorable account.
   */
  private async discardLegacyGramjsFiles(): Promise<void> {
    const legacy = this.options.legacyPaths;
    if (!legacy) return;
    await rm(legacy.session, { force: true });
    await rm(legacy.profile, { force: true });
    await rm(legacy.snapshot, { force: true });
  }

  /**
   * The demo workspace registers two deterministic accounts so the switcher
   * is exercisable under `TELO_DEMO_WORKSPACE=1`. The second has no session
   * by design: switching to it lands on an idle demo workspace (every
   * session-less coordinator falls back to the demo repository) rather
   * than a second dataset, and its unread count stays 0.
   */
  private async registerDemoAccounts(): Promise<TelegramAccountRegistrySnapshot | null> {
    if (!this.options.demoWorkspace) return null;
    const now = new Date().toISOString();
    const demo = (id: string, displayName: string): TelegramAccountRecord => ({
      id,
      displayName,
      username: null,
      avatarDataUrl: null,
      unreadCount: 0,
      createdAt: now,
      lastActiveAt: now,
    });
    const snapshot: TelegramAccountRegistrySnapshot = {
      accounts: [demo("demo", "Demo User"), demo("demo-second", "Demo User 2")],
      activeAccountId: "demo",
    };
    for (const account of snapshot.accounts)
      this.demoAccountIds.add(account.id);
    await this.options.registry.save(snapshot);
    return snapshot;
  }

  private newAccountId(): string {
    return this.options.createAccountId?.() ?? randomUUID();
  }
}
