import { useEffect, useRef, useState } from "react";

/**
 * Commits a rapidly changing value at most once per browser frame.
 *
 * Provider deltas can arrive several times between paints. Keeping only the
 * newest value for the next frame avoids repeated Markdown parsing without
 * adding an artificial per-word delay. Inactive consumers receive the final
 * value synchronously so completion never leaves a stale tail behind.
 */
export function useFrameCoalescedValue<T>(value: T, active: boolean): T {
  const latestRef = useRef(value);
  const frameRef = useRef<number | null>(null);
  const [committed, setCommitted] = useState(value);

  useEffect(() => {
    latestRef.current = value;
    if (!active) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }
    if (frameRef.current !== null || Object.is(committed, value)) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setCommitted(latestRef.current);
    });
  }, [active, committed, value]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return active ? committed : value;
}
