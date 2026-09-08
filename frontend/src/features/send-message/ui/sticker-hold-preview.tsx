import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { createPortal } from "react-dom";

import type { StickerItemDto } from "../../../../../contracts/src/ipc";
import { EASE_OUT, Sticker } from "shared/ui";

export interface StickerHoldPreviewProps {
  readonly sticker: StickerItemDto | null;
  readonly src: string | null;
  readonly label: string;
  readonly playLabel: string;
}

/** A transient, non-interactive preview that never blocks gesture hit tests. */
export function StickerHoldPreview({
  sticker,
  src,
  label,
  playLabel,
}: StickerHoldPreviewProps) {
  const reduce = useReducedMotionConfig();
  // The portal stays mounted for the panel's lifetime: unmounting it would
  // tear the exit animation off with it, and a long press releases often
  // enough that the fade is the whole affordance.
  return createPortal(
    <AnimatePresence>
      {sticker ? (
        <motion.div
          key="sticker-hold-preview"
          aria-hidden="true"
          data-slot="sticker-hold-preview"
          data-preview-sticker-id={sticker.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.1 : 0.14, ease: EASE_OUT }}
          // Layer order: popover 9999, context menu 10000, modal 10001, then
          // the transient sticker preview. The body portal keeps this out of
          // every local stacking context.
          className="pointer-events-none fixed inset-0 z-[10002] flex items-center justify-center bg-background/40"
        >
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: reduce ? 0.1 : 0.16, ease: EASE_OUT }}
            className="rounded-2xl bg-popover p-5 shadow-xl"
          >
            <Sticker
              sticker={{
                emoji: sticker.emoji,
                format: sticker.format,
                setReference: null,
                outlinePath: sticker.outlinePath,
              }}
              width={sticker.width}
              height={sticker.height}
              src={src}
              label={label}
              playLabel={playLabel}
              maxSize={220}
            />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
