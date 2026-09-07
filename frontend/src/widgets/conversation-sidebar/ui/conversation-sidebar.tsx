import {
  Archive,
  Bell,
  BellSlash,
  Checks,
  ArrowLeft,
  Lock,
  PushPin,
  PushPinSlash,
  X,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";

import type {
  ChatDto,
  MessageDto,
  TimeFormatPreference,
} from "../../../../../contracts/src/ipc";
import { ARCHIVE_FOLDER_ID } from "../../../../../contracts/src/ipc";
import {
  chatsForFolder,
  displayChatTitle,
  folderUnread,
  useChatStore,
} from "entities/chat";
import { useRecentSearches, useTimeFormat } from "entities/preferences";
import { AccountMenu } from "features/account-menu";
import { ChatSearch } from "features/chat-search";
import {
  pushRecentSearch,
  removeRecentSearch,
} from "features/chat-search/model/recent-searches";
import { StartSecretChatMenuItem } from "features/start-secret-chat";
import { AnimatePresence } from "motion/react";

import { copy } from "shared/config/copy";
import { useEdgeSentinel } from "shared/lib/use-edge-sentinel";
import { scrollFadeMask, useScrollFade } from "shared/lib/use-scroll-fade";

import {
  Avatar,
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  LoadIndicator,
  MessageTyping,
  Skeleton,
  SkeletonGroup,
  WindowControls,
} from "shared/ui";

// "system" defers to the locale's hour12 default, while 12h/24h pin it
// explicitly.
function shortTime(value: string, format: TimeFormatPreference): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(format === "system" ? {} : { hour12: format === "12h" }),
  }).format(new Date(value));
}

interface ConversationSidebarProps {
  onOpenSettings(): void;
  onSelectChat(): void;
}

// Folder tabs are high-frequency navigation: no springs, no press scale, at
// most a color transition (Tailwind's default 150ms), like the chat rows.
interface FolderTabProps {
  readonly label: string;
  readonly selected: boolean;
  readonly unread: number;
  onSelect(): void;
}

function FolderTab({ label, selected, unread, onSelect }: FolderTabProps) {
  return (
    <Button
      variant="ghost"
      pressScale={1}
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`shrink-0 gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
        selected ? "bg-accent text-foreground" : "text-muted-foreground"
      }`}
    >
      {label}
      {unread ? (
        <>
          {" "}
          <span
            aria-label={`${unread} ${copy.unread}`}
            className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-caption font-semibold text-primary-foreground tabular-nums"
          >
            {unread}
          </span>
        </>
      ) : null}
    </Button>
  );
}

function ChatTypingIndicator({ className }: { className?: string }) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    return <span className={className}>{copy.typing}</span>;
  }
  return <MessageTyping label={copy.typing} className={className} />;
}

interface ChatListRowProps {
  readonly chat: ChatDto;
  readonly active: boolean;
  readonly timeFormat: TimeFormatPreference;
  readonly promoted?: boolean;
  onSelect(): void;
}

// One chat row, shared by the plain list and the server search results.
function ChatListRow({
  chat,
  active,
  timeFormat,
  promoted = false,
  onSelect,
}: ChatListRowProps) {
  const togglePin = useChatStore((state) => state.togglePin);
  const toggleMute = useChatStore((state) => state.toggleMute);
  const toggleRead = useChatStore((state) => state.toggleRead);
  const setArchived = useChatStore((state) => state.setArchived);
  const archived = chat.folderId === ARCHIVE_FOLDER_ID;

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Button
          variant="ghost"
          // Navigation target: pressed dozens of times a session, so it stays
          // motion-free and signals state through colour alone.
          pressScale={1}
          onClick={onSelect}
          aria-current={active ? "page" : undefined}
          data-promote={promoted ? "true" : undefined}
          /* deslop-ignore-next-line 21 — compact chat-row radius is a messaging convention */
          className={`mb-0.5 h-auto w-full justify-start gap-2.5 rounded-xl px-2.5 py-2 text-left ${
            active ? "bg-accent text-foreground" : ""
          }`}
        >
          <Avatar
            src={chat.avatarDataUrl}
            pending={chat.avatarPending}
            mark={chat.kind === "saved" ? "saved" : undefined}
            placeholder={chat.avatarPlaceholder}
            className="size-12"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              {chat.kind === "secret" ? (
                <Lock
                  aria-label={copy.secretChat}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate text-sm leading-5 font-semibold">
                {displayChatTitle(chat)}
              </span>
              <time className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                {shortTime(chat.updatedAt, timeFormat)}
              </time>
            </span>
            <span className="mt-px flex items-center gap-1.5 text-callout font-normal text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">
                {chat.typing ? (
                  <ChatTypingIndicator className="text-primary" />
                ) : chat.draftPreview ? (
                  <span>
                    <span className="text-destructive">{copy.draftPrefix}</span>{" "}
                    {chat.draftPreview}
                  </span>
                ) : (
                  chat.preview
                )}
              </span>
              {chat.muted ? <BellSlash aria-label={copy.muted} /> : null}
              {chat.unreadCount ? (
                <span
                  aria-label={`${chat.unreadCount} ${copy.unread}`}
                  /* deslop-ignore-next-line 19 */
                  className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-caption font-semibold text-primary-foreground tabular-nums"
                >
                  {chat.unreadCount}
                </span>
              ) : null}
            </span>
          </span>
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent ariaLabel={copy.chatActions}>
        <ContextMenuItem onSelect={() => void toggleRead(chat.id)}>
          <Checks aria-hidden="true" className="size-4" />
          {chat.unreadCount > 0 ? copy.markAsRead : copy.markAsUnread}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void togglePin(chat.id)}>
          {chat.pinned ? (
            <PushPinSlash aria-hidden="true" className="size-4" />
          ) : (
            <PushPin aria-hidden="true" className="size-4" />
          )}
          {chat.pinned ? copy.unpinChat : copy.pinChat}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void toggleMute(chat.id)}>
          {chat.muted ? (
            <Bell aria-hidden="true" className="size-4" />
          ) : (
            <BellSlash aria-hidden="true" className="size-4" />
          )}
          {chat.muted ? copy.unmuteChat : copy.muteChat}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void setArchived(chat.id, !archived)}>
          <Archive aria-hidden="true" className="size-4" />
          {archived ? copy.unarchiveChat : copy.archiveChat}
        </ContextMenuItem>
        {chat.kind === "direct" ? (
          <StartSecretChatMenuItem userId={chat.id} />
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface MessageSearchResultRowProps {
  readonly message: MessageDto;
  /** The result's chat when known (loaded list or search chats section). */
  readonly chat: ChatDto | null;
  readonly timeFormat: TimeFormatPreference;
  onSelect(): void;
}

function MessageSearchResultRow({
  message,
  chat,
  timeFormat,
  onSelect,
}: MessageSearchResultRowProps) {
  return (
    <Button
      variant="ghost"
      pressScale={1}
      onClick={onSelect}
      /* deslop-ignore-next-line 21 — matches the chat-row shape above */
      className="mb-0.5 h-auto w-full justify-start gap-2.5 rounded-xl px-2.5 py-2 text-left"
    >
      <Avatar
        src={chat?.avatarDataUrl ?? null}
        pending={chat?.avatarPending}
        mark={chat?.kind === "saved" ? "saved" : undefined}
        placeholder={chat?.avatarPlaceholder}
        className="size-12"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm leading-5 font-semibold">
            {message.senderName}
          </span>
          <time className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
            {shortTime(message.sentAt, timeFormat)}
          </time>
        </span>
        <span className="mt-px block truncate text-callout font-normal text-muted-foreground">
          {message.body}
        </span>
      </span>
    </Button>
  );
}

/**
 * The search-history surface: the whole list area swaps to recent searches
 * while the field is focused and empty. Both reference clients swap the
 * entire chat list for a search overlay on focus (never a section above the
 * normal list) and hide it again on blur or on the first result opened —
 * this mirrors that, reusing the chat row's geometry so the swap reads as
 * the same surface in a different mode. Focus-and-type is a tens-per-day
 * interaction, so per the animation gate the swap is instant, matching the
 * existing search-results swap.
 */
function SearchHistory({
  chats,
  recentSearches,
  timeFormat,
  onOpen,
  onRemove,
  onClearAll,
}: {
  readonly chats: ReadonlyArray<ChatDto>;
  readonly recentSearches: ReadonlyArray<string>;
  readonly timeFormat: TimeFormatPreference;
  onOpen(chatId: string): void;
  onRemove(chatId: string): void;
  onClearAll(): void;
}) {
  const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
  // A pruned chat (deleted, left) stays out of the history render; it leaves
  // the persisted list on the next push, the way web-k drops deleted peers.
  const entries = recentSearches
    .map((id) => chatsById.get(id) ?? null)
    .filter((chat): chat is ChatDto => chat !== null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {entries.length ? (
        <>
          <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
            <span className="text-xs font-medium text-muted-foreground">
              {copy.recentSearches}
            </span>
            {/* tdesktop's RecentsController puts the same "Clear" link on the
                section header (`dialogs_suggestions.cpp`). */}
            <button
              type="button"
              onClick={onClearAll}
              className="rounded text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {copy.clearSearchHistory}
            </button>
          </div>
          {entries.map((chat) => (
            <RecentSearchRow
              key={chat.id}
              chat={chat}
              timeFormat={timeFormat}
              onSelect={() => onOpen(chat.id)}
              onRemove={() => onRemove(chat.id)}
            />
          ))}
        </>
      ) : (
        <div className="grid h-full place-items-center px-3 text-center text-sm text-muted-foreground">
          {copy.noRecentSearches}
        </div>
      )}
    </div>
  );
}

/**
 * One history entry: the chat row's own shape, with removal through its
 * context menu — tdesktop's per-item removal lives on the right-click menu,
 * not on an inline X.
 */
function RecentSearchRow({
  chat,
  timeFormat,
  onSelect,
  onRemove,
}: {
  readonly chat: ChatDto;
  readonly timeFormat: TimeFormatPreference;
  onSelect(): void;
  onRemove(): void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Button
          variant="ghost"
          pressScale={1}
          onClick={onSelect}
          className="mb-0.5 h-auto w-full justify-start gap-2.5 rounded-xl px-2.5 py-2 text-left"
        >
          <Avatar
            src={chat.avatarDataUrl}
            pending={chat.avatarPending}
            mark={chat.kind === "saved" ? "saved" : undefined}
            placeholder={chat.avatarPlaceholder}
            className="size-12"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm leading-5 font-semibold">
                {displayChatTitle(chat)}
              </span>
              <time className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                {shortTime(chat.updatedAt, timeFormat)}
              </time>
            </span>
            <span className="mt-px block truncate text-callout font-normal text-muted-foreground">
              {chat.preview}
            </span>
          </span>
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent ariaLabel={copy.recentSearches}>
        <ContextMenuItem onSelect={onRemove}>
          <X aria-hidden="true" className="size-4" />
          {copy.removeFromHistory}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The pinned row at the top of the All list that opens the Archive.
 *
 * Telegram Web K's `ArchiveDialog` and tdesktop's `Data::Folder` row share
 * this exact presentation: a blue-gradient disc with the archive glyph, the
 * "Archived Chats" title, a comma-joined preview of the archived names, and
 * an unread badge that is *always the muted grey* even when the archived
 * chats are unmuted — the folder's badge reports muted chats by definition
 * (`data_folder.cpp:385-398`). The row hides itself the moment the archive
 * is empty.
 */
function ArchiveRow({
  archived,
  unread,
  onSelect,
}: {
  readonly archived: ReadonlyArray<ChatDto>;
  readonly unread: number;
  onSelect(): void;
}) {
  return (
    <Button
      variant="ghost"
      // High-frequency navigation: colour only, no spring, same rule the
      // chat rows follow.
      pressScale={1}
      onClick={onSelect}
      aria-label={
        unread > 0
          ? `${copy.archivedChats}, ${unread} ${copy.unread}`
          : copy.archivedChats
      }
      className="mb-0.5 h-auto w-full justify-start gap-2.5 rounded-xl px-2.5 py-2 text-left"
    >
      <span
        aria-hidden="true"
        className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#5CAFFA] to-[#408ACF] text-white"
      >
        <Archive weight="fill" className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm leading-5 font-semibold">
            {copy.archivedChats}
          </span>
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-muted px-1.5 text-caption font-semibold text-muted-foreground tabular-nums"
            >
              {unread}
            </span>
          ) : null}
        </span>
        <span className="mt-px block truncate text-callout font-normal text-muted-foreground">
          {archived
            .slice(0, ARCHIVE_PREVIEW_CHATS)
            .map((chat) => displayChatTitle(chat))
            .join(", ")}
        </span>
      </span>
    </Button>
  );
}

/**
 * Inside the Archive the way out is a back affordance, the same pushed-view
 * shape Telegram Web K's `AppArchivedTab` uses (back button plus the archive
 * title), because the row that brought the reader here is no longer on screen.
 */
function ArchiveBackRow({ onBack }: { onBack(): void }) {
  return (
    <div className="mb-1 flex items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        aria-label={copy.backToAllChats}
        className="size-10"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
      </Button>
      <strong className="text-sm font-semibold">{copy.archivedChats}</strong>
    </div>
  );
}

/**
 * Bar widths per skeleton row. Fixed rather than random: Telegram Web K seeds
 * its own widths from the row index (`loadingDialogSkeleton.tsx:6-11`) exactly
 * so they stay put across re-renders — `Math.random()` in a render makes the
 * bars twitch on every scroll tick.
 */
const CHAT_SKELETON_ROWS = [
  { title: "w-32", preview: "w-44" },
  { title: "w-24", preview: "w-32" },
  { title: "w-36", preview: "w-52" },
  { title: "w-28", preview: "w-40" },
  { title: "w-32", preview: "w-28" },
  { title: "w-24", preview: "w-48" },
  { title: "w-36", preview: "w-36" },
  { title: "w-28", preview: "w-44" },
] as const;

/**
 * How many archived names preview on the Archive row. Telegram Web K caps at
 * ten names of twenty symbols; the sidebar here is a third of that width, so
 * the cap scales down with it — three names is the most that survives the
 * row without truncating the badge away.
 */
const ARCHIVE_PREVIEW_CHATS = 3;

/**
 * The chat list's own geometry while the first page is in flight. A spinner
 * would be the smaller change, but the list is about to be a stack of rows of
 * a known shape, and until now this surface showed the "No chats found" empty
 * state during the very first load — an empty result and a pending one read
 * identically, which is the worse of the two bugs a spinner would leave.
 */
function ChatListSkeleton() {
  return (
    <SkeletonGroup label={copy.loadingChatList}>
      {CHAT_SKELETON_ROWS.map((row, index) => (
        <div
          key={index}
          className="mb-0.5 flex items-center gap-2.5 px-2.5 py-2"
          // Matches ChatListRow: 8px block padding around a 48px avatar.
        >
          <Skeleton circle className="size-12 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className={`h-3.5 ${row.title}`} />
              <Skeleton className="ml-auto h-3 w-8" />
            </div>
            <Skeleton className={`h-3 ${row.preview}`} />
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

export function ConversationSidebar({
  onOpenSettings,
  onSelectChat,
}: ConversationSidebarProps) {
  const chats = useChatStore((state) => state.chats);
  const folders = useChatStore((state) => state.folders);
  const activeFolderId = useChatStore((state) => state.activeFolderId);
  const selectFolder = useChatStore((state) => state.selectFolder);
  const activeChatId = useChatStore((state) => state.activeChatId);
  const select = useChatStore((state) => state.select);
  const chatCursor = useChatStore((state) => state.chatCursor);
  const loadingChatList = useChatStore((state) => state.loading);
  const loadingMoreChats = useChatStore((state) => state.loadingMoreChats);
  const loadMoreChats = useChatStore((state) => state.loadMoreChats);
  const query = useChatStore((state) => state.searchQuery);
  const setSearchQuery = useChatStore((state) => state.setSearchQuery);
  const globalSearchResults = useChatStore(
    (state) => state.globalSearchResults,
  );
  const globalSearching = useChatStore((state) => state.globalSearching);
  const requestJumpToMessage = useChatStore(
    (state) => state.requestJumpToMessage,
  );
  const { value: recentSearches, select: selectRecentSearches } =
    useRecentSearches();
  // Focus drives the history surface: both clients show it the moment the
  // field is focused, even before the first keystroke, and hide it again on
  // blur — except when focus moved into the list itself, so a history row
  // stays clickable instead of vanishing under the pointer.
  const [searchFocused, setSearchFocused] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  // The folder strip is a short horizontal scroller: it never shows a
  // scrollbar (the same rule the agent suggestion pills follow), and a fade
  // mask — not a track — is the only hint that more tabs exist.
  const folderRailRef = useRef<HTMLDivElement>(null);
  const folderEdges = useScrollFade(folderRailRef, "horizontal");
  const folderMask = scrollFadeMask(folderEdges, "horizontal");

  const animateChatIds = useChatStore((state) => state.animateChatIds);
  const connectionState = useChatStore((state) => state.connectionState);
  const { value: timeFormat } = useTimeFormat();

  const searching = query.trim().length > 0;

  // Paging is sentinel-driven: when the list end scrolls into view, the next
  // chat page loads. Server search replaces the list, so paging pauses.
  const endSentinelRef = useEdgeSentinel({
    enabled: Boolean(chatCursor) && !searching && !loadingMoreChats,
    onReach: () => void loadMoreChats(),
  });

  const visible = useMemo(
    () => chatsForFolder(chats, activeFolderId),
    [chats, activeFolderId],
  );

  // Pinned chats surface as a labeled group above the rest, inside whichever
  // folder view is active. The regroup is a plain render — high-frequency
  // navigation stays motion-free.
  const pinnedVisible = useMemo(
    () => visible.filter((chat) => chat.pinned),
    [visible],
  );
  const unpinnedVisible = useMemo(
    () => visible.filter((chat) => !chat.pinned),
    [visible],
  );

  // Muted chats are excluded unless the reader asked for them; the store
  // mirrors that preference from the persisted set.
  const countMutedChats = useChatStore((state) => state.countMutedChats);
  const allUnread = useMemo(
    () => folderUnread(chats, null, countMutedChats),
    [chats, countMutedChats],
  );

  // The Archive row previews the archived list itself: names from the same
  // `folderId` filter the tab view uses, and the folder's own unread total,
  // which the store already computes server-side.
  const archivedVisible = useMemo(
    () => chatsForFolder(chats, ARCHIVE_FOLDER_ID),
    [chats],
  );
  const archiveUnread = useMemo(
    () => folderUnread(chats, ARCHIVE_FOLDER_ID, countMutedChats),
    [chats, countMutedChats],
  );

  // Message results enrich their rows with chat data from whichever list
  // knows the chat: the loaded sidebar chats or the search's chat section.
  const chatsById = useMemo(() => {
    const map = new Map<string, ChatDto>();
    for (const chat of chats) map.set(chat.id, chat);
    for (const chat of globalSearchResults?.chats ?? []) {
      map.set(chat.id, chat);
    }
    return map;
  }, [chats, globalSearchResults]);

  // Focused-but-empty search swaps the whole area under the field — folder
  // tabs included — for the search history, the way both clients swap their
  // chat list for the search overlay. The first keystroke drops back to the
  // searching branch, which is why this is a mode, not a separate surface.
  const historyMode = searchFocused && !searching;

  return (
    <aside
      className="flex h-full min-h-0 min-w-0 flex-col"
      aria-label={copy.chats}
    >
      <header className="window-titlebar-safe flex h-14 items-center gap-2 [app-region:drag]">
        <WindowControls />
        <div className="window-titlebar-safe-content min-w-0 flex-1">
          <strong
            className="truncate text-base font-semibold tracking-title"
            aria-live="polite"
          >
            {connectionState === "offline"
              ? copy.connectionOffline
              : connectionState === "synchronizing"
                ? copy.connectionSynchronizing
                : copy.appName}
          </strong>
        </div>
      </header>
      <div className="px-3 pb-2">
        <ChatSearch
          value={query}
          onChange={setSearchQuery}
          onFocus={() => setSearchFocused(true)}
          onBlur={(event) => {
            // Focus moving into the list — a history row, the tab strip — is
            // the reader continuing to act, not leaving the search, and the
            // history must not vanish under the pointer.
            const next = event.relatedTarget;
            if (
              next instanceof Node &&
              event.currentTarget.closest("aside")?.contains(next)
            ) {
              return;
            }
            setSearchFocused(false);
          }}
        />
      </div>
      {folders.length && !searching && !historyMode ? (
        <div
          role="tablist"
          aria-label={copy.chatFolders}
          ref={folderRailRef}
          style={{
            maskImage: folderMask,
            WebkitMaskImage: folderMask,
          }}
          className="flex items-center gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <FolderTab
            label={copy.allChats}
            selected={activeFolderId === null}
            unread={allUnread}
            onSelect={() => selectFolder(null)}
          />
          {/* The Archive is not a tab: both reference clients strip folder 1
              from the tab strip and reach it through the pinned row at the
              top of the All list (`stores/folders.ts:159`,
              `dialogs.ts:96-120`). The row below owns that navigation. */}
          {folders
            .filter((folder) => folder.id !== ARCHIVE_FOLDER_ID)
            .map((folder) => (
              <FolderTab
                key={folder.id}
                label={folder.title}
                selected={activeFolderId === folder.id}
                unread={folder.unreadCount}
                onSelect={() => selectFolder(folder.id)}
              />
            ))}
        </div>
      ) : null}
      <nav
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        aria-label={copy.chats}
      >
        {historyMode ? (
          <SearchHistory
            chats={chats}
            recentSearches={recentSearches}
            timeFormat={timeFormat}
            onOpen={(chatId) => {
              // Opening a result is what records it — both clients push on
              // the row's click, never on typing — and it closes the search
              // surface behind it.
              selectRecentSearches(pushRecentSearch(recentSearches, chatId));
              void select(chatId);
              setSearchFocused(false);
              onSelectChat();
            }}
            onRemove={(chatId) =>
              selectRecentSearches(removeRecentSearch(recentSearches, chatId))
            }
            onClearAll={() => setClearHistoryOpen(true)}
          />
        ) : searching ? (
          globalSearchResults ? (
            <>
              {globalSearchResults.chats.length ? (
                <>
                  <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    {copy.chats}
                  </div>
                  {globalSearchResults.chats.map((chat) => (
                    <ChatListRow
                      key={chat.id}
                      chat={chat}
                      active={activeChatId === chat.id}
                      timeFormat={timeFormat}
                      onSelect={() => {
                        selectRecentSearches(
                          pushRecentSearch(recentSearches, chat.id),
                        );
                        void select(chat.id);
                        onSelectChat();
                      }}
                    />
                  ))}
                </>
              ) : null}
              {globalSearchResults.messages.length ? (
                <>
                  <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    {copy.messages}
                  </div>
                  {globalSearchResults.messages.map((message) => (
                    <MessageSearchResultRow
                      key={message.id}
                      message={message}
                      chat={chatsById.get(message.chatId) ?? null}
                      timeFormat={timeFormat}
                      onSelect={() => {
                        selectRecentSearches(
                          pushRecentSearch(recentSearches, message.chatId),
                        );
                        void requestJumpToMessage(message.chatId, message.id);
                        onSelectChat();
                      }}
                    />
                  ))}
                </>
              ) : null}
              {!globalSearchResults.chats.length &&
              !globalSearchResults.messages.length ? (
                <div className="grid h-full place-items-center px-3 text-center text-sm text-muted-foreground">
                  {copy.noChats}
                </div>
              ) : null}
            </>
          ) : globalSearching ? (
            <LoadIndicator label={copy.searchingServer} />
          ) : null
        ) : (
          <>
            {activeFolderId === ARCHIVE_FOLDER_ID ? (
              <ArchiveBackRow onBack={() => selectFolder(null)} />
            ) : null}
            {activeFolderId === null && archivedVisible.length ? (
              <ArchiveRow
                archived={archivedVisible}
                unread={archiveUnread}
                onSelect={() => selectFolder(ARCHIVE_FOLDER_ID)}
              />
            ) : null}
            {pinnedVisible.length ? (
              <>
                <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  {copy.pinnedChats}
                </div>
                {pinnedVisible.map((chat) => (
                  <ChatListRow
                    key={chat.id}
                    chat={chat}
                    active={activeChatId === chat.id}
                    timeFormat={timeFormat}
                    promoted={animateChatIds.includes(chat.id)}
                    onSelect={() => {
                      void select(chat.id);
                      onSelectChat();
                    }}
                  />
                ))}
              </>
            ) : null}
            {unpinnedVisible.map((chat) => (
              <ChatListRow
                key={chat.id}
                chat={chat}
                active={activeChatId === chat.id}
                timeFormat={timeFormat}
                promoted={animateChatIds.includes(chat.id)}
                onSelect={() => {
                  void select(chat.id);
                  onSelectChat();
                }}
              />
            ))}
            {!visible.length ? (
              loadingChatList ? (
                <ChatListSkeleton />
              ) : (
                <div className="grid h-full place-items-center px-3 text-center text-sm text-muted-foreground">
                  {copy.noChats}
                </div>
              )
            ) : null}
            {chatCursor && visible.length ? (
              <div ref={endSentinelRef} className="h-px" />
            ) : null}
            <AnimatePresence initial={false}>
              {loadingMoreChats ? (
                <LoadIndicator label={copy.loadingChats} />
              ) : null}
            </AnimatePresence>
          </>
        )}
      </nav>
      <footer className="border-t">
        <AccountMenu onOpenSettings={onOpenSettings} />
      </footer>
      <CenterMorphModal
        open={clearHistoryOpen}
        onOpenChange={setClearHistoryOpen}
      >
        <CenterMorphModalContent
          ariaLabel={copy.clearSearchHistoryAction}
          closeButtonLabel={copy.closeDialog}
        >
          <div className="flex max-w-sm flex-col gap-4 p-5">
            {/* web-k asks the same question before wiping the list
                ('Search.Confirm.ClearHistory'), with the action styled as
                destructive. */}
            <p className="text-sm">{copy.clearSearchHistoryConfirm}</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  selectRecentSearches([]);
                  setClearHistoryOpen(false);
                }}
                className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              >
                {copy.clearSearchHistoryAction}
              </Button>
            </div>
          </div>
        </CenterMorphModalContent>
      </CenterMorphModal>
    </aside>
  );
}
