"use client";
// beui.dev/components/motion/range-slider
// Vendored with `use-slider` inlined below (the shared beui `lib/hooks`
// directory is owned outside this change); behavior is unchanged from
// upstream.

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { SPRING_GLIDE, SPRING_PRESS } from "@beui-lib/ease";
import {
  capturePointer,
  releasePointer,
  TOUCH_GESTURE_CLASS,
} from "@beui-lib/touch";
import { cn } from "@/shared/lib/cn";

// --- Inlined from beui lib/hooks/use-slider.ts -----------------------------

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Nearest legal value on [min, max] for the given step. max counts as a
 * candidate when the step does not divide the range, so a pointer near the end
 * does not snap back onto the last whole step. */
export function snapSliderValue(
  next: number,
  min: number,
  max: number,
  step: number,
): number {
  // Neither case has a grid to walk. An empty range has exactly one legal
  // point, and a non-positive step only needs a clamp, which also keeps the
  // division below away from zero.
  if (!(max > min)) return min;
  if (!(step > 0)) return clamp(next, min, max);
  const whole = Math.floor(Number(((max - min) / step).toFixed(6)));
  const lastWhole = Number((min + whole * step).toFixed(6));
  const toGrid = clamp(
    Math.round((next - min) / step) * step + min,
    min,
    lastWhole,
  );
  const snapped =
    lastWhole < max && Math.abs(next - max) <= Math.abs(next - toGrid)
      ? max
      : toGrid;
  return Number(snapped.toFixed(6));
}

export interface SliderOptions {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  "aria-label"?: string;
  /** Announced instead of the raw number — pass one when the value carries a
   * unit or a suffix ("72.5 kg", "35%"); a bare number needs no valueText. */
  formatValueText?: (value: number) => string;
}

/**
 * Shared value + input plumbing for slider designs: controlled/uncontrolled
 * value, step snapping, pointer-capture drag along a track and arrow-key
 * control. Visuals and motion live in the component; this only owns the number.
 */
function useSlider({
  value,
  defaultValue = 0,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  "aria-label": ariaLabel,
  formatValueText,
}: SliderOptions) {
  const trackRef = useRef<HTMLDivElement>(null);
  const sliderEl = useRef<HTMLElement | null>(null);
  // The state drives visuals. Move reads this ref instead, so the first
  // pointermove after pointerdown does not have to wait on a re-render.
  const draggingRef = useRef(false);
  const [internal, setInternal] = useState(defaultValue);
  const [dragging, setDragging] = useState(false);
  const controlled = value !== undefined;
  // Collapse inverted or empty ranges and non-positive steps here, so that
  // percent, ticks and the keyboard maths never divide by zero or walk a
  // NaN grid.
  const lo = min;
  const hi = max > min ? max : min;
  const stride = step > 0 ? step : 1;
  const current = clamp(controlled ? value : internal, lo, hi);
  const percent = hi > lo ? ((current - lo) / (hi - lo)) * 100 : 0;

  const commit = useCallback(
    (next: number) => {
      const clean = snapSliderValue(next, lo, hi, stride);
      if (!controlled) setInternal(clean);
      onValueChange?.(clean);
    },
    [controlled, onValueChange, lo, hi, stride],
  );

  const commitFromX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      commit(lo + ratio * (hi - lo));
    },
    [commit, lo, hi],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      // Start the drag first: capture is a convenience, and a browser that
      // refuses it — or a test DOM that has no pointer capture at all — must
      // not take the drag down with it.
      draggingRef.current = true;
      setDragging(true);
      capturePointer(event.currentTarget, event.pointerId);
      // A click on the track should land keyboard focus on the handle.
      sliderEl.current?.focus({ preventScroll: true });
      commitFromX(event.clientX);
    },
    [disabled, commitFromX],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current || disabled) return;
      commitFromX(event.clientX);
    },
    [disabled, commitFromX],
  );

  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    releasePointer(event.currentTarget, event.pointerId);
    draggingRef.current = false;
    setDragging(false);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (disabled) return;
      const map: Record<string, number> = {
        ArrowRight: current + stride,
        ArrowUp: current + stride,
        ArrowLeft: current - stride,
        ArrowDown: current - stride,
        PageUp: current + stride * 10,
        PageDown: current - stride * 10,
        Home: lo,
        End: hi,
      };
      if (event.key in map) {
        event.preventDefault();
        commit(map[event.key]);
      }
    },
    [disabled, current, stride, lo, hi, commit],
  );

  return {
    current,
    percent,
    dragging,
    min: lo,
    max: hi,
    step: stride,
    commit,
    /** Pointer handlers for the track element — drag anywhere on it. */
    trackProps: {
      ref: trackRef,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onLostPointerCapture: endDrag,
    },
    /** ARIA + keyboard props for the focusable slider element. */
    sliderProps: {
      // Callback keeps the handle typed across button/div/motion hosts.
      ref: (node: HTMLElement | null) => {
        sliderEl.current = node;
      },
      role: "slider" as const,
      tabIndex: disabled ? -1 : 0,
      "aria-label": ariaLabel,
      "aria-valuemin": lo,
      "aria-valuemax": hi,
      "aria-valuenow": current,
      "aria-valuetext": formatValueText?.(current),
      "aria-disabled": disabled || undefined,
      onKeyDown,
    },
  };
}

// --- Component (upstream components/motion/range-slider.tsx) ---------------

export interface RangeSliderProps extends SliderOptions {
  /** Render a tick dot at each step. */
  showTicks?: boolean;
  className?: string;
}

export function RangeSlider({
  showTicks = true,
  className,
  ...options
}: RangeSliderProps) {
  const reduce = useReducedMotion();
  const { percent, dragging, min, max, step, trackProps, sliderProps } =
    useSlider(options);

  // Spring-smoothed position drives both the thumb and the fill.
  const target = useMotionValue(percent);
  useEffect(() => {
    target.set(percent);
  }, [percent, target]);
  const smooth = useSpring(target, SPRING_GLIDE);
  const pos = reduce ? target : smooth;
  const left = useMotionTemplate`${pos}%`;
  // Self-offset the thumb from 0% (flush left) to -100% (flush right) of its
  // own width so it stays fully inside the track at both ends — no clip, no gap.
  const thumbX = useTransform(pos, (p) => `${-p}%`);

  // Floor rather than round, so a range the step does not divide (0 to 10 by 4)
  // stops its dots at the last whole step instead of drawing one past max.
  // toFixed comes first because 0.3/0.1 is 2.9999999999999996, which would
  // floor to 2 and drop the last dot.
  const steps = Math.floor(Number(((max - min) / step).toFixed(6)));
  const ticks =
    showTicks && steps > 0 && steps <= 50
      ? Array.from({ length: steps + 1 }, (_, i) =>
          Number((min + i * step).toFixed(6)),
        )
      : [];

  return (
    <div
      {...trackProps}
      className={cn(
        "relative flex h-10 w-full touch-none items-center overflow-hidden rounded-lg bg-muted",
        TOUCH_GESTURE_CLASS,
        options.disabled
          ? "pointer-events-none opacity-50"
          : "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      {/* fill — runs from the left edge to the thumb, consistent tone */}
      <motion.div
        className="absolute inset-y-0 left-0 bg-foreground/15"
        style={{ width: left }}
      />

      {/* Ticks, inset by half the thumb's width. That inset is the span the
          thumb's own centre travels, so a dot sits where the thumb lands. */}
      <div className="pointer-events-none absolute inset-x-[3px] inset-y-0">
        {ticks.map((t) => {
          const tp = ((t - min) / (max - min)) * 100;
          return (
            <span
              key={t}
              className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/25"
              style={{ left: `${tp}%` }}
            />
          );
        })}
      </div>

      {/* vertical bar thumb — contained at both ends via thumbX */}
      <motion.div
        {...sliderProps}
        animate={reduce ? undefined : { scaleY: dragging ? 1.35 : 1 }}
        transition={SPRING_PRESS}
        className="absolute top-1/2 h-5 w-1.5 rounded-sm bg-foreground shadow-sm outline-none ring-inset ring-foreground/30 focus-visible:ring-4"
        style={{ left, x: thumbX, y: "-50%" }}
      />
    </div>
  );
}
