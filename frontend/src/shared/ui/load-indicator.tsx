import { SpinnerGap } from "@phosphor-icons/react";
import { motion, useReducedMotionConfig } from "motion/react";

import { cn } from "@/shared/lib/cn";

export interface LoadIndicatorProps {
  /** Screen-reader announcement; the indicator itself renders no text. */
  label: string;
  /**
   * Render inside the rounded bubble Telegram's transcript uses for history
   * paging (see Nicegram/Telegram-Android `ChatLoadingCell`).
   */
  bubble?: boolean;
  className?: string;
}

/**
 * Spinner-only loading indicator for list paging. Paging feedback is spatial
 * (a spinner where content will arrive), never a written "Loading…" notice.
 * Wrap the conditional in `AnimatePresence` at the call site so the fade plays.
 */
export function LoadIndicator({
  label,
  bubble = false,
  className,
}: LoadIndicatorProps) {
  const reduce = useReducedMotionConfig();
  return (
    <motion.div
      role="status"
      aria-label={label}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0.1 : 0.16, ease: "easeOut" }}
      className={cn(
        bubble
          ? "grid size-9 place-items-center rounded-full bg-muted"
          : "flex items-center justify-center py-2",
        className,
      )}
    >
      <SpinnerGap
        aria-hidden="true"
        className="size-4 animate-spin text-muted-foreground"
      />
    </motion.div>
  );
}
