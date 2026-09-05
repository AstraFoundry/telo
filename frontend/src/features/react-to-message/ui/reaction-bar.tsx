import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";

import type { MessageDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { userFacingErrorDetail } from "shared/lib/user-facing-error";
import { EASE_OUT } from "shared/ui";

import { ReactionChip } from "./reaction-chip";

// A chip appearing is a state change the reader did not necessarily cause —
// someone else's reaction lands here too — so it gets a bridge rather than a
// teleport: opacity plus a 0.9 scale over 150ms, the same budget Telegram Web
// A uses for its chip transitions (ReactionButton.module.scss, 150ms).
const CHIP_TRANSITION = { duration: 0.15, ease: EASE_OUT } as const;

export interface ReactionBarProps {
  readonly message: MessageDto;
  /** Surfaced by the transcript row, which owns the bubble's alert slot. */
  onFailure(detail: string): void;
}

/**
 * The reaction row under a bubble. Telegram renders it outside the bubble
 * whenever it cannot share the meta's line (Telegram Web K `.reactions-block`
 * with `margin-top: -.125rem`, Telegram Web A `Reactions.is-outside`), and
 * reverses the row on own messages so the first chip always sits on the
 * bubble's outer edge.
 */
export function ReactionBar({ message, onFailure }: ReactionBarProps) {
  const toggleReaction = useChatStore((state) => state.toggleReaction);
  const reduce = useReducedMotionConfig() ?? false;
  const reactions = message.reactions ?? [];

  if (reactions.length === 0) return null;

  return (
    <div
      role="group"
      data-slot="message-reactions"
      className={`flex flex-wrap gap-[var(--message-reaction-gap)] ${
        message.outgoing ? "flex-row-reverse" : "flex-row"
      }`}
    >
      <AnimatePresence initial={false}>
        {reactions.map((reaction) => (
          <motion.div
            key={reaction.emoji}
            initial={reduce ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
            transition={reduce ? { duration: 0 } : CHIP_TRANSITION}
          >
            <ReactionChip
              emoji={reaction.emoji}
              count={reaction.count}
              chosen={reaction.chosen}
              onSelect={() => {
                void toggleReaction(message.id, reaction.emoji).catch(
                  (error: unknown) => {
                    onFailure(userFacingErrorDetail(error) ?? "");
                  },
                );
              }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
