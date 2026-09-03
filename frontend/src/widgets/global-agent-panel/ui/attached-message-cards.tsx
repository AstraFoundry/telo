import { X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";

import type { AgentAttachedMessage } from "entities/agent";
import { copy } from "shared/config/copy";
import { Button, EASE_OUT } from "shared/ui";

interface AttachedMessageCardsProps {
  readonly items: ReadonlyArray<AgentAttachedMessage>;
  readonly disabled: boolean;
  onRemove(messageId: string): void;
}

/**
 * Telegram messages the user added to the conversation, sitting inside the
 * composer the way a quoted reply sits inside the chat composer. Each card
 * names the sender and shows the first line of the message; the run reads
 * the full bodies main-side, so the card is a handle, not the payload.
 *
 * Radii are concentric with the composer: the composer is 16px with 8px of
 * padding, so the cards are 8px.
 */
export function AttachedMessageCards({
  items,
  disabled,
  onRemove,
}: AttachedMessageCardsProps) {
  const reduce = useReducedMotionConfig() ?? false;
  if (items.length === 0) return null;
  return (
    <ul
      aria-label={copy.agentAttachedMessages}
      className="mb-1 flex flex-wrap gap-1.5 px-1 pt-1"
    >
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.li
            key={item.messageId}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            transition={{ duration: reduce ? 0.12 : 0.18, ease: EASE_OUT }}
            style={{ transformOrigin: "0% 100%" }}
            className="flex max-w-56 min-w-0 items-center gap-1 rounded-lg bg-muted/70 py-1 pr-1 pl-2.5"
          >
            <span className="flex min-w-0 flex-col leading-4">
              <span className="truncate text-xs font-medium text-foreground">
                {item.senderName}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {item.body}
              </span>
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={disabled}
              aria-label={copy.agentRemoveAttachment}
              // The visible control stays small inside the card; the pseudo-
              // element extends its hit area to the 40px minimum.
              className="relative size-6 shrink-0 rounded-md text-muted-foreground after:absolute after:-inset-2 after:content-['']"
              onClick={() => onRemove(item.messageId)}
            >
              <X className="size-3" />
            </Button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
