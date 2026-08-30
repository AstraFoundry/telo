import { CaretDown, CaretUp, MagnifyingGlass, X } from "@phosphor-icons/react";

import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { Button, Input } from "shared/ui";

// In-chat search is a high-frequency surface: it appears and navigates
// instantly, with no enter/exit motion (per the workspace motion rules).
export function InChatSearchBar() {
  const chatSearch = useChatStore((state) => state.chatSearch);
  const setChatSearchQuery = useChatStore((state) => state.setChatSearchQuery);
  const chatSearchOlder = useChatStore((state) => state.chatSearchOlder);
  const chatSearchNewer = useChatStore((state) => state.chatSearchNewer);
  const closeChatSearch = useChatStore((state) => state.closeChatSearch);

  if (!chatSearch.open) return null;

  const term = chatSearch.query.trim();
  const canGoOlder =
    chatSearch.index + 1 < chatSearch.matches.length ||
    chatSearch.cursor !== null;
  const canGoNewer = chatSearch.index > 0;

  return (
    <div className="flex items-center gap-1 border-b px-4 py-2">
      <Input
        value={chatSearch.query}
        onChange={setChatSearchQuery}
        aria-label={copy.searchMessages}
        placeholder={copy.searchMessages}
        leftIcon={<MagnifyingGlass />}
        autoFocus
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) {
              chatSearchNewer();
            } else {
              void chatSearchOlder();
            }
          }
          if (event.key === "Escape") {
            event.preventDefault();
            closeChatSearch();
          }
        }}
        /* deslop-ignore-next-line 21 — matches the sidebar search field */
        classNames={{ field: "h-10 rounded-xl bg-muted/55 border-transparent" }}
      />
      {term && !chatSearch.loading ? (
        <span
          className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums"
          aria-live="polite"
        >
          {chatSearch.totalCount > 0
            ? `${chatSearch.index + 1} ${copy.searchMatchOf} ${chatSearch.totalCount}`
            : copy.noSearchResults}
        </span>
      ) : null}
      <Button
        size="icon"
        variant="ghost"
        aria-label={copy.olderMatch}
        className="size-10 shrink-0"
        disabled={!canGoOlder}
        onClick={() => void chatSearchOlder()}
      >
        <CaretUp />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={copy.newerMatch}
        className="size-10 shrink-0"
        disabled={!canGoNewer}
        onClick={chatSearchNewer}
      >
        <CaretDown />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={copy.closeSearch}
        className="size-10 shrink-0"
        onClick={closeChatSearch}
      >
        <X />
      </Button>
    </div>
  );
}
