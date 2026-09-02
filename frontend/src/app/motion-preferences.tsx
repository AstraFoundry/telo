import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

import { useReduceMotion } from "entities/preferences";

/**
 * App-wide motion restraint. Every animated surface asks Motion for the
 * reader's preference through `useReducedMotionConfig()`, which resolves
 * against this provider, so the stored preference reaches all of them without
 * a single component knowing the preference exists. `motion` components take
 * the same setting for their own animations.
 *
 * The override only ever adds restraint: `"user"` leaves the OS
 * `prefers-reduced-motion` setting authoritative, so a preference that is off
 * never puts motion back in front of a reader who asked the system for less.
 */
export function MotionPreferences({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { value: reduceMotion } = useReduceMotion();

  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
      {children}
    </MotionConfig>
  );
}
