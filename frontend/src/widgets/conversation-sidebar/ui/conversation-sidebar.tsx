import {
  Bell,
  BellSlash,
  Checks,
  PushPin,
  PushPinSlash,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import type { TimeFormatPreference } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { useTimeFormat } from "entities/preferences";
import { AccountMenu } from "features/account-menu";
import { ChatSearch } from "features/chat-search";
import { copy } from "shared/config/copy";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
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

export function ConversationSidebar({
  onOpenSettings,
  onSelectChat,
}: ConversationSidebarProps) {
  const chats = useChatStore((state) => state.chats);
  const activeChatId = useChatStore((state) => state.activeChatId);
  const select = useChatStore((state) => state.select);
  const togglePin = useChatStore((state) => state.togglePin);
  const toggleMute = useChatStore((state) => state.toggleMute);
  const toggleRead = useChatStore((state) => state.toggleRead);
  const [query, setQuery] = useState("");
  const { value: timeFormat } = useTimeFormat();

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term
      ? chats.filter((chat) =>
          `${chat.title} ${chat.preview}`.toLocaleLowerCase().includes(term),
        )
      : chats;
  }, [chats, query]);

  return (
    <aside className="flex min-w-0 flex-col" aria-label={copy.chats}>
      <header className="flex h-14 items-center px-3 [app-region:drag]">
        <strong className="text-base tracking-tight">{copy.appName}</strong>
      </header>
      <div className="px-3 pb-2">
        <ChatSearch value={query} onChange={setQuery} />
      </div>
      <nav
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        aria-label={copy.chats}
      >
        {filtered.map((chat) => (
          <ContextMenu key={chat.id}>
            <ContextMenuTrigger>
              <Button
                variant="ghost"
                onClick={() => {
                  void select(chat.id);
                  onSelectChat();
                }}
                aria-current={activeChatId === chat.id ? "page" : undefined}
                /* deslop-ignore-next-line 21 — compact chat-row radius is a messaging convention */
                className={`mb-0.5 h-auto w-full justify-start rounded-xl px-2.5 py-2 text-left ${
                  activeChatId === chat.id ? "bg-accent text-foreground" : ""
                }`}
              >
                {/* deslop-ignore-next-line 19 */}
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">
                  {chat.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {chat.title}
                    </span>
                    <time className="text-[11px] font-normal text-muted-foreground">
                      {shortTime(chat.updatedAt, timeFormat)}
                    </time>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">
                      {chat.preview}
                    </span>
                    {chat.muted ? <BellSlash aria-label={copy.muted} /> : null}
                    {chat.unreadCount ? (
                      <span
                        aria-label={`${chat.unreadCount} ${copy.unread}`}
                        /* deslop-ignore-next-line 19 */
                        className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground"
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
        ))}
        {!filtered.length ? (
          <div className="grid h-full place-items-center px-3 text-center text-sm text-muted-foreground">
            {copy.noChats}
          </div>
        ) : null}
      </nav>
      <footer className="border-t">
        <AccountMenu onOpenSettings={onOpenSettings} />
      </footer>
    </aside>
  );
}
