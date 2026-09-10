import { ArrowDown } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";

import { copy } from "@/shared/config/copy";
import { cn } from "@/shared/lib/cn";

import { Button } from "@components/motion/button";
import { Tooltip } from "@components/motion/tooltip";

import { EASE_OUT } from "./motion";

export interface JumpToLatestProps {
  /** True while the scroller is away from its live edge. */
  readonly show: boolean;
  onJump(): void;
  /**
   * `lg` is the transcript's main FAB; `sm` floats inside a dense overlay
   * strip, where it keeps its compact look but carries the pseudo-element
   * hit-area extension up to the 40px floor.
   */
  readonly size?: "sm" | "lg";
  /** Positioning only — the component owns the look and the pop. */
  readonly className?: string;
}

/**
 * The round jump-to-latest FAB shared by the conversation view and the agent
 * panel's suggestion strip: pops in with a small scale when the scroller
 * leaves its live edge, fades only under reduced motion.
 */
export function JumpToLatest({
  show,
  onJump,
  size = "lg",
  className,
}: JumpToLatestProps) {
  const reduce = useReducedMotionConfig() ?? false;
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="jump-to-latest"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: reduce ? 0.12 : 0.18, ease: EASE_OUT }}
          className={className}
        >
          <Tooltip content={copy.jumpToLatestMessages}>
            <Button
              size="icon"
              variant="secondary"
              aria-label={copy.jumpToLatestMessages}
              className={cn(
                "rounded-full shadow-foreground/10",
                size === "sm"
                  ? "relative size-7 shadow-md after:absolute after:-inset-1.5 after:content-['']"
                  : "size-12 shadow-lg",
              )}
              onClick={onJump}
            >
              <ArrowDown
                weight="bold"
                className={size === "sm" ? "size-3.5" : "size-5"}
              />
            </Button>
          </Tooltip>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
