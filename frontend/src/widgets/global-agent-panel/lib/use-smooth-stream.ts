import { useReducedMotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** Slowest reveal, in characters per second, so a trickle still reads as typing. */
const MIN_RATE = 45;
/** Fastest reveal; above this the text visibly teleports. */
const MAX_RATE = 900;
/**
 * How hard the reveal leans on its backlog. A larger buffer speeds the
 * reveal up so it never falls far behind the provider, a small one slows it
 * down so the last characters do not snap into place.
 */
const CATCH_UP_PER_SECOND = 5;
/** A background tab hands back one huge frame; cap it so text does not jump. */
const MAX_FRAME_MS = 64;

/**
 * Turns bursty streaming deltas into an even character-by-character reveal.
 * Providers hand over tokens in irregular chunks; painting each chunk as it
 * lands makes the reply stutter. The reveal runs on `requestAnimationFrame`
 * at a rate proportional to the unrevealed backlog, so it stays a beat
 * behind the stream and catches up smoothly, then completes as soon as the
 * stream ends. Returns how many of `length` characters to show; reduced
 * motion and settled text show everything.
 */
export function useSmoothReveal(length: number, streaming: boolean): number {
  const reduce = useReducedMotionConfig() ?? false;
  const animated = streaming && !reduce;
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const carryRef = useRef(0);

  useEffect(() => {
    if (!animated) {
      // Nothing to animate; keep the counter caught up so a later stream in
      // this slot does not replay the settled text.
      shownRef.current = length;
      return;
    }
    // A shorter target means a different message landed in this slot.
    if (shownRef.current > length) shownRef.current = 0;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const seconds = Math.min(now - last, MAX_FRAME_MS) / 1000;
      last = now;
      const backlog = length - shownRef.current;
      if (backlog <= 0) return;
      const rate = Math.min(
        Math.max(backlog * CATCH_UP_PER_SECOND, MIN_RATE),
        MAX_RATE,
      );
      carryRef.current += rate * seconds;
      const step = Math.floor(carryRef.current);
      if (step > 0) {
        carryRef.current -= step;
        shownRef.current = Math.min(length, shownRef.current + step);
        setShown(shownRef.current);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [length, animated]);

  if (!animated) return length;
  return Math.min(shown, length);
}

/** `useSmoothReveal` applied to a string: the revealed prefix of `target`. */
export function useSmoothStream(target: string, streaming: boolean): string {
  const shown = useSmoothReveal(target.length, streaming);
  return target.slice(0, shown);
}
