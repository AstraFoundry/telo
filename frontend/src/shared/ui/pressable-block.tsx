"use client";

import {
  type HTMLMotionProps,
  motion,
  useReducedMotionConfig,
} from "motion/react";

import { SPRING_PRESS } from "./motion";

import { cn } from "@/shared/lib/cn";

export interface PressableBlockProps extends Omit<
  HTMLMotionProps<"button">,
  "layout" | "layoutId"
> {
  /**
   * Names the control, since the children are usually rich text whose computed
   * name would read as one run-on string.
   */
  readonly "aria-label": string;
}

/**
 * Makes an arbitrary block tappable without inheriting button chrome, for cases
 * the sized `Button` cannot express: quoted replies, banners, and preview cards
 * that own their own layout and borders. Supplies only the press spring, the
 * shared 0.96 press scale, and a focus ring; every visual decision stays with
 * the caller. `layout` is omitted because these blocks sit in scrolling lists,
 * where a layout animation would fight the scroll.
 */
export function PressableBlock({
  className,
  children,
  ...rest
}: PressableBlockProps) {
  const reduce = useReducedMotionConfig();

  return (
    <motion.button
      type="button"
      whileTap={reduce ? undefined : { scale: 0.96 }}
      transition={SPRING_PRESS}
      className={cn(
        "block w-full select-none rounded-md text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
