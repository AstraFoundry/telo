import { useEffect } from "react";

import type { MessageDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  LoadIndicator,
} from "shared/ui";

/** Telegram Desktop and Web A put a first row of reactions on the menu. */
const MENU_REACTION_MAX = 8;

export interface ReactionMenuStripProps {
  readonly message: MessageDto;
}

/**
 * The reaction row at the top of a message context menu. The hover rail is
 * the fast path; this is how Telegram Desktop always offers the same set
 * when a pointer never enters the rail (or `pointer: fine` is missing).
 *
 * Picking an emoji uses `ContextMenuItem` so the menu closes the same way
 * every other action does. A failed toggle reverts quietly.
 */
export function ReactionMenuStrip({ message }: ReactionMenuStripProps) {
  const availableReactions = useChatStore((state) => state.availableReactions);
  const availableReactionsReady = useChatStore(
    (state) => state.availableReactionsReady,
  );
  const loadAvailableReactions = useChatStore(
    (state) => state.loadAvailableReactions,
  );
  const toggleReaction = useChatStore((state) => state.toggleReaction);

  useEffect(() => {
    void loadAvailableReactions(message.id);
  }, [loadAvailableReactions, message.id]);

  if (message.status !== "sent" && message.status !== "read") return null;
  if (!availableReactionsReady) {
    return <LoadIndicator label={copy.reactions} />;
  }
  if (availableReactions.length === 0) return null;

  return (
    <>
      <div
        role="group"
        aria-label={copy.reactions}
        className="flex max-w-64 flex-wrap gap-[var(--message-reaction-gap)] px-1 py-0.5"
      >
        {availableReactions.slice(0, MENU_REACTION_MAX).map((emoji) => (
          <ContextMenuItem
            key={emoji}
            textValue={emoji}
            onSelect={() => {
              void toggleReaction(message.id, emoji).catch(() => undefined);
            }}
            className="size-10 justify-center p-0 text-lg"
          >
            {emoji}
          </ContextMenuItem>
        ))}
      </div>
      <ContextMenuSeparator />
    </>
  );
}
