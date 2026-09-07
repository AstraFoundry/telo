import { useEffect, useRef, useState } from "react";

import { StreamPacer } from "./stream-pacer";

/** Drain interval while the tab is hidden and animation frames are paused. */
const HIDDEN_TICK_MS = 50;

function pageHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

/**
 * Meters a streamed reply onto the screen with a display clock that follows
 * the backlog (see `StreamPacer`), so a batch of deltas that arrived together
 * plays out over the following frames instead of landing as one jump.
 *
 * While `active`, the returned text trails `value` and catches up at a rate
 * set by how far behind it is. When `active` turns false the segment is
 * over: the backlog is flushed and `value` is returned as is, so completion
 * never leaves a stale tail behind. Frames drive the clock when the page is
 * visible; a short timer drains the queue while it is hidden.
 */
export function usePacedStreamText(value: string, active: boolean): string {
  const pacerRef = useRef<StreamPacer | null>(null);
  const handleRef = useRef<{ kind: "frame" | "timer"; id: number } | null>(
    null,
  );
  const [displayed, setDisplayed] = useState(value);

  useEffect(() => {
    const cancel = () => {
      const handle = handleRef.current;
      if (!handle) return;
      if (handle.kind === "frame") cancelAnimationFrame(handle.id);
      else clearTimeout(handle.id);
      handleRef.current = null;
    };

    if (!active) {
      cancel();
      pacerRef.current = null;
      return;
    }

    const pacer = (pacerRef.current ??= new StreamPacer());
    pacer.push(value);
    if (pacer.backlog === 0) return;

    const schedule = () => {
      if (handleRef.current) return;
      handleRef.current = pageHidden()
        ? { kind: "timer", id: window.setTimeout(step, HIDDEN_TICK_MS) }
        : { kind: "frame", id: requestAnimationFrame(step) };
    };
    const step = () => {
      handleRef.current = null;
      const next = pacer.tick(performance.now());
      if (next !== null) setDisplayed(next);
      if (pacer.backlog > 0) schedule();
    };
    // A frame requested while visible never fires once the tab hides, so the
    // hidden path re-arms on the timer.
    const onVisibility = () => {
      if (!pageHidden() || handleRef.current?.kind !== "frame") return;
      cancel();
      schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancel();
    };
  }, [active, value]);

  return active ? displayed : value;
}
