"use client";

import {
  type HTMLMotionProps,
  motion,
  useReducedMotionConfig,
} from "motion/react";
import type { ReactNode } from "react";

import { SPRING_PRESS } from "./motion";

import { cn } from "@/shared/lib/cn";

export interface OptionRowProps extends Omit<
  HTMLMotionProps<"button">,
  "children" | "layout" | "layoutId"
> {
  readonly label: string;
  /** Secondary line (stacked) or trailing detail (inline). */
  readonly description?: string;
  /**
   * `stacked` puts the description under the label; `inline` trails it. Shadows
   * Motion's `layout`, which stays omitted: these rows live in scrolling lists,
   * where a layout animation would fight the scroll.
   */
  readonly layout?: "stacked" | "inline";
  /**
   * Lets the primary line wrap instead of truncating, for a row whose value is
   * prose rather than a name. Off by default: suggestion lists rely on one row
   * staying one line so the list length is predictable.
   */
  readonly wrap?: boolean;
  /** Keyboard/roving highlight, independent of hover. */
  readonly active?: boolean;
  /**
   * Decoration ahead of the text, such as an avatar. Decorative only: it is
   * hidden from the accessible name, which stays label + description.
   */
  readonly leading?: ReactNode;
}

/**
 * Full-width picker row for suggestion and saved-item lists, so features never
 * hand-roll one. Rows grow with two lines of text rather than taking a fixed
 * button height, but still owe the 40px desktop target; only colour transitions,
 * since these lists sit on high-frequency composer paths.
 */
export function OptionRow({
  label,
  description,
  layout = "stacked",
  wrap = false,
  active = false,
  leading,
  className,
  ...rest
}: OptionRowProps) {
  const reduce = useReducedMotionConfig();
  const text =
    layout === "stacked" ? (
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "block w-full text-sm",
            wrap ? "break-words text-pretty" : "truncate",
          )}
        >
          {label}
        </span>
        {description ? (
          <span className="block w-full truncate text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    ) : (
      <>
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        {description ? (
          <span className="shrink-0 truncate text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </>
    );

  return (
    <motion.button
      type="button"
      whileTap={reduce ? undefined : { scale: 0.96 }}
      transition={SPRING_PRESS}
      // The two lines are separate elements, so the computed name would run
      // them together; name the row explicitly and let callers override.
      aria-label={description ? `${label}, ${description}` : label}
      className={cn(
        "inline-flex min-h-10 w-full select-none items-center justify-start",
        "rounded-lg px-2.5 py-2 text-left text-foreground transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        active ? "bg-muted" : "hover:bg-muted",
        // A stacked row without a leading slot keeps its text edge-to-edge;
        // with one, the two lines sit beside the decoration instead.
        layout === "stacked" && !leading ? "gap-0" : "gap-2",
        className,
      )}
      {...rest}
    >
      {leading ? (
        <span aria-hidden="true" className="flex shrink-0 items-center">
          {leading}
        </span>
      ) : null}
      {text}
    </motion.button>
  );
}
