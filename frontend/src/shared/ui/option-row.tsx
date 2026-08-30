"use client";

import { type HTMLMotionProps, motion, useReducedMotion } from "motion/react";

import { cn } from "@/shared/lib/cn";

/** Mirrors the press spring the BEUI button uses, which this layer cannot import. */
const SPRING_PRESS = {
  type: "spring",
  stiffness: 500,
  damping: 30,
  mass: 0.6,
} as const;

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
  /** Keyboard/roving highlight, independent of hover. */
  readonly active?: boolean;
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
  active = false,
  className,
  ...rest
}: OptionRowProps) {
  const reduce = useReducedMotion();

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
        layout === "stacked" ? "flex-col items-start gap-0" : "gap-2",
        className,
      )}
      {...rest}
    >
      {layout === "stacked" ? (
        <>
          <span className="block w-full truncate text-sm">{label}</span>
          {description ? (
            <span className="block w-full truncate text-xs text-muted-foreground">
              {description}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
          {description ? (
            <span className="shrink-0 truncate text-xs text-muted-foreground">
              {description}
            </span>
          ) : null}
        </>
      )}
    </motion.button>
  );
}
