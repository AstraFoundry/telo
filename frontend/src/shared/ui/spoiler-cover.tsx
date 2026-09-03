import { useEffect, useRef } from "react";

import { cn } from "@/shared/lib/cn";

import {
  MEDIA_TILE,
  TEXT_TILE,
  paintStillField,
  spoilerField,
  type SpoilerTile,
} from "./spoiler-particles";

/** Where a reveal starts, in the cover's own CSS pixel space. */
export interface SpoilerRevealOrigin {
  readonly x: number;
  readonly y: number;
}

export interface SpoilerCoverProps {
  /**
   * `text` measures the covered runs inside `container` and fills each with
   * the surrounding surface colour before stamping particles, because the
   * text underneath stays visible and the cover is what hides it. `media`
   * covers its own box and paints particles only — a blurred thumbnail is
   * already doing the hiding underneath.
   */
  readonly mode: "text" | "media";
  /**
   * Element whose `[data-spoiler]` descendants are measured, for `text`.
   * Unused by `media`, which covers itself.
   */
  readonly container?: HTMLElement | null;
  /** Non-null starts the reveal from that point; null holds the cover. */
  readonly revealFrom: SpoilerRevealOrigin | null;
  /** Called once the hole has grown past the last covered pixel. */
  onRevealed(): void;
  readonly className?: string;
}

/**
 * Reveal easing, from Telegram Web K (`helpers/easings.ts:7`, `unwrapEasing`).
 * Applied as an explicit cubic-bezier evaluation rather than a CSS transition
 * because the hole is punched per frame with `destination-out`, which no
 * declarative transition can drive.
 */
const UNWRAP = [0.45, 0.37, 0.29, 1] as const;
/** `getTimeForDist` (`messageSpoilerOverlay/utils.ts:56-58`). */
const REVEAL_MIN_MS = 600;
const REVEAL_DIST_DIVISOR = 160;
const REVEAL_DIST_SCALE = 350;
/** Reduced motion keeps the reveal, at the length of a plain crossfade. */
const REVEAL_REDUCED_MS = 150;
/**
 * The hole's feathered edge, as a fraction of its radius
 * (`shadowBlur = radius / 3.5`). This is the whole difference between a
 * dissolve and a circle wipe.
 */
const FEATHER_DIVISOR = 3.5;
/** Outward push of the dots, `progress² × 0.4` for text and `× 0.5` for media. */
const PUSH_TEXT = 0.4;
const PUSH_MEDIA = 0.5;
/** Vertical gap between wrapped lines that is closed rather than left striped. */
const LINE_GAP_PX = 2;

export function SpoilerCover({
  mode,
  container,
  revealFrom,
  onRevealed,
  className,
}: SpoilerCoverProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const revealRef = useRef<{ origin: SpoilerRevealOrigin; started: number }>(
    null,
  );
  const revealedRef = useRef(false);
  const onRevealedRef = useRef(onRevealed);
  onRevealedRef.current = onRevealed;

  useEffect(() => {
    if (!revealFrom) return;
    revealRef.current = { origin: revealFrom, started: performance.now() };
    revealedRef.current = false;
  }, [revealFrom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) {
      // No 2D context — an environment without canvas support, or one that
      // refused the context. The cover cannot be drawn, so it must not be
      // what withholds the content: a requested reveal completes at once.
      if (revealFrom && !revealedRef.current) {
        revealedRef.current = true;
        onRevealedRef.current();
      }
      return;
    }

    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const tile: SpoilerTile = mode === "text" ? TEXT_TILE : MEDIA_TILE;
    const color = particleColor(canvas);
    const field = spoilerField(tile, color);
    const dpr = field.dpr;
    // A slice offset and a flip per cover, so two spoilers side by side never
    // show the same field (`dotRenderer.ts:462-464`).
    const offset = { x: Math.random(), y: Math.random() };
    const flip = Math.floor(Math.random() * 4);

    let rects: DOMRect[] = [];
    let bounds = { width: 0, height: 0 };

    const measure = () => {
      const host = canvas.parentElement;
      if (!host) return;
      const hostRect = host.getBoundingClientRect();
      bounds = { width: hostRect.width, height: hostRect.height };
      canvas.width = Math.max(1, Math.round(hostRect.width * dpr));
      canvas.height = Math.max(1, Math.round(hostRect.height * dpr));
      if (mode === "media") {
        rects = [new DOMRect(0, 0, hostRect.width, hostRect.height)];
        return;
      }
      const runs = container?.querySelectorAll("[data-spoiler]") ?? [];
      const measured: DOMRect[] = [];
      for (const run of runs) {
        for (const rect of run.getClientRects()) {
          measured.push(
            new DOMRect(
              rect.left - hostRect.left,
              rect.top - hostRect.top,
              rect.width,
              rect.height,
            ),
          );
        }
      }
      // Raw client rects leave a hairline transparent stripe between wrapped
      // lines, which reads as a striped cover. Web K splits any gap of 2px or
      // less between its two neighbours (`adjustSpaceBetweenCloseRects`).
      measured.sort((a, b) => a.top - b.top || a.left - b.left);
      for (let index = 1; index < measured.length; index += 1) {
        const previous = measured[index - 1];
        const current = measured[index];
        const gap = current.top - previous.bottom;
        if (gap <= 0 || gap > LINE_GAP_PX) continue;
        const half = gap / 2;
        measured[index - 1] = new DOMRect(
          previous.left,
          previous.top,
          previous.width,
          previous.height + half,
        );
        measured[index] = new DOMRect(
          current.left,
          current.top - half,
          current.width,
          current.height + half,
        );
      }
      rects = measured;
    };

    const draw = () => {
      if (bounds.width === 0 || bounds.height === 0) return;
      const active = revealRef.current;
      const duration = active
        ? reduced
          ? REVEAL_REDUCED_MS
          : revealDuration(maxDistance(active.origin, rects))
        : 0;
      const linear = active
        ? Math.min(1, (performance.now() - active.started) / duration)
        : 0;
      const progress = active ? bezier(UNWRAP, linear) : 0;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.scale(dpr, dpr);

      if (mode === "text") {
        // The covered text stays in the document at full opacity: this fill is
        // what hides it, and punching the fill is what reveals it.
        context.fillStyle = surfaceColor(canvas);
        for (const rect of rects) {
          context.fillRect(rect.x, rect.y, rect.width, rect.height);
        }
      }

      const push =
        progress * progress * (mode === "text" ? PUSH_TEXT : PUSH_MEDIA);
      for (const rect of rects) {
        blitField(context, field.canvas, rect, offset, flip, dpr, push, active);
      }

      if (active) {
        const radius = maxDistance(active.origin, rects) * progress;
        // The hole's geometry is published on the host so a sibling layer —
        // the blurred thumbnail a media spoiler hides behind — can mask
        // itself with the same circle. Written imperatively because it
        // changes every frame; routing it through state would re-render the
        // whole bubble 60 times a second.
        const host = canvas.parentElement;
        if (host) {
          host.style.setProperty("--spoiler-x", `${active.origin.x}px`);
          host.style.setProperty("--spoiler-y", `${active.origin.y}px`);
          host.style.setProperty("--spoiler-r", `${radius}px`);
        }
        context.globalCompositeOperation = "destination-out";
        // The feather is the effect: a hard-edged circle reads as a wipe,
        // while a widening blurred edge reads as the cover dissolving.
        context.shadowColor = "#000";
        context.shadowBlur = radius / FEATHER_DIVISOR;
        context.beginPath();
        context.arc(active.origin.x, active.origin.y, radius, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
        context.globalCompositeOperation = "source-over";
        if (linear >= 1 && !revealedRef.current) {
          revealedRef.current = true;
          onRevealedRef.current();
        }
      }
    };

    measure();
    draw();

    const observer = new ResizeObserver(() => {
      measure();
      draw();
    });
    const host = canvas.parentElement;
    if (host) observer.observe(host);

    if (reduced) {
      // Frozen frame, not a frozen animation: the dots are painted once and
      // the loop never starts, but a reveal still has to redraw.
      context.setTransform(1, 0, 0, 1, 0, 0);
      const still = document.createElement("canvas");
      still.width = canvas.width;
      still.height = canvas.height;
      const stillContext = still.getContext("2d");
      if (stillContext) {
        paintStillField(stillContext, tile, color, dpr);
      }
      let frame = requestAnimationFrame(function tick() {
        drawStill(context, canvas, still, rects, mode, dpr);
        if (revealRef.current && !revealedRef.current) {
          draw();
          frame = requestAnimationFrame(tick);
        }
      });
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }

    const unsubscribe = field.subscribe(draw);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, [mode, container, revealFrom]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 size-full",
        className,
      )}
    />
  );
}

function drawStill(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  still: HTMLCanvasElement,
  rects: ReadonlyArray<DOMRect>,
  mode: "text" | "media",
  dpr: number,
): void {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.scale(dpr, dpr);
  if (mode === "text") {
    context.fillStyle = surfaceColor(canvas);
    for (const rect of rects) {
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }
  for (const rect of rects) {
    context.drawImage(
      still,
      0,
      0,
      still.width,
      still.height,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    );
  }
}

/**
 * Copies a slice of the shared field into one covered rect. `push` shrinks the
 * source window toward the reveal origin, which makes the dots appear to fly
 * outward from the finger instead of simply fading (`drawSpoilerRects`).
 */
function blitField(
  context: CanvasRenderingContext2D,
  field: HTMLCanvasElement,
  rect: DOMRect,
  offset: { x: number; y: number },
  flip: number,
  dpr: number,
  push: number,
  active: { origin: SpoilerRevealOrigin } | null,
): void {
  const sourceWidth = Math.min(field.width, Math.max(1, rect.width * dpr));
  const sourceHeight = Math.min(field.height, Math.max(1, rect.height * dpr));
  let sourceX = offset.x * (field.width - sourceWidth);
  let sourceY = offset.y * (field.height - sourceHeight);
  let width = sourceWidth;
  let height = sourceHeight;
  if (push > 0 && active) {
    // The window walks toward the origin and narrows, so the sampled dots
    // spread apart on screen.
    const originX = ((active.origin.x - rect.x) / rect.width) * sourceWidth;
    const originY = ((active.origin.y - rect.y) / rect.height) * sourceHeight;
    sourceX += originX * push;
    sourceY += originY * push;
    width = sourceWidth * (1 - push);
    height = sourceHeight * (1 - push);
  }
  context.save();
  context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  if (flip === 1) context.rotate(Math.PI);
  if (flip === 2) context.scale(-1, 1);
  if (flip === 3) context.scale(1, -1);
  context.drawImage(
    field,
    sourceX,
    sourceY,
    Math.max(1, width),
    Math.max(1, height),
    -rect.width / 2,
    -rect.height / 2,
    rect.width,
    rect.height,
  );
  context.restore();
}

/** Farthest corner of any covered rect, plus Web K's 20px margin. */
function maxDistance(
  origin: SpoilerRevealOrigin,
  rects: ReadonlyArray<DOMRect>,
): number {
  let max = 0;
  for (const rect of rects) {
    for (const [x, y] of [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.left, rect.bottom],
      [rect.right, rect.bottom],
    ]) {
      max = Math.max(max, Math.hypot(x - origin.x, y - origin.y));
    }
  }
  return max + 20;
}

function revealDuration(distance: number): number {
  return Math.max(
    REVEAL_MIN_MS,
    Math.sqrt(distance / REVEAL_DIST_DIVISOR) * REVEAL_DIST_SCALE,
  );
}

/**
 * Cubic-bezier value at `t`, by Newton iteration on the x component. Two
 * iterations are enough for a 600ms animation at 60fps; the error is far
 * below one frame's worth of progress.
 */
function bezier(
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  t: number,
): number {
  const curve = (a: number, b: number, value: number) => {
    const inverse = 1 - value;
    return (
      3 * inverse * inverse * value * a +
      3 * inverse * value * value * b +
      value ** 3
    );
  };
  let guess = t;
  for (let index = 0; index < 4; index += 1) {
    const x = curve(x1, x2, guess) - t;
    const slope =
      3 * (1 - guess) ** 2 * x1 +
      6 * (1 - guess) * guess * (x2 - x1) +
      3 * guess ** 2 * (1 - x2);
    if (Math.abs(slope) < 1e-6) break;
    guess -= x / slope;
  }
  return curve(y1, y2, Math.min(1, Math.max(0, guess)));
}

/**
 * The dot colour, read from the element's own computed colour so the cover
 * follows the theme without a second source of truth. A canvas cannot resolve
 * `currentColor`, so it is resolved here.
 */
function particleColor(canvas: HTMLCanvasElement): string {
  return window.getComputedStyle(canvas).color;
}

/**
 * The surface the covered text sits on, resolved by walking ancestors until
 * one has a non-transparent background. A translucent bubble would otherwise
 * leave the fill visibly grey against the chat behind it.
 */
function surfaceColor(canvas: HTMLCanvasElement): string {
  let node: HTMLElement | null = canvas.parentElement;
  for (let depth = 0; node && depth < 10; depth += 1) {
    const background = window.getComputedStyle(node).backgroundColor;
    if (background && !isTransparent(background)) return background;
    node = node.parentElement;
  }
  return window.getComputedStyle(document.body).backgroundColor;
}

function isTransparent(color: string): boolean {
  if (color === "transparent") return true;
  const match = /rgba?\([^)]*,\s*([\d.]+)\s*\)/.exec(color);
  return match ? Number(match[1]) === 0 : false;
}
