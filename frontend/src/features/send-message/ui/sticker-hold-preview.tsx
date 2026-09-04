import { createPortal } from "react-dom";

import type { StickerItemDto } from "../../../../../contracts/src/ipc";
import { Sticker } from "shared/ui";

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
  if (!sticker) return null;
  return createPortal(
    <div
      aria-hidden="true"
      data-slot="sticker-hold-preview"
      data-preview-sticker-id={sticker.id}
      // Layer order: popover 9999, context menu 10000, modal 10001, then the
      // transient sticker preview. The body portal keeps this out of every
      // local stacking context.
      className="pointer-events-none fixed inset-0 z-[10002] flex items-center justify-center bg-background/40"
    >
      <div className="rounded-2xl bg-popover p-5 shadow-xl">
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
      </div>
    </div>,
    document.body,
  );
}
