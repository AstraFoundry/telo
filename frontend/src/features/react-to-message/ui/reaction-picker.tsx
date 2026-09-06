import { Smiley } from "@phosphor-icons/react";
import { useState } from "react";

import type { MessageDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Button,
  LoadIndicator,
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from "shared/ui";

import { ReactionChip } from "./reaction-chip";

export interface ReactionPickerProps {
  readonly message: MessageDto;
  onOpenChange?(open: boolean): void;
}

/**
 * The reaction picker, opened from the bubble's hover rail. Telegram Desktop
 * and both web clients offer the same strip of the chat's allowed reactions
 * (Telegram Web A `ReactionSelector`, mounted on the message context menu;
 * Telegram Web K's hover-reaction button off the bubble edge), so the list
 * comes from `getMessageAvailableReactions` rather than a list this client
 * invented.
 *
 * One reaction per account: picking the emoji already chosen clears it, which
 * is what `toggleReaction` does, so the picker needs no separate remove
 * action. The popover owns Escape, focus return and its reduced-motion
 * fallback; the chips are ordinary buttons, so Enter and Space activate them.
 *
 * A failed toggle reverts the optimistic chip. Telegram Desktop does not
 * paint a protocol error under the bubble, so this picker does not either.
 */
export function ReactionPicker({ message, onOpenChange }: ReactionPickerProps) {
  const [open, setOpen] = useState(false);
  const availableReactions = useChatStore((state) => state.availableReactions);
  const availableReactionsReady = useChatStore(
    (state) => state.availableReactionsReady,
  );
  const loadAvailableReactions = useChatStore(
    (state) => state.loadAvailableReactions,
  );
  const toggleReaction = useChatStore((state) => state.toggleReaction);
  const chosen = message.reactions?.find((reaction) => reaction.chosen)?.emoji;

  const changeOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
    // The list is fetched when the picker is first shown, not when the
    // transcript renders: a chat's allowed reactions cost a round trip
    // and most rows are never reacted to.
    if (next) void loadAvailableReactions(message.id);
  };

  return (
    <MorphPopover open={open} onOpenChange={changeOpen}>
      <MorphPopoverTrigger>
        <Button
          size="icon"
          variant="ghost"
          aria-label={copy.react}
          className="size-10 rounded-full hover:bg-transparent"
        >
          {/* Same rail convention as its neighbours: a 28px disc inside the
              full 40px pointer target. */}
          <span className="grid size-7 place-items-center rounded-full border border-border bg-popover shadow-sm">
            <Smiley aria-hidden="true" className="size-3.5" />
          </span>
        </Button>
      </MorphPopoverTrigger>
      <MorphPopoverContent
        side="top"
        align={message.outgoing ? "end" : "start"}
        className="pointer-events-auto p-1"
      >
        {!availableReactionsReady ? (
          <LoadIndicator label={copy.reactions} />
        ) : (
          <div
            role="group"
            aria-label={copy.reactions}
            className="flex max-w-64 flex-wrap gap-[var(--message-reaction-gap)]"
          >
            {availableReactions.map((emoji) => (
              <ReactionChip
                key={emoji}
                emoji={emoji}
                chosen={emoji === chosen}
                onSelect={() => {
                  changeOpen(false);
                  void toggleReaction(message.id, emoji).catch(() => undefined);
                }}
              />
            ))}
          </div>
        )}
      </MorphPopoverContent>
    </MorphPopover>
  );
}
