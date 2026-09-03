import { type RefObject, useEffect, useState } from "react";

export type ScrollFadeEdges = "none" | "start" | "end" | "both";

const TOLERANCE_PX = 1;

function edgesOf(
  node: HTMLElement,
  orientation: "horizontal" | "vertical",
): ScrollFadeEdges {
  const position =
    orientation === "horizontal" ? node.scrollLeft : node.scrollTop;
  const size =
    orientation === "horizontal" ? node.scrollWidth : node.scrollHeight;
  const viewport =
    orientation === "horizontal" ? node.clientWidth : node.clientHeight;
  const overflow = size - viewport;
  if (overflow <= TOLERANCE_PX) return "none";
  const atStart = position <= TOLERANCE_PX;
  const atEnd = position >= overflow - TOLERANCE_PX;
  if (atStart && atEnd) return "none";
  if (atStart) return "end";
  if (atEnd) return "start";
  return "both";
}

/**
 * Which edges of a scroll container hide more content, kept current on
 * scroll, resize and content changes. Pair with `scrollFadeMask` to soften
 * the clipped edge instead of cutting items off mid-glyph.
 */
export function useScrollFade(
  ref: RefObject<HTMLElement | null>,
  orientation: "horizontal" | "vertical" = "vertical",
): ScrollFadeEdges {
  const [edges, setEdges] = useState<ScrollFadeEdges>("none");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setEdges(edgesOf(node, orientation));
    update();
    node.addEventListener("scroll", update, { passive: true });
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(node);
    const mutation =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(update);
    mutation?.observe(node, { childList: true, subtree: true });
    return () => {
      node.removeEventListener("scroll", update);
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, [ref, orientation]);

  return edges;
}

/**
 * CSS mask for the fading edges, `size` wide. Undefined when nothing is
 * clipped so the element renders unmasked and cheaply.
 */
export function scrollFadeMask(
  edges: ScrollFadeEdges,
  orientation: "horizontal" | "vertical" = "vertical",
  size = "1.25rem",
): string | undefined {
  if (edges === "none") return undefined;
  const direction = orientation === "horizontal" ? "to right" : "to bottom";
  const start = edges === "start" || edges === "both";
  const end = edges === "end" || edges === "both";
  return `linear-gradient(${direction}, ${start ? `transparent 0, black ${size}` : "black 0"}, ${end ? `black calc(100% - ${size}), transparent 100%` : "black 100%"})`;
}
