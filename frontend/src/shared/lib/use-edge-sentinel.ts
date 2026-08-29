import { useEffect, useRef, useState, type RefCallback } from "react";

export interface EdgeSentinelOptions {
  /** Whether reaching the sentinel fires — typically `hasMore && !loading`. */
  enabled: boolean;
  onReach(): void;
  /** Preload margin around the viewport, e.g. "200px 0px" to fetch early. */
  rootMargin?: string;
}

/**
 * Fires `onReach` when the sentinel element scrolls into the viewport (plus
 * margin). Replaces scroll-position thresholds: the trigger is the sentinel's
 * visibility, so it cannot misfire while the list is programmatically
 * scrolling elsewhere. When `enabled` flips back on, the observer reports the
 * sentinel's current visibility, which keeps short pages filling until the
 * viewport overflows — the same fill behavior Telegram's lists have.
 */
export function useEdgeSentinel<T extends HTMLElement = HTMLDivElement>({
  enabled,
  onReach,
  rootMargin = "200px 0px",
}: EdgeSentinelOptions): RefCallback<T> {
  const [node, setNode] = useState<T | null>(null);
  const onReachRef = useRef(onReach);
  useEffect(() => {
    onReachRef.current = onReach;
  });

  useEffect(() => {
    if (!node || !enabled || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onReachRef.current();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, enabled, rootMargin]);

  return setNode;
}
