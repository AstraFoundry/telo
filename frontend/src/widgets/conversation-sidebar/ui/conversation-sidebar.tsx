import {
  Bell,
  BellSlash,
  Checks,
  PushPin,
  PushPinSlash,
} from "@phosphor-icons/react";
import { useMemo } from "react";

import type {
  ChatDto,
  MessageDto,
  TimeFormatPreference,
} from "../../../../../contracts/src/ipc";
import { ARCHIVE_FOLDER_ID } from "../../../../../contracts/src/ipc";
import { allChatsUnread, chatsForFolder, useChatStore } from "entities/chat";
import { useTimeFormat } from "entities/preferences";
import { AccountMenu } from "features/account-menu";
import { ChatSearch } from "features/chat-search";
import { AnimatePresence } from "motion/react";

import { copy } from "shared/config/copy";
import { useEdgeSentinel } from "shared/lib/use-edge-sentinel";

import {
  Avatar,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  LoadIndicator,
  MessageTyping,
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

// Message search results carry no chat initials; derive them like the
// backend does for chats.
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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
      className={`h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
        selected ? "bg-accent text-foreground" : "text-muted-foreground"
      }`}
    >
      {label}
      {unread ? (
        <>
          {" "}
          <span
            aria-label={`${unread} ${copy.unread}`}
            className="grid min-w-4 place-items-center rounded-full bg-primary px-1 py-0.5 text-[10px] text-primary-foreground tabular-nums"
          >
            {unread}
          </span>
        </>
      ) : null}
    </Button>
  );
}

interface ChatListRowProps {
  readonly chat: ChatDto;
  readonly active: boolean;
  readonly timeFormat: TimeFormatPreference;
  onSelect(): void;
}

// One chat row, shared by the plain list and the server search results.
function ChatListRow({ chat, active, timeFormat, onSelect }: ChatListRowProps) {
  const togglePin = useChatStore((state) => state.togglePin);
  const toggleMute = useChatStore((state) => state.toggleMute);
  const toggleRead = useChatStore((state) => state.toggleRead);

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Button
          variant="ghost"
          pressScale={1}
          onClick={onSelect}
          aria-current={active ? "page" : undefined}
          /* deslop-ignore-next-line 21 — compact chat-row radius is a messaging convention */
          className={`mb-0.5 h-auto w-full justify-start rounded-xl px-2.5 py-2 text-left ${
            active ? "bg-accent text-foreground" : ""
          }`}
        >
          <Avatar
            initials={chat.initials}
            src={chat.avatarDataUrl}
            className="size-10 text-xs font-semibold"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {chat.title}
              </span>
              <time className="text-[11px] font-normal text-muted-foreground tabular-nums">
                {shortTime(chat.updatedAt, timeFormat)}
              </time>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">
                {chat.typing ? (
                  <span className="flex items-center gap-1.5 text-primary">
                    <MessageTyping label={copy.typing} />
                    <span aria-hidden="true">{copy.typing}</span>
                  </span>
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
                  className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground tabular-nums"
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
      className="mb-0.5 h-auto w-full justify-start rounded-xl px-2.5 py-2 text-left"
    >
      <Avatar
        initials={chat?.initials ?? initialsOf(message.senderName)}
        src={chat?.avatarDataUrl ?? null}
        className="size-10 text-xs font-semibold"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {message.senderName}
          </span>
          <time className="text-[11px] font-normal text-muted-foreground tabular-nums">
            {shortTime(message.sentAt, timeFormat)}
          </time>
        </span>
        <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
          {message.body}
        </span>
      </span>
    </Button>
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

  const allUnread = useMemo(() => allChatsUnread(chats), [chats]);

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

  return (
    <aside className="flex min-w-0 flex-col" aria-label={copy.chats}>
      <header className="flex h-14 items-center px-3 [app-region:drag]">
        <strong className="text-base tracking-tight">{copy.appName}</strong>
      </header>
      <div className="px-3 pb-2">
        <ChatSearch value={query} onChange={setSearchQuery} />
      </div>
      {folders.length && !searching ? (
        <div
          role="tablist"
          aria-label={copy.chatFolders}
          className="flex items-center gap-1 overflow-x-auto px-3 pb-2"
        >
          <FolderTab
            label={copy.allChats}
            selected={activeFolderId === null}
            unread={allUnread}
            onSelect={() => selectFolder(null)}
          />
          {folders.map((folder) => (
            <FolderTab
              key={folder.id}
              label={
                folder.id === ARCHIVE_FOLDER_ID
                  ? copy.archiveFolder
                  : folder.title
              }
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
        {searching ? (
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
                onSelect={() => {
                  void select(chat.id);
                  onSelectChat();
                }}
              />
            ))}
            {!visible.length ? (
              <div className="grid h-full place-items-center px-3 text-center text-sm text-muted-foreground">
                {copy.noChats}
              </div>
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
    </aside>
  );
}
