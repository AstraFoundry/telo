import { useEffect, useState } from "react";

/**
 * Viewport width at and below which the workspace collapses from three
 * columns (chat list | conversation | agent panel) to a single column that
 * shows either the chat list or the conversation. The only narrow/wide
 * decision point; every consumer reads the useNarrowWorkspace hook.
 */
export const NARROW_WORKSPACE_BREAKPOINT_PX = 768;

const NARROW_WORKSPACE_QUERY = `(max-width: ${NARROW_WORKSPACE_BREAKPOINT_PX}px)`;

/** Clamps a column width to its bounds and rounds to whole CSS pixels. */
export function clampColumnWidth(
  width: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** Tracks whether the viewport is at or below the narrow breakpoint. */
export function useNarrowWorkspace(): boolean {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia(NARROW_WORKSPACE_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(NARROW_WORKSPACE_QUERY);
    const onChange = () => setNarrow(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return narrow;
}
