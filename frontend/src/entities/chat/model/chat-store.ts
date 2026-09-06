import { EventType, type AGUIEvent } from "@ag-ui/core";
import { create } from "zustand";

import type {
  ChatDto,
  ChatFolderDto,
  ChatPageCursorDto,
  DeleteMessageScope,
  GlobalSearchResultDto,
  MessageAgentActionKind,
  MessageAgentActionOutput,
  MessageAgentActionTone,
  MessageDto,
  MessageEntityDto,
  MessageMediaDto,
  MessageMediaKind,
  MessageReactionDto,
  MessageReplyToDto,
  StickerItemDto,
  StickerSetDto,
  StickerSetSummaryDto,
  TelegramWorkspaceEvent,
  UiContextSnapshot,
} from "../../../../../contracts/src/ipc";
import {
  ARCHIVE_FOLDER_ID,
  MESSAGE_ACTION_EVENT_NAME,
  MESSAGE_ACTION_THREAD_ID,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import { isTechnicalErrorMessage } from "shared/lib/user-facing-error";

let selectionRequest = 0;
let globalSearchRequest = 0;
let chatSearchRequest = 0;
let jumpRequest = 0;

const DRAFT_SAVE_DEBOUNCE_MS = 500;
const TYPING_IDLE_MS = 4000;
const SEARCH_DEBOUNCE_MS = 300;

// Debouncing state lives at module scope, not inside the store: it tracks
// pending IPC side effects (per chat id) across the store's lifetime, which
// zustand's plain object state isn't a good fit for.
const draftSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const typingIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const typingSignalSent = new Set<string>();
let globalSearchTimer: ReturnType<typeof setTimeout> | null = null;
let chatSearchTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDraftSave(chatId: string, text: string): void {
  const existing = draftSaveTimers.get(chatId);
  if (existing) clearTimeout(existing);
  draftSaveTimers.set(
    chatId,
    setTimeout(() => {
      draftSaveTimers.delete(chatId);
      void window.telo.workspace.saveDraft(chatId, text);
    }, DRAFT_SAVE_DEBOUNCE_MS),
  );
}

// Mirrors Telegram's own typing signal: fires once when the composer goes
// from empty to non-empty, then cancels itself after an idle period so a
// stalled composer doesn't advertise typing forever.
function signalTyping(chatId: string, typing: boolean): void {
  const idleTimer = typingIdleTimers.get(chatId);
  if (idleTimer) clearTimeout(idleTimer);
  typingIdleTimers.delete(chatId);
  if (!typing) {
    if (typingSignalSent.delete(chatId)) {
      void window.telo.workspace.setTyping(chatId, false);
    }
    return;
  }
  if (!typingSignalSent.has(chatId)) {
    typingSignalSent.add(chatId);
    void window.telo.workspace.setTyping(chatId, true);
  }
  typingIdleTimers.set(
    chatId,
    setTimeout(() => {
      typingIdleTimers.delete(chatId);
      typingSignalSent.delete(chatId);
      void window.telo.workspace.setTyping(chatId, false);
    }, TYPING_IDLE_MS),
  );
}

function clearDraftState(chatId: string): void {
  const timer = draftSaveTimers.get(chatId);
  if (timer) clearTimeout(timer);
  draftSaveTimers.delete(chatId);
  signalTyping(chatId, false);
  void window.telo.workspace.saveDraft(chatId, "");
}

// A remote draft only seeds the local composer for a chat that has not been
// typed into yet; an existing entry (even an empty string) is the user's own
// edit and must win.
function hydrateDrafts(
  current: Record<string, string>,
  chats: ReadonlyArray<ChatDto>,
): Record<string, string> {
  let next = current;
  for (const chat of chats) {
    if (chat.draftPreview && !(chat.id in next)) {
      if (next === current) next = { ...current };
      next[chat.id] = chat.draftPreview;
    }
  }
  return next;
}

/**
 * The preferences the store mirrors because it reads them outside React:
 * notification shape and the muted-chat unread rule. `entities/chat` cannot
 * subscribe to `entities/preferences`, so the composition root pushes them
 * through `applyPreferences` whenever they change.
 */
export interface ChatPreferences {
  readonly notificationsEnabled: boolean;
  /** Desktop notifications name the sender instead of naming only the app. */
  readonly notificationSenderName: boolean;
  /** Desktop notifications carry the message body instead of a placeholder. */
  readonly notificationPreview: boolean;
  /** Muted chats contribute to the All and keyword-folder unread badges. */
  readonly countMutedChats: boolean;
}

// The window-focus check mirrors entities/agent's notifyRunComplete: a
// desktop notification only makes sense while the app is not the focused
// surface the user is already looking at.
function notifyIncomingMessage(
  preferences: ChatPreferences,
  chat: ChatDto,
  message: MessageDto,
): void {
  if (!preferences.notificationsEnabled || chat.muted || !document.hidden) {
    return;
  }
  // A reader who hides the sender or the preview still gets a notification
  // that opens the right conversation, so the chat id tag rides along
  // whatever the title and body ended up saying.
  void window.telo.shell.notify(
    preferences.notificationSenderName ? chat.title : copy.appName,
    preferences.notificationPreview
      ? message.body
      : copy.notifyIncomingMessageBody,
    chat.id,
  );
}

function replySnapshot(
  messages: ReadonlyArray<MessageDto>,
  messageId: string,
  fallbackPreview: string,
): MessageReplyToDto {
  const original = messages.find((message) => message.id === messageId);
  return {
    id: messageId,
    senderName: original?.senderName ?? "",
    body: original?.body ?? fallbackPreview,
    entities: original?.entities ?? [],
  };
}

/** Buckets after a toggle, plus the reaction the account then holds. */
interface ReactionToggle {
  readonly reactions: ReadonlyArray<MessageReactionDto>;
  /** Matches SetMessageReactionInput: the state after the call, null clears. */
  readonly emoji: string | null;
}

// Telegram gives a non-premium account one reaction per message, so picking
// an emoji moves the vote rather than adding a second one: the previously
// chosen bucket loses a count and disappears at zero, and the picked bucket
// gains one (appended when the emoji is new, since bucket order is the
// server's most-reacted-first order). Picking the chosen emoji again clears
// the vote, which is what the reaction chips toggle on.
function toggleReactionBuckets(
  current: ReadonlyArray<MessageReactionDto> | undefined,
  emoji: string,
): ReactionToggle {
  const buckets = current ?? [];
  const clearing = buckets.some(
    (bucket) => bucket.chosen && bucket.emoji === emoji,
  );
  const moved = buckets.flatMap((bucket) => {
    if (bucket.chosen) {
      const count = bucket.count - 1;
      return count > 0 ? [{ ...bucket, count, chosen: false }] : [];
    }
    if (!clearing && bucket.emoji === emoji) {
      return [{ ...bucket, count: bucket.count + 1, chosen: true }];
    }
    return [bucket];
  });
  const added =
    !clearing && !buckets.some((bucket) => bucket.emoji === emoji)
      ? [{ emoji, count: 1, chosen: true }]
      : [];
  return {
    reactions: [...moved, ...added],
    emoji: clearing ? null : emoji,
  };
}

function patchReactions(
  messages: ReadonlyArray<MessageDto>,
  messageId: string,
  reactions: ReadonlyArray<MessageReactionDto> | undefined,
): ReadonlyArray<MessageDto> {
  return messages.map((message) =>
    message.id === messageId ? { ...message, reactions } : message,
  );
}

function mediaKindFor(file: File): MessageMediaKind {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

// Builds the media preview for an optimistic outgoing bubble straight from
// the picked File; the id is placeholder-only and is replaced by the real
// media id when the ack reconciles the bubble.
function optimisticMedia(
  clientId: string,
  index: number,
  file: File,
): MessageMediaDto {
  return {
    id: `${clientId}:${index}`,
    kind: mediaKindFor(file),
    fileName: file.name || null,
    mimeType: file.type || null,
    size: file.size,
    width: null,
    height: null,
    duration: null,
    spoiler: false,
  };
}

export interface ComposerTarget {
  readonly mode: "reply" | "edit";
  readonly messageId: string;
  readonly preview: string;
}

export interface SendOptions {
  /** Telegram "send without sound": no notification sound for the recipient. */
  readonly silent?: boolean;
  /**
   * Formatting spans authored in the composer (UTF-16 ranges over `body`);
   * forwarded to the adapter so the delivered message carries real entities.
   */
  readonly entities?: ReadonlyArray<MessageEntityDto>;
}

export interface MediaDownloadState {
  readonly state: "downloading" | "ready" | "cancelled" | "failed";
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
  readonly url: string | null;
  readonly error: string | null;
}

export interface MediaUploadState {
  readonly state: "uploading" | "ready" | "cancelled" | "failed";
  readonly progress: number;
  readonly error: string | null;
}

/** A message-level agent action currently streaming into a composer draft. */
export interface MessageActionState {
  readonly messageId: string;
  readonly kind: MessageAgentActionKind;
  readonly tone: MessageAgentActionTone | null;
}

/**
 * A pending transcript jump (global message search, in-chat search
 * navigation). The conversation view consumes it with the page-until-found
 * loader, highlights the message, then clears it. `requestId` re-triggers
 * the effect when the same message is jumped to twice in a row.
 */
export interface JumpTarget {
  readonly chatId: string;
  readonly messageId: string;
  readonly requestId: number;
}

export interface ChatSearchState {
  readonly open: boolean;
  readonly query: string;
  /** Matching message ids, newest first; index 0 is the most recent match. */
  readonly matches: ReadonlyArray<string>;
  /** Server-reported match count for the whole chat history. */
  readonly totalCount: number;
  readonly index: number;
  /** Oldest loaded match id; paging fetches matches older than it. */
  readonly cursor: string | null;
  readonly loading: boolean;
}

const CLOSED_CHAT_SEARCH: ChatSearchState = {
  open: false,
  query: "",
  matches: [],
  totalCount: 0,
  index: 0,
  cursor: null,
  loading: false,
};

interface ChatState {
  chats: ReadonlyArray<ChatDto>;
  /** Server folder list (custom folders + Archive), badges included. */
  folders: ReadonlyArray<ChatFolderDto>;
  /** Active folder tab; null is the implicit "All chats" view. */
  activeFolderId: number | null;
  messages: ReadonlyArray<MessageDto>;
  activeChatId: string | null;
  loading: boolean;
  loadingMoreChats: boolean;
  loadingOlderMessages: boolean;
  chatCursor: ChatPageCursorDto | null;
  messageCursor: string | null;
  connectionState: "offline" | "synchronizing" | "connected";
  composerTarget: ComposerTarget | null;
  /** Composer text per chat id, restored when switching back to a chat. */
  drafts: Record<string, string>;
  /** Transcript scroll offset per chat id, restored when reselecting it. */
  scrollPositions: Record<string, number>;
  /**
   * Settled author photos keyed by Telegram peer id, fed by `chat-avatar`.
   * Transcript rows overlay it on the snapshot each message carried, so a
   * photo that lands later replaces the skeleton without repatching messages.
   */
  peerAvatars: Record<string, string | null>;
  /**
   * Documents behind `custom-emoji` entities, keyed by the bare document id
   * the entity carries. Null once Telegram has answered without one, so a
   * missing emoji settles on its glyph instead of retrying forever.
   */
  customEmoji: Record<string, StickerItemDto | null>;
  loadCustomEmoji(documentId: string): Promise<void>;
  /**
   * The account's installed sticker sets, null until the first load settles.
   * They live here rather than in the picker because the picker unmounts with
   * the composer's popover: holding them in the store is what keeps reopening
   * it from refetching every installed set.
   */
  stickerSets: ReadonlyArray<StickerSetSummaryDto> | null;
  recentStickers: ReadonlyArray<StickerItemDto>;
  favoriteStickers: ReadonlyArray<StickerItemDto>;
  /**
   * Why the sets could not be loaded. Set once and left alone, so a failed
   * load reads as failed instead of retrying on every reveal.
   */
  stickerSetsError: string | null;
  loadStickerSets(): Promise<void>;
  reorderStickerSets(setIds: ReadonlyArray<string>): Promise<void>;
  setStickerFavorite(sticker: StickerItemDto, favorite: boolean): Promise<void>;
  removeRecentSticker(stickerId: string): Promise<void>;
  clearRecentStickers(): Promise<void>;
  setStickerSetInstalled(set: StickerSetDto, installed: boolean): Promise<void>;
  /**
   * Emoji the active chat allows as reactions, in Telegram's order. Empty
   * until the first picker of that chat loads them, and emptied again on a
   * chat switch: the allowed set is a per-chat setting.
   */
  availableReactions: ReadonlyArray<string>;
  loadAvailableReactions(): Promise<void>;
  notificationsEnabled: boolean;
  notificationSenderName: boolean;
  notificationPreview: boolean;
  countMutedChats: boolean;
  /**
   * Mirrors the persisted preferences the store reads outside React. Applying
   * them recomputes the keyword badges, so a toggle lands on the badges and
   * the next notification without waiting for a reload.
   */
  applyPreferences(preferences: ChatPreferences): void;
  mediaDownloads: Record<string, MediaDownloadState>;
  mediaUploads: Record<string, MediaUploadState>;
  /** Sidebar search field text; drives the debounced server global search. */
  searchQuery: string;
  /** Latest server global search result; null when the field is empty. */
  globalSearchResults: GlobalSearchResultDto | null;
  globalSearching: boolean;
  jumpTarget: JumpTarget | null;
  /** Message currently tinted as a search/jump target. */
  highlightedMessageId: string | null;
  /**
   * Message ids that should play `Message animateIn` (newly arrived or
   * just-sent). History loads and prepends never join this list.
   */
  animateInMessageIds: ReadonlyArray<string>;
  /**
   * Chat ids that just jumped to the pin/new-message top slot. The sidebar
   * may fade those rows; it must not run a list layout spring.
   */
  animateChatIds: ReadonlyArray<string>;
  chatSearch: ChatSearchState;
  /** In-flight message AI action; null while no action streams. */
  messageAction: MessageActionState | null;
  /** Last message-action failure, surfaced inline above the composer. */
  messageActionError: string | null;
  /**
   * Latest text a message action streamed into a draft. The composer follows
   * this signal instead of `drafts` so its own send flow (which clears the
   * draft while a failed upload must keep the caption) never clobbers typed
   * text.
   */
  draftStream: { readonly chatId: string; readonly text: string } | null;
  load(options?: { readonly includeMessages?: boolean }): Promise<void>;
  loadMoreChats(): Promise<void>;
  loadOlderMessages(): Promise<void>;
  select(chatId: string): Promise<void>;
  /**
   * Opens Saved Messages, creating the private chat when it is not in the
   * loaded dialog page.
   */
  openSavedMessages(): Promise<void>;
  /**
   * Ensures Saved Messages is in the loaded chat list without selecting it,
   * so the forward picker can target it.
   */
  includeSavedMessages(): Promise<void>;
  send(body: string, options?: SendOptions): Promise<void>;
  /** Sends one sticker from the composer picker into the active chat. */
  sendSticker(sticker: StickerItemDto): Promise<void>;
  resendMessage(messageId: string): Promise<void>;
  downloadMedia(mediaId: string): Promise<void>;
  cancelMediaDownload(mediaId: string): Promise<void>;
  sendMedia(
    files: ReadonlyArray<File>,
    caption: string,
    uploadId: string,
  ): Promise<void>;
  cancelMediaUpload(uploadId: string): Promise<void>;
  startReply(message: MessageDto): void;
  startEdit(message: MessageDto): void;
  cancelComposerTarget(): void;
  deleteMessage(messageId: string, scope?: DeleteMessageScope): Promise<void>;
  /**
   * Sets the account's reaction on a message, or clears it when `emoji` is
   * already the chosen one — Telegram's one-reaction-per-account shape. The
   * buckets flip optimistically; a failed IPC restores them and rethrows.
   */
  toggleReaction(messageId: string, emoji: string): Promise<void>;
  /** Selection-mode message ids, in the order the user picked them. */
  selectedMessageIds: ReadonlyArray<string>;
  /** Enters selection mode with the given message selected. */
  startSelection(messageId: string): void;
  /** Flips one message's selection; emptying the set exits selection mode. */
  toggleSelection(messageId: string): void;
  exitSelection(): void;
  /** Deletes every selected message with the given scope, then exits. */
  deleteSelectedMessages(scope: DeleteMessageScope): Promise<void>;
  /** Forwards every selected message to one chat, then exits. */
  forwardSelectedMessages(toChatId: string): Promise<void>;
  forwardMessage(
    messageId: string,
    toChatId: string,
    options?: { hideSender?: boolean },
  ): Promise<void>;
  togglePin(chatId: string): Promise<void>;
  toggleMute(chatId: string): Promise<void>;
  toggleRead(chatId: string): Promise<void>;
  /**
   * Moves a chat into or out of the Archive. The folderId flip and the
   * Archive folder entry apply optimistically; a failed IPC rolls both back.
   */
  setArchived(chatId: string, archived: boolean): Promise<void>;
  setDraft(chatId: string, text: string): void;
  /**
   * Runs a message-level AI action (translate / rewrite / draft reply) and
   * streams the result into the chat's composer draft. A second invocation
   * while an action streams is ignored.
   */
  runMessageAction(
    message: MessageDto,
    kind: MessageAgentActionKind,
    tone?: MessageAgentActionTone,
  ): Promise<void>;
  setScrollPosition(chatId: string, top: number): void;
  selectFolder(folderId: number | null): void;
  createKeywordFolder(title: string, query: string): Promise<void>;
  updateKeywordFolder(id: number, title: string, query: string): Promise<void>;
  deleteKeywordFolder(id: number): Promise<void>;
  setSearchQuery(query: string): void;
  /** Selects the chat when needed, then asks the view to scroll to the message. */
  requestJumpToMessage(chatId: string, messageId: string): Promise<void>;
  clearJumpTarget(): void;
  setHighlightedMessage(messageId: string | null): void;
  openChatSearch(): void;
  closeChatSearch(): void;
  setChatSearchQuery(query: string): void;
  /** Moves to the next older match, paging the server for more when needed. */
  chatSearchOlder(): Promise<void>;
  /** Moves to the next newer match. */
  chatSearchNewer(): void;
  receive(event: TelegramWorkspaceEvent): void;
}

// The All view is every chat that is not archived, mirroring Telegram's main
// list. A native folder view is the chats whose folderId matches the tab.
// Keyword folders are virtual: membership is `keywordFolderIds`, so a chat
// can sit in a native folder and any number of keyword folders at once.
export function chatsForFolder(
  chats: ReadonlyArray<ChatDto>,
  folderId: number | null,
): ReadonlyArray<ChatDto> {
  if (folderId === null) {
    return chats.filter((chat) => chat.folderId !== ARCHIVE_FOLDER_ID);
  }
  return chats.filter(
    (chat) =>
      chat.folderId === folderId ||
      (chat.keywordFolderIds ?? []).includes(folderId),
  );
}

function isKeywordFolder(folder: ChatFolderDto): boolean {
  return folder.kind === "keyword";
}

function messageBodyMatchesKeyword(body: string, query: string): boolean {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return false;
  return body.toLocaleLowerCase().includes(term);
}

// The All tab has no server folder entry and a keyword folder is virtual, so
// both badges are summed here from the chats the view collects; native folder
// badges come from the server snapshot (`ChatFolderDto.unreadCount`).
// A muted chat is one the reader silenced, so whether its unread messages
// still deserve a badge is their call rather than a fixed rule.
export function folderUnread(
  chats: ReadonlyArray<ChatDto>,
  folderId: number | null,
  countMuted: boolean,
): number {
  return chatsForFolder(chats, folderId).reduce(
    (total, chat) =>
      countMuted || !chat.muted ? total + chat.unreadCount : total,
    0,
  );
}

/** Recompute keyword-folder unread badges from the chats they currently collect. */
function withKeywordUnread(
  folders: ReadonlyArray<ChatFolderDto>,
  chats: ReadonlyArray<ChatDto>,
  countMuted: boolean,
): ReadonlyArray<ChatFolderDto> {
  return folders.map((folder) => {
    if (!isKeywordFolder(folder)) return folder;
    return {
      ...folder,
      unreadCount: folderUnread(chats, folder.id, countMuted),
    };
  });
}

// Archive membership is the chat's folderId, and the Archive folder entry
// exists only while it holds chats — the rule the demo snapshot and the
// TDLib folder mapping share. A local membership change therefore
// rebuilds that entry alongside the chat patch: its position is preserved
// when it was already listed, otherwise it is appended the way the server
// snapshot lists it after the custom folders.
function archivedChatPatch(
  state: Pick<ChatState, "chats" | "folders">,
  chatId: string,
  folderId: number | null,
): Pick<ChatState, "chats" | "folders"> {
  const chats = patchChat(state.chats, chatId, { folderId }).chats;
  const rest = state.folders.filter(
    (folder) => folder.id !== ARCHIVE_FOLDER_ID,
  );
  const archived = chats.filter((chat) => chat.folderId === ARCHIVE_FOLDER_ID);
  if (archived.length === 0) return { chats, folders: rest };
  const entry: ChatFolderDto = {
    id: ARCHIVE_FOLDER_ID,
    title: "Archive",
    unreadCount: archived.reduce((total, chat) => total + chat.unreadCount, 0),
  };
  const index = state.folders.findIndex(
    (folder) => folder.id === ARCHIVE_FOLDER_ID,
  );
  return {
    chats,
    folders:
      index === -1
        ? [...rest, entry]
        : [...rest.slice(0, index), entry, ...rest.slice(index)],
  };
}

function assignKeywordMembership(
  chat: ChatDto,
  folders: ReadonlyArray<ChatFolderDto>,
  body: string,
): ChatDto {
  const extra = folders
    .filter(
      (folder) =>
        isKeywordFolder(folder) &&
        folder.query !== undefined &&
        messageBodyMatchesKeyword(body, folder.query),
    )
    .map((folder) => folder.id);
  if (extra.length === 0) return chat;
  const current = chat.keywordFolderIds ?? [];
  const keywordFolderIds = [...current];
  for (const id of extra) {
    if (!keywordFolderIds.includes(id)) keywordFolderIds.push(id);
  }
  if (keywordFolderIds.length === current.length) return chat;
  return { ...chat, keywordFolderIds };
}

// Ids being resolved right now. Kept outside the store because it is request
// bookkeeping, not state any component renders.
const inFlightCustomEmoji = new Set<string>();
// True while the installed sticker sets are being fetched. Same reason as the
// emoji ids above: it is request bookkeeping, and a second reveal must not
// start a second listing.
let loadingStickerSets = false;
// The chat whose available reactions are held (or on their way). Same reason
// as the flag above: reopening a reaction picker reads what was fetched the
// first time, and only a chat switch makes the list stale.
let availableReactionsChatId: string | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  folders: [],
  activeFolderId: null,
  messages: [],
  activeChatId: null,
  loading: true,
  loadingMoreChats: false,
  loadingOlderMessages: false,
  chatCursor: null,
  messageCursor: null,
  connectionState: "connected",
  composerTarget: null,
  drafts: {},
  scrollPositions: {},
  peerAvatars: {},
  customEmoji: {},
  stickerSets: null,
  recentStickers: [],
  favoriteStickers: [],
  stickerSetsError: null,
  availableReactions: [],
  notificationsEnabled: false,
  notificationSenderName: true,
  notificationPreview: true,
  countMutedChats: false,
  mediaDownloads: {},
  mediaUploads: {},
  searchQuery: "",
  globalSearchResults: null,
  globalSearching: false,
  jumpTarget: null,
  highlightedMessageId: null,
  animateInMessageIds: [],
  animateChatIds: [],
  chatSearch: CLOSED_CHAT_SEARCH,
  messageAction: null,
  messageActionError: null,
  draftStream: null,
  selectedMessageIds: [],
  applyPreferences(preferences) {
    set((state) => ({
      ...preferences,
      // The muted-chat rule feeds the keyword badges, which live in state:
      // recompute them here instead of leaving the old totals on screen until
      // the next workspace event happens to arrive.
      folders: withKeywordUnread(
        state.folders,
        state.chats,
        preferences.countMutedChats,
      ),
    }));
  },
  async load(options) {
    const request = ++selectionRequest;
    try {
      const [chatPage, preferences] = await Promise.all([
        window.telo.workspace.listChatPage(),
        window.telo.preferences.get(),
      ]);
      const chats = chatPage.items;
      // The All view is the default landing view, so the default active chat
      // is its first entry — never an archived chat.
      const firstChatId = chatsForFolder(chats, null)[0]?.id ?? null;
      // A restoring launch has only a dialog snapshot. Leave the transcript
      // unselected until the live repository is ready so child surfaces do
      // not ask the temporary repository for messages, pins, or members.
      const activeChatId =
        options?.includeMessages === false ? null : firstChatId;
      const messagePage =
        activeChatId && options?.includeMessages !== false
          ? await window.telo.workspace.listMessagePage(activeChatId)
          : { items: [], nextCursor: null };
      if (request !== selectionRequest) return;
      // The landing chat may differ from the one that was open, so the
      // allowed reaction set is dropped with the rest of the per-chat state.
      availableReactionsChatId = null;
      set((state) => ({
        chats,
        activeChatId,
        messages: messagePage.items,
        chatCursor: chatPage.nextCursor,
        messageCursor: messagePage.nextCursor,
        loading: false,
        loadingMoreChats: false,
        loadingOlderMessages: false,
        drafts: hydrateDrafts(state.drafts, chats),
        notificationsEnabled: preferences.notificationsEnabled,
        notificationSenderName: preferences.notificationSenderName,
        notificationPreview: preferences.notificationPreview,
        countMutedChats: preferences.countMutedChats,
        animateInMessageIds: [],
        animateChatIds: [],
        availableReactions: [],
      }));
      // Folder unread walks every dialog and Telegram flood-waits that RPC.
      // Keep it off the first-paint path so the chat list can appear.
      void window.telo.workspace.listFolders().then(
        (folders) => {
          if (request === selectionRequest) {
            set((state) => ({
              folders: withKeywordUnread(
                folders,
                state.chats,
                state.countMutedChats,
              ),
            }));
          }
        },
        () => {
          // Folder unread is off the first-paint path. A GetDialogFilters
          // failure stays in the main-process log: the chat list already
          // painted, and the conversation header has no error strip.
        },
      );
    } catch {
      if (request === selectionRequest) {
        set({ loading: false });
      }
    }
  },
  async loadMoreChats() {
    const { chatCursor, loadingMoreChats } = get();
    if (!chatCursor || loadingMoreChats) return;
    set({ loadingMoreChats: true });
    try {
      const page = await window.telo.workspace.listChatPage({
        cursor: chatCursor,
      });
      set((state) => ({
        chats: mergeChats(state.chats, page.items),
        chatCursor: page.nextCursor,
        loadingMoreChats: false,
        drafts: hydrateDrafts(state.drafts, page.items),
      }));
    } catch {
      set({ loadingMoreChats: false });
    }
  },
  async select(chatId) {
    if (chatId === get().activeChatId) return;
    const request = ++selectionRequest;
    // Switching chats ends any in-chat search: its matches, highlight, and
    // pending debounce all belong to the previous conversation.
    resetChatSearch();
    // Which emoji a chat allows is a chat setting, so the previous list is
    // dropped here and the next picker of this conversation reloads it.
    availableReactionsChatId = null;
    // A pending reply/edit references a message of the previous chat; it must
    // not leak into the newly selected conversation. The same goes for a
    // multi-selection, which is scoped to the transcript it was made in.
    set({
      activeChatId: chatId,
      messages: [],
      loading: true,
      messageCursor: null,
      loadingOlderMessages: false,
      composerTarget: null,
      chatSearch: CLOSED_CHAT_SEARCH,
      highlightedMessageId: null,
      jumpTarget: null,
      selectedMessageIds: [],
      animateInMessageIds: [],
      availableReactions: [],
    });
    try {
      const page = await window.telo.workspace.listMessagePage(chatId);
      if (request === selectionRequest && get().activeChatId === chatId) {
        set({
          messages: page.items,
          messageCursor: page.nextCursor,
          loading: false,
          animateInMessageIds: [],
        });
      }
    } catch {
      if (request === selectionRequest && get().activeChatId === chatId) {
        set({ loading: false });
      }
    }
  },
  async openSavedMessages() {
    const existing = get().chats.find((chat) => chat.kind === "saved");
    if (existing) {
      await get().select(existing.id);
      return;
    }
    await get().includeSavedMessages();
    const saved = get().chats.find((chat) => chat.kind === "saved");
    if (saved) await get().select(saved.id);
  },
  async includeSavedMessages() {
    if (get().chats.some((chat) => chat.kind === "saved")) return;
    const chat = await window.telo.workspace.openSavedMessages();
    set((state) => ({
      chats: upsertChat(state.chats, chat),
      drafts: hydrateDrafts(state.drafts, [chat]),
    }));
  },
  async loadOlderMessages() {
    const { activeChatId, messageCursor, loadingOlderMessages } = get();
    if (!activeChatId || !messageCursor || loadingOlderMessages) return;
    const chatId = activeChatId;
    const cursor = messageCursor;
    set({ loadingOlderMessages: true });
    try {
      const page = await window.telo.workspace.listMessagePage(chatId, {
        beforeMessageId: cursor,
      });
      if (get().activeChatId !== chatId) return;
      // One commit: the prepended page and the loading flag flip together, so
      // the transcript's scroll compensation and the spinner exit happen in a
      // single render.
      set((state) => ({
        messages: mergeMessages(page.items, state.messages),
        messageCursor: page.nextCursor,
        loadingOlderMessages: false,
      }));
    } catch {
      if (get().activeChatId === chatId) {
        set({ loadingOlderMessages: false });
      }
    }
  },
  async send(body, options) {
    const chatId = get().activeChatId;
    if (!chatId) return;
    const target = get().composerTarget;
    if (target?.mode === "edit") {
      await window.telo.workspace.editMessage({
        chatId,
        messageId: target.messageId,
        body,
      });
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === target.messageId
            ? {
                ...message,
                body,
                entities: options?.entities ?? [],
                editedAt: new Date().toISOString(),
              }
            : message,
        ),
        composerTarget: null,
      }));
      // An edit borrows the composer: the chat's unsent draft survives it,
      // and the composer restores that text when edit mode ends.
      return;
    }
    const clientId = crypto.randomUUID();
    const optimistic: MessageDto = {
      id: clientId,
      chatId,
      senderName: "",
      senderId: "",
      senderAvatarUrl: null,
      body,
      entities: options?.entities ?? [],
      media: null,
      groupedId: null,
      sentAt: new Date().toISOString(),
      outgoing: true,
      status: "sending",
      replyTo:
        target?.mode === "reply"
          ? replySnapshot(get().messages, target.messageId, target.preview)
          : null,
      clientId,
    };
    set((state) => ({
      messages: upsertMessage(state.messages, optimistic),
      composerTarget: null,
      drafts: { ...state.drafts, [chatId]: "" },
      animateInMessageIds: withIds(state.animateInMessageIds, [clientId]),
    }));
    clearDraftState(chatId);
    try {
      const sendInput = {
        clientId,
        ...(options?.silent ? { silent: true } : {}),
        ...(options?.entities && options.entities.length > 0
          ? { entities: options.entities }
          : {}),
      };
      const message =
        target?.mode === "reply"
          ? await window.telo.workspace.sendMessage(chatId, body, {
              ...sendInput,
              replyToId: target.messageId,
            })
          : await window.telo.workspace.sendMessage(chatId, body, sendInput);
      set((state) => {
        const alreadyReconciled = state.messages.some(
          (entry) =>
            entry.clientId === clientId &&
            entry.id !== clientId &&
            entry.id !== message.id,
        );
        if (alreadyReconciled) return state;
        return {
          messages: upsertMessage(
            state.messages.filter((entry) => entry.id !== clientId),
            message,
          ),
        };
      });
    } catch {
      // Native Telegram semantics: the undelivered bubble stays in the
      // transcript as `failed` instead of bouncing the body back into the
      // composer; the context menu's Resend action retries the same send.
      set((state) => ({
        messages: state.messages.map((entry) =>
          entry.id === clientId
            ? { ...entry, status: "failed" as const }
            : entry,
        ),
      }));
    }
  },
  async loadCustomEmoji(documentId) {
    // One emoji often repeats across a chat, so an id already resolved or in
    // flight is skipped rather than refetched per occurrence.
    if (documentId in get().customEmoji) return;
    if (inFlightCustomEmoji.has(documentId)) return;
    inFlightCustomEmoji.add(documentId);
    try {
      const [item] = await window.telo.workspace.getCustomEmoji([documentId]);
      set((state) => ({
        customEmoji: { ...state.customEmoji, [documentId]: item ?? null },
      }));
    } catch {
      // A failed lookup settles on the glyph; the transcript keeps reading.
      set((state) => ({
        customEmoji: { ...state.customEmoji, [documentId]: null },
      }));
    } finally {
      inFlightCustomEmoji.delete(documentId);
    }
  },
  async loadStickerSets() {
    // Settled data and an in-flight listing are both terminal for the caller:
    // reopening the picker reads, it does not re-ask. A failed load settles
    // with the error instead of retrying on every reveal, the way a missing
    // custom emoji settles on its glyph.
    if (get().stickerSets !== null || get().stickerSetsError !== null) return;
    if (loadingStickerSets) return;
    loadingStickerSets = true;
    try {
      const catalog = await window.telo.workspace.getStickerCatalog();
      set({
        stickerSets: catalog.sets,
        recentStickers: catalog.recent,
        favoriteStickers: catalog.favorites,
      });
    } catch (error) {
      set({ stickerSetsError: errorMessage(error) });
    } finally {
      loadingStickerSets = false;
    }
  },
  async reorderStickerSets(setIds) {
    const previous = get().stickerSets;
    if (!previous) return;
    const byId = new Map(previous.map((set) => [set.id, set]));
    const reordered = setIds.flatMap((id) => byId.get(id) ?? []);
    if (reordered.length !== previous.length) {
      throw new Error("Sticker set order must contain every installed set");
    }
    set({ stickerSets: reordered });
    try {
      await window.telo.workspace.reorderStickerSets(setIds);
    } catch (error) {
      set({ stickerSets: previous });
      throw error;
    }
  },
  async setStickerFavorite(sticker, favorite) {
    const previous = get().favoriteStickers;
    const next = favorite
      ? [sticker, ...previous.filter((item) => item.id !== sticker.id)]
      : previous.filter((item) => item.id !== sticker.id);
    set({ favoriteStickers: next });
    try {
      await window.telo.workspace.setStickerFavorite(sticker.id, favorite);
    } catch (error) {
      set({ favoriteStickers: previous });
      throw error;
    }
  },
  async removeRecentSticker(stickerId) {
    const previous = get().recentStickers;
    set({
      recentStickers: previous.filter((sticker) => sticker.id !== stickerId),
    });
    try {
      await window.telo.workspace.removeRecentSticker(stickerId);
    } catch (error) {
      set({ recentStickers: previous });
      throw error;
    }
  },
  async clearRecentStickers() {
    const previous = get().recentStickers;
    set({ recentStickers: [] });
    try {
      await window.telo.workspace.clearRecentStickers();
    } catch (error) {
      set({ recentStickers: previous });
      throw error;
    }
  },
  async setStickerSetInstalled(stickerSet, installed) {
    await window.telo.workspace.setStickerSetInstalled(
      stickerSet.shortName,
      installed,
    );
    set((state) => ({
      stickerSetsError: null,
      stickerSets: installed
        ? [
            { ...stickerSet, installed: true },
            ...(state.stickerSets ?? []).filter(
              (entry) => entry.id !== stickerSet.id,
            ),
          ]
        : (state.stickerSets ?? []).filter(
            (entry) => entry.id !== stickerSet.id,
          ),
    }));
  },
  async loadAvailableReactions() {
    const chatId = get().activeChatId;
    if (!chatId) return;
    // One listing per chat, like the sticker sets above: every reaction
    // picker in a conversation renders the same allowed set, so a reopen
    // reads what the first one fetched.
    if (availableReactionsChatId === chatId) return;
    availableReactionsChatId = chatId;
    try {
      const emojis = await window.telo.workspace.listAvailableReactions(chatId);
      // A chat switch mid-request already emptied the list for the new
      // conversation; the late answer describes the previous one.
      if (get().activeChatId !== chatId) return;
      set({ availableReactions: emojis });
    } catch (error) {
      // Nothing is held for this chat, so the next picker asks again.
      availableReactionsChatId = null;
      throw error;
    }
  },
  async sendSticker(sticker) {
    const chatId = get().activeChatId;
    if (!chatId) return;
    const clientId = crypto.randomUUID();
    const optimistic: MessageDto = {
      id: clientId,
      chatId,
      senderName: "",
      senderId: "",
      senderAvatarUrl: null,
      body: "",
      entities: [],
      // The optimistic bubble reuses the picker's media id, which is already
      // in the media cache from drawing the picker, so the sticker paints on
      // the first frame instead of flashing its emoji placeholder.
      media: {
        id: sticker.id,
        kind: "sticker",
        fileName: null,
        mimeType: null,
        size: null,
        width: sticker.width,
        height: sticker.height,
        duration: null,
        spoiler: false,
        sticker: {
          emoji: sticker.emoji,
          format: sticker.format,
          setReference: null,
          outlinePath: sticker.outlinePath,
        },
      },
      groupedId: null,
      sentAt: new Date().toISOString(),
      outgoing: true,
      status: "sending",
      replyTo: null,
      clientId,
    };
    set((state) => ({
      messages: upsertMessage(state.messages, optimistic),
      animateInMessageIds: withIds(state.animateInMessageIds, [clientId]),
    }));
    try {
      const message = await window.telo.workspace.sendSticker(
        chatId,
        sticker.id,
        clientId,
      );
      set((state) => {
        const alreadyReconciled = state.messages.some(
          (entry) =>
            entry.clientId === clientId &&
            entry.id !== clientId &&
            entry.id !== message.id,
        );
        if (alreadyReconciled) {
          return {
            recentStickers: [
              sticker,
              ...state.recentStickers.filter((item) => item.id !== sticker.id),
            ],
          };
        }
        return {
          messages: upsertMessage(
            state.messages.filter((entry) => entry.id !== clientId),
            message,
          ),
          recentStickers: [
            sticker,
            ...state.recentStickers.filter((item) => item.id !== sticker.id),
          ],
        };
      });
    } catch {
      // Same as a failed text send: the bubble stays as `failed` in the
      // transcript rather than vanishing.
      set((state) => ({
        messages: state.messages.map((entry) =>
          entry.id === clientId
            ? { ...entry, status: "failed" as const }
            : entry,
        ),
      }));
    }
  },
  async resendMessage(messageId) {
    const chatId = get().activeChatId;
    if (!chatId) return;
    const failed = get().messages.find(
      (message) => message.id === messageId && message.status === "failed",
    );
    if (!failed) return;
    // The bubble keeps the optimistic id and clientId from the first attempt,
    // so the adapter's ack reconciles this retry against the same placeholder.
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId
          ? { ...message, status: "sending" as const }
          : message,
      ),
    }));
    try {
      const message = await window.telo.workspace.sendMessage(
        chatId,
        failed.body,
        {
          replyToId: failed.replyTo?.id,
          clientId: failed.clientId ?? failed.id,
          ...(failed.entities.length > 0 ? { entities: failed.entities } : {}),
        },
      );
      set((state) => ({
        messages: upsertMessage(
          state.messages.filter((entry) => entry.id !== messageId),
          message,
        ),
      }));
    } catch {
      // Still undelivered: back to failed, ready for another Resend.
      set((state) => ({
        messages: state.messages.map((entry) =>
          entry.id === messageId
            ? { ...entry, status: "failed" as const }
            : entry,
        ),
      }));
    }
  },
  async downloadMedia(mediaId) {
    try {
      await window.telo.workspace.downloadMedia(mediaId);
    } catch (error) {
      set((state) => ({
        mediaDownloads: {
          ...state.mediaDownloads,
          [mediaId]: {
            state: "failed",
            downloadedBytes: 0,
            totalBytes: null,
            url: null,
            error: errorMessage(error),
          },
        },
      }));
    }
  },
  cancelMediaDownload(mediaId) {
    return window.telo.workspace.cancelMediaDownload(mediaId);
  },
  async sendMedia(files, caption, uploadId) {
    const chatId = get().activeChatId;
    if (!chatId) return;
    const target = get().composerTarget;
    if (target?.mode === "edit") throw new Error(copy.attachmentsInEdit);
    // One optimistic bubble per file; a multi-file send shares a groupedId so
    // it reads as a single album, matching the messages the ack returns.
    const clientId = crypto.randomUUID();
    const sentAt = new Date().toISOString();
    const groupedId = files.length > 1 ? crypto.randomUUID() : null;
    const optimistic: ReadonlyArray<MessageDto> = files.map((file, index) => ({
      id: `${clientId}:${index}`,
      chatId,
      senderName: "",
      senderId: "",
      senderAvatarUrl: null,
      // Telegram attaches the caption to the album's first message only.
      body: index === 0 ? caption : "",
      entities: [],
      media: optimisticMedia(clientId, index, file),
      groupedId,
      sentAt,
      outgoing: true,
      status: "sending",
      replyTo:
        index === 0 && target?.mode === "reply"
          ? replySnapshot(get().messages, target.messageId, target.preview)
          : null,
      clientId,
    }));
    set((state) => ({
      messages: mergeMessages(state.messages, optimistic),
      composerTarget: null,
      drafts: { ...state.drafts, [chatId]: "" },
      animateInMessageIds: withIds(
        state.animateInMessageIds,
        optimistic.map((entry) => entry.id),
      ),
    }));
    clearDraftState(chatId);
    try {
      const messages = await window.telo.workspace.sendMedia(chatId, files, {
        uploadId,
        caption,
        replyToId: target?.mode === "reply" ? target.messageId : undefined,
        clientId,
      });
      set((state) => ({
        messages: mergeMessages(
          state.messages.filter((entry) => entry.clientId !== clientId),
          messages,
        ),
      }));
    } catch (error) {
      // The upload failed: drop the optimistic bubbles. The composer keeps
      // the files and caption selected, so resubmitting retries the same
      // send. A cancelled upload also rejects, after the `cancelled` event.
      // Neither case belongs in the conversation header — the composer
      // already owns the upload-failure surface.
      set((state) => ({
        messages: state.messages.filter((entry) => entry.clientId !== clientId),
      }));
      throw error;
    }
  },
  cancelMediaUpload(uploadId) {
    return window.telo.workspace.cancelMediaUpload(uploadId);
  },
  startReply(message) {
    set({
      composerTarget: {
        mode: "reply",
        messageId: message.id,
        preview: message.body,
      },
    });
  },
  startEdit(message) {
    set({
      composerTarget: {
        mode: "edit",
        messageId: message.id,
        preview: message.body,
      },
    });
  },
  cancelComposerTarget() {
    set({ composerTarget: null });
  },
  async deleteMessage(messageId, scope) {
    const chatId = get().activeChatId;
    if (!chatId) return;
    await window.telo.workspace.deleteMessage({ chatId, messageId, scope });
    set((state) => removeMessagesLocally(state, chatId, new Set([messageId])));
  },
  async toggleReaction(messageId, emoji) {
    const chatId = get().activeChatId;
    if (!chatId) return;
    const target = get().messages.find((message) => message.id === messageId);
    if (!target) return;
    const toggled = toggleReactionBuckets(target.reactions, emoji);
    // Optimistic like setArchived: the chip flips under the cursor and a
    // failed IPC puts the buckets the message arrived with back, so the
    // caller can surface the failure over truthful counts.
    set((state) => ({
      messages: patchReactions(state.messages, messageId, toggled.reactions),
    }));
    try {
      await window.telo.workspace.setMessageReaction({
        chatId,
        messageId,
        emoji: toggled.emoji,
      });
    } catch (error) {
      set((state) => ({
        messages: patchReactions(state.messages, messageId, target.reactions),
      }));
      throw error;
    }
  },
  startSelection(messageId) {
    set({ selectedMessageIds: [messageId] });
  },
  toggleSelection(messageId) {
    set((state) => ({
      selectedMessageIds: state.selectedMessageIds.includes(messageId)
        ? state.selectedMessageIds.filter((id) => id !== messageId)
        : [...state.selectedMessageIds, messageId],
    }));
  },
  exitSelection() {
    set({ selectedMessageIds: [] });
  },
  async deleteSelectedMessages(scope) {
    const chatId = get().activeChatId;
    const ids = get().selectedMessageIds;
    if (!chatId || ids.length === 0) return;
    // Sequential on purpose: the contract deletes one message per call, and
    // a parallel burst would trip Telegram's flood waits on big selections.
    for (const messageId of ids) {
      await window.telo.workspace.deleteMessage({ chatId, messageId, scope });
    }
    set((state) => ({
      ...removeMessagesLocally(state, chatId, new Set(ids)),
      selectedMessageIds: [],
    }));
  },
  async forwardSelectedMessages(toChatId) {
    const chatId = get().activeChatId;
    const ids = get().selectedMessageIds;
    if (!chatId || ids.length === 0) return;
    for (const messageId of ids) {
      await window.telo.workspace.forwardMessage({
        fromChatId: chatId,
        messageId,
        toChatId,
      });
    }
    await reloadChatsAfterForward(chatId, toChatId);
    set({ selectedMessageIds: [] });
  },
  async forwardMessage(messageId, toChatId, options) {
    const chatId = get().activeChatId;
    if (!chatId) return;
    await window.telo.workspace.forwardMessage({
      fromChatId: chatId,
      messageId,
      toChatId,
      hideSender: options?.hideSender,
    });
    await reloadChatsAfterForward(chatId, toChatId);
  },
  async togglePin(chatId) {
    const chat = get().chats.find((entry) => entry.id === chatId);
    if (!chat) return;
    const pinned = !chat.pinned;
    await window.telo.workspace.setChatPinned(chatId, pinned);
    set((state) => {
      const patched = patchChat(state.chats, chatId, { pinned }).chats;
      if (chatsHaveListOrder(patched)) {
        return { chats: patched };
      }
      const { chats, moved } = relocateChat(patched, chatId, "pin");
      return {
        chats,
        animateChatIds: moved ? [chatId] : [],
      };
    });
  },
  async toggleMute(chatId) {
    const chat = get().chats.find((entry) => entry.id === chatId);
    if (!chat) return;
    const muted = !chat.muted;
    await window.telo.workspace.setChatMuted(chatId, muted);
    set((state) => patchChat(state.chats, chatId, { muted }));
  },
  async toggleRead(chatId) {
    const chat = get().chats.find((entry) => entry.id === chatId);
    if (!chat) return;
    const read = chat.unreadCount > 0;
    await window.telo.workspace.setChatRead(chatId, read);
    set((state) =>
      patchChat(state.chats, chatId, { unreadCount: read ? 0 : 1 }),
    );
  },
  async setArchived(chatId, archived) {
    const chat = get().chats.find((entry) => entry.id === chatId);
    if (!chat) return;
    const folderId = archived ? ARCHIVE_FOLDER_ID : null;
    // Optimistic like togglePin, but the Archive tab appears and disappears
    // with its last chat, so the folder list is recomputed alongside the
    // chat patch; a failed IPC restores both to how they were.
    const previousFolderId = chat.folderId ?? null;
    set((state) => archivedChatPatch(state, chatId, folderId));
    try {
      await window.telo.workspace.setChatArchived(chatId, archived);
    } catch (error) {
      set((state) => archivedChatPatch(state, chatId, previousFolderId));
      throw error;
    }
  },
  setDraft(chatId, text) {
    set((state) => ({ drafts: { ...state.drafts, [chatId]: text } }));
    scheduleDraftSave(chatId, text);
    signalTyping(chatId, text.trim().length > 0);
  },
  async runMessageAction(message, kind, tone) {
    const chatId = get().activeChatId;
    // One action at a time: the menu entries are disabled while streaming,
    // and a stale second call (e.g. keyboard re-trigger) is ignored.
    if (!chatId || get().messageAction) return;
    set({
      messageAction: { messageId: message.id, kind, tone: tone ?? null },
      messageActionError: null,
    });
    // Draft-reply suggests an answer below whatever the user already typed;
    // translate/rewrite replace the draft with the transformed text.
    const existing = kind === "draft-reply" ? (get().drafts[chatId] ?? "") : "";
    const prefix = existing ? `${existing}\n` : "";
    let streamed = "";
    const finish = () => {
      unsubscribe();
      set({ messageAction: null, draftStream: null });
    };
    // Deltas arrive as CUSTOM AG-UI events on the shared agent channel; the
    // listener lives only for the run's duration. Draft writes go through
    // setDraft, so the server-side save stays debounced. Cleanup happens on
    // the terminal `done` event, not on the invoke resolving: the response
    // can overtake queued event messages and would cut the listener off
    // mid-stream (the catch below covers a run that never streamed).
    const unsubscribe = window.telo.agent.onEvent((event: AGUIEvent) => {
      if (
        event.type !== EventType.CUSTOM ||
        event.name !== MESSAGE_ACTION_EVENT_NAME
      ) {
        return;
      }
      const output = event.value as MessageAgentActionOutput;
      if (output.type === "text") {
        streamed += output.delta;
        const text = prefix + streamed;
        get().setDraft(chatId, text);
        set({ draftStream: { chatId, text } });
      } else if (output.type === "error") {
        set({ messageActionError: output.message });
      } else if (output.type === "done") {
        finish();
      }
    });
    try {
      await window.telo.agent.run({
        threadId: MESSAGE_ACTION_THREAD_ID,
        prompt: message.body,
        context: buildWorkspaceContext(),
        scope: {
          scope: "selected",
          chatId,
          messageIds: [message.id],
        },
        action: tone ? { kind, tone } : { kind },
      });
    } catch (error) {
      set({ messageActionError: errorMessage(error) });
      finish();
    }
  },
  setScrollPosition(chatId, top) {
    set((state) => ({
      scrollPositions: { ...state.scrollPositions, [chatId]: top },
    }));
  },
  selectFolder(folderId) {
    if (folderId === get().activeFolderId) return;
    set({ activeFolderId: folderId });
  },
  async createKeywordFolder(title, query) {
    await window.telo.workspace.createKeywordFolder({ title, query });
    await reloadKeywordFolders();
  },
  async updateKeywordFolder(id, title, query) {
    await window.telo.workspace.updateKeywordFolder({ id, title, query });
    await reloadKeywordFolders();
  },
  async deleteKeywordFolder(id) {
    await window.telo.workspace.deleteKeywordFolder(id);
    const { activeFolderId } = get();
    if (activeFolderId === id) set({ activeFolderId: null });
    await reloadKeywordFolders();
  },
  setSearchQuery(query) {
    set({ searchQuery: query });
    if (globalSearchTimer) {
      clearTimeout(globalSearchTimer);
      globalSearchTimer = null;
    }
    const term = query.trim();
    if (!term) {
      // Clearing the field restores the plain chat list immediately.
      globalSearchRequest += 1;
      set({ globalSearchResults: null, globalSearching: false });
      return;
    }
    set({ globalSearching: true });
    globalSearchTimer = setTimeout(() => {
      globalSearchTimer = null;
      void runGlobalSearch(term);
    }, SEARCH_DEBOUNCE_MS);
  },
  async requestJumpToMessage(chatId, messageId) {
    if (chatId !== get().activeChatId) {
      await get().select(chatId);
    }
    if (get().activeChatId !== chatId) return;
    set({ jumpTarget: { chatId, messageId, requestId: ++jumpRequest } });
  },
  clearJumpTarget() {
    set({ jumpTarget: null });
  },
  setHighlightedMessage(messageId) {
    set({ highlightedMessageId: messageId });
  },
  openChatSearch() {
    resetChatSearch();
    set({
      chatSearch: { ...CLOSED_CHAT_SEARCH, open: true },
      highlightedMessageId: null,
    });
  },
  closeChatSearch() {
    resetChatSearch();
    set({ chatSearch: CLOSED_CHAT_SEARCH, highlightedMessageId: null });
  },
  setChatSearchQuery(query) {
    set((state) => ({ chatSearch: { ...state.chatSearch, query } }));
    if (chatSearchTimer) {
      clearTimeout(chatSearchTimer);
      chatSearchTimer = null;
    }
    const chatId = get().activeChatId;
    const term = query.trim();
    if (!term || !chatId) {
      chatSearchRequest += 1;
      set((state) => ({
        chatSearch: {
          ...state.chatSearch,
          matches: [],
          totalCount: 0,
          index: 0,
          cursor: null,
          loading: false,
        },
        highlightedMessageId: null,
      }));
      return;
    }
    chatSearchTimer = setTimeout(() => {
      chatSearchTimer = null;
      void runChatSearch(chatId, term);
    }, SEARCH_DEBOUNCE_MS);
  },
  async chatSearchOlder() {
    const { chatSearch, activeChatId } = get();
    if (!chatSearch.open || chatSearch.loading || !activeChatId) return;
    if (chatSearch.index + 1 >= chatSearch.matches.length) {
      if (!chatSearch.cursor) return;
      // The user paged past the loaded matches: fetch the next (older)
      // server page and append it before advancing.
      const request = ++chatSearchRequest;
      set((state) => ({
        chatSearch: { ...state.chatSearch, loading: true },
      }));
      try {
        const page = await window.telo.workspace.searchMessages(
          activeChatId,
          chatSearch.query.trim(),
          { beforeMessageId: chatSearch.cursor },
        );
        if (request !== chatSearchRequest) return;
        set((state) => ({
          chatSearch: {
            ...state.chatSearch,
            matches: [...state.chatSearch.matches, ...page.messageIds],
            cursor: page.nextCursor,
            loading: false,
          },
        }));
      } catch {
        if (request === chatSearchRequest) {
          set((state) => ({
            chatSearch: { ...state.chatSearch, loading: false },
          }));
        }
        return;
      }
    }
    const current = get().chatSearch;
    const index = current.index + 1;
    const match = current.matches[index];
    if (!match) return;
    set((state) => ({ chatSearch: { ...state.chatSearch, index } }));
    set({
      jumpTarget: {
        chatId: activeChatId,
        messageId: match,
        requestId: ++jumpRequest,
      },
    });
  },
  chatSearchNewer() {
    const { chatSearch, activeChatId } = get();
    if (!chatSearch.open || chatSearch.loading || !activeChatId) return;
    if (chatSearch.index === 0) return;
    const index = chatSearch.index - 1;
    const match = chatSearch.matches[index];
    if (!match) return;
    set((state) => ({ chatSearch: { ...state.chatSearch, index } }));
    set({
      jumpTarget: {
        chatId: activeChatId,
        messageId: match,
        requestId: ++jumpRequest,
      },
    });
  },
  receive(event) {
    if (event.type === "sticker-catalog-changed") {
      const hadCatalog =
        get().stickerSets !== null || get().stickerSetsError !== null;
      set({
        stickerSets: null,
        recentStickers: [],
        favoriteStickers: [],
        stickerSetsError: null,
      });
      if (hadCatalog) void get().loadStickerSets();
      return;
    }
    if (event.type === "media-download") {
      set((state) => ({
        mediaDownloads: {
          ...state.mediaDownloads,
          [event.mediaId]: {
            state: event.state,
            downloadedBytes: event.downloadedBytes,
            totalBytes: event.totalBytes,
            url: event.url,
            error: event.error,
          },
        },
      }));
      return;
    }
    if (event.type === "media-upload") {
      set((state) => ({
        mediaUploads: {
          ...state.mediaUploads,
          [event.uploadId]: {
            state: event.state,
            progress: event.progress,
            error: event.error,
          },
        },
      }));
      return;
    }
    if (event.type === "connection-state") {
      set({ connectionState: event.state });
      return;
    }
    if (event.type === "chats") {
      set((state) => {
        // A full dialog page can omit Saved Messages (it is often not in the
        // first 200). Keep a chat we opened via createPrivateChat.
        const retainedSaved = state.chats.filter(
          (chat) =>
            chat.kind === "saved" &&
            !event.chats.some((entry) => entry.id === chat.id),
        );
        const chats = orderChatsByListOrder([...retainedSaved, ...event.chats]);
        return {
          chats,
          chatCursor: event.nextCursor,
          drafts: hydrateDrafts(state.drafts, chats),
          folders: withKeywordUnread(
            state.folders,
            chats,
            state.countMutedChats,
          ),
        };
      });
      return;
    }
    if (event.type === "folders") {
      set((state) => ({
        folders: withKeywordUnread(
          event.folders,
          state.chats,
          state.countMutedChats,
        ),
      }));
      return;
    }
    if (event.type === "sync-error") {
      // Catch-up and update-queue failures stay in the main-process log.
      // The conversation header has no error strip.
      return;
    }
    if (event.type === "chat-upsert") {
      set((state) => {
        const previousIndex = state.chats.findIndex(
          (chat) => chat.id === event.chat.id,
        );
        const chats = upsertChat(state.chats, event.chat);
        const nextIndex = chats.findIndex((chat) => chat.id === event.chat.id);
        const moved =
          previousIndex !== -1 &&
          nextIndex !== -1 &&
          previousIndex !== nextIndex;
        return {
          chats,
          folders: withKeywordUnread(
            state.folders,
            chats,
            state.countMutedChats,
          ),
          drafts: hydrateDrafts(state.drafts, [event.chat]),
          animateChatIds: moved
            ? withIds(state.animateChatIds, [event.chat.id])
            : state.animateChatIds,
        };
      });
      return;
    }
    if (event.type === "chat-avatar") {
      set((state) => ({
        ...patchChat(state.chats, event.chatId, {
          avatarDataUrl: event.avatarDataUrl,
          avatarPending: false,
        }),
        // The event is keyed by a peer id, so it settles message authors that
        // are not dialogs of their own — group members and channel posters.
        peerAvatars: {
          ...state.peerAvatars,
          [event.chatId]: event.avatarDataUrl,
        },
      }));
      return;
    }
    if (event.type === "message-upsert") {
      set((state) => {
        const isActive = state.activeChatId === event.message.chatId;
        const chat = state.chats.find((c) => c.id === event.message.chatId);
        const existing = state.messages.some(
          (message) => message.id === event.message.id,
        );
        const incomingNew =
          event.cause === "new" && !event.message.outgoing && !existing;
        if (incomingNew && !isActive && chat) {
          notifyIncomingMessage(state, chat, event.message);
        }
        const chats = state.chats.map((c) => {
          if (c.id !== event.message.chatId) return c;
          const next = {
            ...c,
            preview: event.message.body,
            updatedAt: event.message.sentAt,
            unreadCount:
              incomingNew && !isActive ? c.unreadCount + 1 : c.unreadCount,
          };
          return assignKeywordMembership(
            next,
            state.folders,
            event.message.body,
          );
        });
        const promoted =
          event.cause === "new" && !chatsHaveListOrder(chats)
            ? relocateChat(chats, event.message.chatId, "new-message")
            : { chats, moved: false };
        return {
          messages: isActive
            ? upsertMessage(state.messages, event.message)
            : state.messages,
          chats: promoted.chats,
          folders: withKeywordUnread(
            state.folders,
            promoted.chats,
            state.countMutedChats,
          ),
          animateInMessageIds:
            isActive && !existing && event.cause === "new"
              ? withIds(state.animateInMessageIds, [event.message.id])
              : state.animateInMessageIds,
          animateChatIds: promoted.moved ? [event.message.chatId] : [],
        };
      });
      return;
    }
    if (event.type === "message-delete") {
      set((state) => {
        if (state.activeChatId !== event.chatId) return state;
        const deleted = new Set(event.messageIds);
        const messages = state.messages.filter(
          (message) => !deleted.has(message.id),
        );
        return {
          messages,
          chats: state.chats.map((chat) =>
            chat.id === event.chatId
              ? { ...chat, preview: messages.at(-1)?.body ?? "" }
              : chat,
          ),
          composerTarget:
            state.composerTarget && deleted.has(state.composerTarget.messageId)
              ? null
              : state.composerTarget,
          // A remote delete (or our own delete-for-everyone echo) also drops
          // the message from any pending multi-selection.
          selectedMessageIds: state.selectedMessageIds.filter(
            (id) => !deleted.has(id),
          ),
        };
      });
      return;
    }
    if (event.type === "typing") {
      set((state) => ({
        chats: state.chats.map((chat) =>
          chat.id === event.chatId ? { ...chat, typing: event.typing } : chat,
        ),
      }));
      return;
    }
    if (event.type === "draft") {
      set((state) => ({
        chats: state.chats.map((chat) =>
          chat.id === event.chatId
            ? { ...chat, draftPreview: event.draftPreview }
            : chat,
        ),
        // The active chat's draft is whatever the local composer has: a
        // remote echo of our own saveDraft call must not clobber a keystroke
        // typed after that call was sent.
        drafts:
          state.activeChatId === event.chatId
            ? state.drafts
            : { ...state.drafts, [event.chatId]: event.draftPreview ?? "" },
      }));
      return;
    }
    if (event.type === "chat-mute") {
      set((state) =>
        patchChat(state.chats, event.chatId, { muted: event.muted }),
      );
      return;
    }
    if (event.type === "chat-pin") {
      set((state) => {
        const patched = patchChat(state.chats, event.chatId, {
          pinned: event.pinned,
        }).chats;
        if (chatsHaveListOrder(patched)) {
          return { chats: patched };
        }
        const { chats, moved } = relocateChat(patched, event.chatId, "pin");
        return {
          chats,
          animateChatIds: moved ? [event.chatId] : [],
        };
      });
      return;
    }
    if (event.type === "chat-presence") {
      set((state) =>
        patchChat(state.chats, event.chatId, {
          presence: event.online ? "online" : null,
        }),
      );
      return;
    }
    if (event.type === "message-reactions") {
      // Only the open transcript holds messages, so a bucket update for any
      // other chat has nothing to patch — the same rule message-upsert
      // follows for its transcript half.
      set((state) =>
        state.activeChatId === event.chatId
          ? {
              messages: patchReactions(
                state.messages,
                event.messageId,
                event.reactions,
              ),
            }
          : state,
      );
      return;
    }
    if (event.type === "message-read") {
      set((state) => ({
        chats:
          event.direction === "inbox"
            ? state.chats.map((chat) =>
                chat.id === event.chatId ? { ...chat, unreadCount: 0 } : chat,
              )
            : state.chats,
        messages:
          event.direction === "outbox" && state.activeChatId === event.chatId
            ? state.messages.map((message) =>
                message.outgoing &&
                compareTelegramIds(message.id, event.maxMessageId) <= 0
                  ? { ...message, status: "read" as const }
                  : message,
              )
            : state.messages,
      }));
    }
  },
}));

export function subscribeToWorkspaceEvents(): () => void {
  return window.telo.workspace.onEvent((event) =>
    useChatStore.getState().receive(event),
  );
}

// The workspace snapshot handed to every agent run. Lives next to the store
// it reads so the agent panel and the message actions share one definition.
export function buildWorkspaceContext(): UiContextSnapshot {
  const { chats, messages, activeChatId } = useChatStore.getState();
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  return {
    activeChat: activeChat
      ? { id: activeChat.id, title: activeChat.title, kind: activeChat.kind }
      : null,
    visibleChats: chats.map(({ id, title, unreadCount }) => ({
      id,
      title,
      unreadCount,
    })),
    visibleMessages: messages.map(({ senderName, body, sentAt, outgoing }) => ({
      senderName,
      body,
      sentAt,
      outgoing,
    })),
    components: [
      {
        id: "conversation-sidebar",
        role: "chat-navigation",
        state: { count: chats.length },
      },
      {
        id: "conversation-view",
        role: "message-transcript",
        state: { chatId: activeChatId, messageCount: messages.length },
      },
      { id: "global-agent-panel", role: "assistant", state: { visible: true } },
    ],
  };
}

// Cancels the in-chat search debounce and invalidates in-flight searches;
// callers reset the visible state separately. Used when the conversation
// changes (select) or the search bar opens/closes.
function resetChatSearch(): void {
  if (chatSearchTimer) {
    clearTimeout(chatSearchTimer);
    chatSearchTimer = null;
  }
  chatSearchRequest += 1;
}

async function runGlobalSearch(term: string): Promise<void> {
  const request = ++globalSearchRequest;
  try {
    const results = await window.telo.workspace.searchGlobal(term);
    if (request === globalSearchRequest) {
      useChatStore.setState({
        globalSearchResults: results,
        globalSearching: false,
      });
    }
  } catch {
    if (request === globalSearchRequest) {
      // Search owns its empty state in the sidebar. A failed query must
      // not raise the conversation-header banner.
      useChatStore.setState({
        globalSearchResults: { chats: [], messages: [] },
        globalSearching: false,
      });
    }
  }
}

async function runChatSearch(chatId: string, term: string): Promise<void> {
  const request = ++chatSearchRequest;
  useChatStore.setState((state) => ({
    chatSearch: { ...state.chatSearch, loading: true },
  }));
  try {
    const page = await window.telo.workspace.searchMessages(chatId, term);
    if (request !== chatSearchRequest) return;
    useChatStore.setState((state) => ({
      chatSearch: {
        ...state.chatSearch,
        matches: page.messageIds,
        totalCount: page.totalCount,
        index: 0,
        cursor: page.nextCursor,
        loading: false,
      },
    }));
    // Telegram jumps straight to the most recent match once results land.
    const first = page.messageIds[0];
    if (first) {
      useChatStore.setState({
        jumpTarget: { chatId, messageId: first, requestId: ++jumpRequest },
      });
    }
  } catch {
    if (request !== chatSearchRequest) return;
    useChatStore.setState((state) => ({
      chatSearch: { ...state.chatSearch, loading: false },
    }));
  }
}

function chatsHaveListOrder(chats: ReadonlyArray<ChatDto>): boolean {
  return chats.some((chat) => chat.listOrder !== undefined);
}

// TDLib position.order is an unsigned 64-bit decimal string. Higher values
// sort first, matching Telegram Desktop's main list.
function compareTelegramListOrder(left: string, right: string): number {
  if (left.length !== right.length) return right.length - left.length;
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

function orderChatsByListOrder(
  chats: ReadonlyArray<ChatDto>,
): ReadonlyArray<ChatDto> {
  if (!chatsHaveListOrder(chats)) return chats;
  return [...chats].sort((left, right) =>
    compareTelegramListOrder(left.listOrder ?? "0", right.listOrder ?? "0"),
  );
}

function patchChat(
  chats: ReadonlyArray<ChatDto>,
  chatId: string,
  patch: Partial<ChatDto>,
): Pick<ChatState, "chats"> {
  return {
    chats: chats.map((chat) =>
      chat.id === chatId ? { ...chat, ...patch } : chat,
    ),
  };
}

function withIds(
  current: ReadonlyArray<string> | undefined,
  add: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const base = current ?? [];
  if (add.length === 0) return base;
  const seen = new Set(base);
  const extra = add.filter((id) => !seen.has(id));
  return extra.length === 0 ? base : [...base, ...extra];
}

// Pin moves the chat to the front of the pinned group; a new message bumps
// an unpinned chat to the first unpinned slot. Pinned chats keep pin order
// on new messages. The sidebar may fade the moved row; nothing here starts
// a layout spring.
function relocateChat(
  chats: ReadonlyArray<ChatDto>,
  chatId: string,
  reason: "pin" | "new-message",
): { chats: ReadonlyArray<ChatDto>; moved: boolean } {
  const index = chats.findIndex((chat) => chat.id === chatId);
  if (index === -1) return { chats, moved: false };
  const chat = chats[index];
  if (reason === "new-message" && chat.pinned) {
    return { chats, moved: false };
  }
  const without = chats.filter((entry) => entry.id !== chatId);
  const insertAt = chat.pinned
    ? 0
    : (() => {
        const firstUnpinned = without.findIndex((entry) => !entry.pinned);
        return firstUnpinned === -1 ? without.length : firstUnpinned;
      })();
  if (index === insertAt) return { chats, moved: false };
  const next = [...without];
  next.splice(insertAt, 0, chat);
  return { chats: next, moved: true };
}

// Local mirror of a server-side delete: drops the messages and, when the
// transcript tail went away, patches the chat list preview to the new tail.
// A composer reply/edit aimed at a removed message is cancelled.
function removeMessagesLocally(
  state: Pick<ChatState, "messages" | "chats" | "composerTarget">,
  chatId: string,
  removed: ReadonlySet<string>,
): Pick<ChatState, "messages" | "composerTarget"> &
  Partial<Pick<ChatState, "chats">> {
  const messages = state.messages.filter((message) => !removed.has(message.id));
  const last = state.messages[state.messages.length - 1];
  const removedLast = last !== undefined && removed.has(last.id);
  return {
    messages,
    ...(removedLast
      ? patchChat(state.chats, chatId, {
          preview: messages[messages.length - 1]?.body ?? "",
        })
      : {}),
    composerTarget:
      state.composerTarget && removed.has(state.composerTarget.messageId)
        ? null
        : state.composerTarget,
  };
}

// Previews and unread counts shift in both chats after a forward; the
// backend owns those rules, so the list is reloaded instead of patched.
async function reloadChatsAfterForward(
  chatId: string,
  toChatId: string,
): Promise<void> {
  const chatPage = await window.telo.workspace.listChatPage();
  const messagePage =
    toChatId === chatId
      ? await window.telo.workspace.listMessagePage(chatId)
      : null;
  useChatStore.setState({
    chats: chatPage.items,
    chatCursor: chatPage.nextCursor,
    messages: messagePage?.items ?? useChatStore.getState().messages,
    messageCursor:
      messagePage?.nextCursor ?? useChatStore.getState().messageCursor,
  });
}

function upsertChat(
  chats: ReadonlyArray<ChatDto>,
  updated: ChatDto,
): ReadonlyArray<ChatDto> {
  const index = chats.findIndex((chat) => chat.id === updated.id);
  const next =
    index === -1
      ? [...chats, updated]
      : chats.map((chat) => (chat.id === updated.id ? updated : chat));
  return orderChatsByListOrder(next);
}

function mergeChats(
  current: ReadonlyArray<ChatDto>,
  incoming: ReadonlyArray<ChatDto>,
): ReadonlyArray<ChatDto> {
  return incoming.reduce(upsertChat, current);
}

async function reloadKeywordFolders(): Promise<void> {
  const [folders, chatPage] = await Promise.all([
    window.telo.workspace.listFolders(),
    window.telo.workspace.listChatPage(),
  ]);
  useChatStore.setState((state) => {
    const chats = mergeChats(state.chats, chatPage.items);
    return {
      folders: withKeywordUnread(folders, chats, state.countMutedChats),
      chats,
    };
  });
}

function upsertMessage(
  messages: ReadonlyArray<MessageDto>,
  updated: MessageDto,
): ReadonlyArray<MessageDto> {
  const byId = messages.findIndex((message) => message.id === updated.id);
  if (byId >= 0) {
    const next = messages.map((message) =>
      message.id === updated.id ? updated : message,
    );
    return [...next].sort((left, right) =>
      left.sentAt.localeCompare(right.sentAt),
    );
  }
  // Optimistic text/sticker bubbles use the clientId as their id. Replace
  // that placeholder when the server (or a temp TDLib id) arrives. Album
  // placeholders share a clientId but keep distinct ids, so they must not
  // collapse into one row.
  const optimisticIndex =
    updated.clientId && updated.id !== updated.clientId
      ? messages.findIndex((message) => message.id === updated.clientId)
      : -1;
  const next =
    optimisticIndex >= 0
      ? messages.map((message, index) =>
          index === optimisticIndex ? updated : message,
        )
      : [...messages, updated];
  return [...next].sort((left, right) =>
    left.sentAt.localeCompare(right.sentAt),
  );
}

function mergeMessages(
  current: ReadonlyArray<MessageDto>,
  incoming: ReadonlyArray<MessageDto>,
): ReadonlyArray<MessageDto> {
  return incoming.reduce(upsertMessage, current);
}

function compareTelegramIds(left: string, right: string): number {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

// Media-card and composer-action details. Language-level and disconnected
// transport prose belong in the main-process log, not on those surfaces.
function errorMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (
    isTechnicalErrorMessage(message) ||
    isInternalExceptionMessage(message) ||
    isTransportFailureMessage(message)
  )
    return null;
  return message;
}

function isInternalExceptionMessage(message: string): boolean {
  return /is not callable|is not a function|instanceof|Cannot read propert/i.test(
    message,
  );
}

function isTransportFailureMessage(message: string): boolean {
  return /cannot send requests while disconnected/i.test(message);
}
