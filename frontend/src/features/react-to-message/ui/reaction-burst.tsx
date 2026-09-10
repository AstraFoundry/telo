import { motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useMemo } from "react";

import { EASE_OUT } from "shared/ui";
export interface ReactionBurstProps {
  readonly emoji: string;
  /** Unique per burst; seeds the particle spread deterministically. */
  readonly seed: number;
  onDone(): void;
}

interface ParticleVector {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly delay: number;
}

const PARTICLE_COUNT = 6;

/**
 * Telegram's reaction feedback: tapping a chip bursts the glyph above it —
 * the emoji pops to roughly twice its size while a ring of particles sprays
 * outward (iOS/Android `ReactionEffect`). One burst instance per tap, retired
 * by its own completion, so rapid re-taps stack cleanly instead of
 * restarting a shared animation.
 *
 * Frequency is per-tap and the purpose is feedback, so the whole thing stays
 * inside 550ms, transform/opacity only. Reduced motion keeps the pop as a
 * 200ms opacity fade and drops the particles entirely.
 */
export function ReactionBurst({ emoji, seed, onDone }: ReactionBurstProps) {
  const reduce = useReducedMotionConfig() ?? false;
  // Retire by lifetime, not onAnimationComplete: the parent's reaction
  // upsert re-renders mid-flight and the retargeted keyframe animation can
  // drop its completion callback, stranding the finished glyph.
  useEffect(() => {
    const lifetime = window.setTimeout(onDone, reduce ? 220 : 600);
    return () => window.clearTimeout(lifetime);
  }, [onDone, reduce]);
  const particles = useMemo<ReadonlyArray<ParticleVector>>(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        // Deterministic pseudo-random from the seed: Math.random() during
        // render is impure, and a stable spread per burst is all we need.
        const rand = (n: number) => {
          const value =
            Math.sin(seed * 127.1 + i * 311.7 + n * 74.7) * 43758.5453;
          return value - Math.floor(value);
        };
        const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + rand(1) * 0.5;
        const distance = 22 + rand(2) * 14;
        return {
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance - 10,
          size: 3 + rand(3) * 2,
          delay: 0.06 + rand(4) * 0.06,
        };
      }),
    [seed],
  );

  if (reduce) {
    return (
      <motion.span
        className="pointer-events-none absolute inset-x-0 -top-3 z-10 text-center text-lg leading-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0] }}
        transition={{ duration: 0.2, ease: EASE_OUT }}
        onAnimationComplete={onDone}
      >
        {emoji}
      </motion.span>
    );
  }

  return (
    <span className="pointer-events-none absolute inset-x-0 -top-3 z-10 grid place-items-center">
      <motion.span
        className="text-lg leading-none [font-variant-emoji:emoji]"
        initial={{ opacity: 0, transform: "translateY(8px) scale(0.4)" }}
        animate={{
          opacity: [0, 1, 1, 0],
          transform: [
            "translateY(8px) scale(0.4)",
            "translateY(-4px) scale(1.15)",
            "translateY(-14px) scale(2.2)",
            "translateY(-30px) scale(2.4)",
          ],
        }}
        transition={{
          duration: 0.55,
          ease: EASE_OUT,
          times: [0, 0.3, 0.55, 1],
        }}
        onAnimationComplete={onDone}
      >
        {emoji}
      </motion.span>
      {particles.map((vector, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-primary"
          style={{ width: vector.size, height: vector.size }}
          initial={{ opacity: 1, transform: "translate(0px, 0px) scale(1)" }}
          animate={{
            opacity: [1, 1, 0],
            transform: `translate(${vector.x}px, ${vector.y}px) scale(0.4)`,
          }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: vector.delay }}
        />
      ))}
    </span>
  );
}
