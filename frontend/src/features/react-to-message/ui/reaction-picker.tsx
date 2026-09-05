import { Smiley } from "@phosphor-icons/react";
import { useState } from "react";

import type { MessageDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { userFacingErrorDetail } from "shared/lib/user-facing-error";
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
  /** Surfaced by the transcript row, which owns the bubble's alert slot. */
  onFailure(detail: string): void;
}

/**
 * The reaction picker, opened from the bubble's hover rail. Telegram Desktop
 * and both web clients offer the same strip of the chat's allowed reactions
 * (Telegram Web A `ReactionSelector`, mounted on the message context menu;
 * Telegram Web K's hover-reaction button off the bubble edge), so the list
 * comes from the chat itself rather than a list this client invented.
 *
 * One reaction per account: picking the emoji already chosen clears it, which
 * is what `toggleReaction` does, so the picker needs no separate remove
 * action. The popover owns Escape, focus return and its reduced-motion
 * fallback; the chips are ordinary buttons, so Enter and Space activate them.
 */
export function ReactionPicker({ message, onFailure }: ReactionPickerProps) {
  const [open, setOpen] = useState(false);
  const availableReactions = useChatStore((state) => state.availableReactions);
  const loadAvailableReactions = useChatStore(
    (state) => state.loadAvailableReactions,
  );
  const toggleReaction = useChatStore((state) => state.toggleReaction);
  const chosen = message.reactions?.find((reaction) => reaction.chosen)?.emoji;

  return (
    <MorphPopover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // The list is fetched when the picker is first shown, not when the
        // transcript renders: a chat's allowed reactions cost a round trip
        // and most rows are never reacted to.
        if (next) void loadAvailableReactions();
      }}
    >
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
        className="p-1"
      >
        {availableReactions.length === 0 ? (
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
                  setOpen(false);
                  void toggleReaction(message.id, emoji).catch(
                    (error: unknown) => {
                      onFailure(userFacingErrorDetail(error) ?? "");
                    },
                  );
                }}
              />
            ))}
          </div>
        )}
      </MorphPopoverContent>
    </MorphPopover>
  );
}
