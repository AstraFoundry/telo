import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

export interface SkeletonProps {
  /**
   * Fully round instead of the default pill. Use it for the avatar slot of a
   * row skeleton so the placeholder has the shape of what will land there.
   */
  readonly circle?: boolean;
  /**
   * Square corners follow the surrounding surface instead of the bar's pill
   * radius — the media grid's tiles, which are `aspect-square` cells.
   */
  readonly rounded?: boolean;
  readonly className?: string;
  /**
   * Escape hatch for a placeholder whose size comes from a measured constant
   * rather than the type scale — the sticker grid's cell, which the picker and
   * the set sheet both size in pixels.
   */
  readonly style?: CSSProperties;
}

/**
 * One placeholder shape. Telegram never shows a spinner where it already
 * knows the shape of what is arriving: `Ui::SkeletonAnimation` swaps a label's
 * glyphs for bars sized to the real measured line widths, and
 * `info_profile_tab_skeleton.cpp` draws the tab's own grid or rows. A skeleton
 * is therefore a geometry statement, not a loading notice — it must match the
 * layout it stands in for or it trades a spinner for a layout jump.
 *
 * The sweep is a compositor-only `transform` on a decorative overlay, so a
 * screenful of these costs nothing on the main thread. It is deliberately CSS
 * rather than Motion: a Motion loop per bar would schedule JS every frame for
 * a purely decorative highlight.
 */
export function Skeleton({ circle, rounded, className, style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        "relative block overflow-hidden bg-foreground/10",
        circle ? "rounded-full" : rounded ? "rounded-lg" : "rounded-full",
        className,
      )}
    >
      {/*
        tdesktop sweeps from the bar's own colour at 50% alpha down to 20% in
        the middle (`skeleton_animation.cpp:110-116`) rather than adding a
        white sheen, which is why it reads correctly on both themes: the band
        is the surface colour, so it thins the bar instead of tinting it.
      */}
      <span
        aria-hidden="true"
        className="absolute inset-0 animate-[telo-skeleton-sweep_2s_cubic-bezier(0.4,0,0.2,1)_1.5s_infinite] bg-gradient-to-r from-transparent via-background/70 to-transparent motion-reduce:hidden"
      />
    </span>
  );
}

export interface SkeletonGroupProps {
  /** Screen-reader announcement; the bars themselves stay out of the tree. */
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * The live region around a set of skeleton shapes. Without it a reader walks
 * a wall of empty elements; tdesktop's equivalent is marking the skeleton
 * widget transparent for mouse events (`info_profile_tab_skeleton.cpp:79`),
 * which `pointer-events-none` covers here.
 */
export function SkeletonGroup({
  label,
  className,
  children,
}: SkeletonGroupProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn("pointer-events-none select-none", className)}
    >
      {children}
    </div>
  );
}
