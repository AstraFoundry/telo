import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";

import { cn } from "@/shared/lib/cn";

import { EASE_OUT } from "./motion";

export interface ErrorRowProps {
  /** The failure text; null hides the row, which animates out first. */
  readonly message: string | null;
  readonly className?: string;
}

/**
 * Inline form error with the composer's failure-row recipe: the row animates
 * height as well as opacity so the dialog's footer buttons glide instead of
 * jumping the instant a submit fails. Reduced motion keeps the opacity fade
 * only. Rendered unconditionally — pass `message={error}` and let the
 * AnimatePresence inside handle mount and exit.
 */
export function ErrorRow({ message, className }: ErrorRowProps) {
  const reduce = useReducedMotionConfig() ?? false;
  return (
    <AnimatePresence initial={false}>
      {message ? (
        <motion.div
          key="error-row"
          initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{
            duration: reduce ? 0.12 : 0.18,
            ease: EASE_OUT,
            opacity: { duration: reduce ? 0.12 : 0.14 },
          }}
          className="overflow-hidden"
        >
          <p role="alert" className={cn("text-sm text-destructive", className)}>
            {message}
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
