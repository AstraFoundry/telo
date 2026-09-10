import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { GlobalSearchResultDto } from "../../../../../contracts/src/ipc";
import { displayChatTitle, useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { useHotkeys } from "shared/lib/use-hotkeys";
import {
  Avatar,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
  EASE_OUT,
  LoadIndicator,
} from "shared/ui";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The Cmd/Ctrl+K palette: server global search (chats + messages) in a
 * combobox that opens and closes instantly — a many-times-a-day keyboard
 * action, so there is no open/close motion at all. It only mounts while
 * open, so the combobox renders straight into its open state.
 */
export function GlobalSearchPalette() {
  const [open, setOpen] = useState(false);
  useHotkeys([
    {
      key: "k",
      metaOrCtrl: true,
      allowInInputs: true,
      handler: (event) => {
        event.preventDefault();
        setOpen((current) => !current);
      },
    },
  ]);
  if (!open) return null;
  return <PaletteSurface onClose={() => setOpen(false)} />;
}

function PaletteSurface({ onClose }: { onClose(): void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResultDto | null>(null);
  const [searching, setSearching] = useState(false);
  const requestRef = useRef(0);
  const reduce = useReducedMotionConfig() ?? false;

  // Searching ↔ results swap: the only motion this keyboard-summoned palette
  // gets (open/close stays instant). A hard cut from the load indicator to
  // the result list reads as a glitch, so the branches crossfade.
  const swap = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: -4 },
    transition: { duration: reduce ? 0.12 : 0.18, ease: EASE_OUT },
  } as const;

  // Query changes are handled here (an event), not in the effect: clearing
  // the field restores the empty palette immediately and invalidates any
  // in-flight search.
  const updateQuery = (next: string) => {
    setQuery(next);
    if (next.trim()) {
      setSearching(true);
    } else {
      requestRef.current += 1;
      setResults(null);
      setSearching(false);
    }
  };

  // The sidebar search field debounces the same IPC the same way; the
  // palette keeps its own state so the two surfaces never fight over the
  // store's sidebar-bound search slots.
  useEffect(() => {
    const term = query.trim();
    if (!term) return;
    const request = ++requestRef.current;
    const timer = setTimeout(() => {
      void window.telo.workspace
        .searchGlobal(term)
        .then((next) => {
          if (request !== requestRef.current) return;
          setResults(next);
          setSearching(false);
        })
        .catch(() => {
          // A failed search leaves the palette empty, never fake results.
          if (request !== requestRef.current) return;
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const select = (value: string) => {
    onClose();
    const state = useChatStore.getState();
    if (value.startsWith("chat:")) {
      void state.select(value.slice("chat:".length));
    } else if (value.startsWith("message:")) {
      const [, chatId, messageId] = value.split(":");
      if (chatId && messageId) {
        void state.requestJumpToMessage(chatId, messageId);
      }
    }
  };

  return (
    <Combobox
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      query={query}
      onQueryChange={updateQuery}
      onValueChange={select}
      // The server already filtered these results; a second client-side
      // pass would hide preview-only matches.
      filter={() => true}
      className="fixed left-1/2 top-[12vh] z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2"
    >
      <ComboboxTrigger className="bg-background shadow-lg">
        <ComboboxInput
          aria-label={copy.searchEverywhereLabel}
          placeholder={copy.searchEverywhere}
        />
      </ComboboxTrigger>
      <ComboboxContent className="shadow-lg">
        <ComboboxList ariaLabel={copy.searchEverywhereLabel}>
          <AnimatePresence mode="wait" initial={false}>
            {searching ? (
              <motion.div key="searching" {...swap}>
                <LoadIndicator label={copy.searchingServer} />
              </motion.div>
            ) : (
              <motion.div key="results" {...swap}>
                <ComboboxGroup>
                  <ComboboxLabel>{copy.chats}</ComboboxLabel>
                  {(results?.chats ?? []).map((chat) => (
                    <ComboboxItem
                      key={chat.id}
                      value={`chat:${chat.id}`}
                      textValue={displayChatTitle(chat)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar
                          src={chat.avatarDataUrl}
                          pending={chat.avatarPending}
                          mark={chat.kind === "saved" ? "saved" : undefined}
                          placeholder={chat.avatarPlaceholder}
                          className="size-6"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {displayChatTitle(chat)}
                        </span>
                      </span>
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
                <ComboboxGroup>
                  <ComboboxLabel>{copy.messages}</ComboboxLabel>
                  {(results?.messages ?? []).map((message) => (
                    <ComboboxItem
                      key={message.id}
                      value={`message:${message.chatId}:${message.id}`}
                      textValue={message.body}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">
                          {message.senderName}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {message.body}
                        </span>
                      </span>
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
                {results ? (
                  <ComboboxEmpty>{copy.noSearchResults}</ComboboxEmpty>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
