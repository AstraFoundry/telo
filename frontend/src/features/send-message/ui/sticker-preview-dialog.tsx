import { Star } from "@phosphor-icons/react";

import type { StickerItemDto } from "../../../../../contracts/src/ipc";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  Sticker,
} from "shared/ui";

export interface StickerPreviewDialogLabels {
  readonly preview: string;
  readonly sticker: string;
  readonly playSticker: string;
  readonly send: string;
  readonly addFavorite: string;
  readonly removeFavorite: string;
  readonly close: string;
}

export interface StickerPreviewDialogProps {
  readonly sticker: StickerItemDto | null;
  readonly src: string | null;
  readonly favorite: boolean;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly labels: StickerPreviewDialogLabels;
  onClose(): void;
  onSend(sticker: StickerItemDto): void;
  onToggleFavorite(sticker: StickerItemDto, favorite: boolean): void;
}

export function StickerPreviewDialog({
  sticker,
  src,
  favorite,
  busy = false,
  error = null,
  labels,
  onClose,
  onSend,
  onToggleFavorite,
}: StickerPreviewDialogProps) {
  return (
    <CenterMorphModal
      open={sticker !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <CenterMorphModalContent
        ariaLabel={labels.preview}
        closeButtonLabel={labels.close}
        className="w-fit"
      >
        {sticker ? (
          <div className="flex w-72 flex-col items-center gap-4 p-5">
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
              label={labels.sticker}
              playLabel={labels.playSticker}
              maxSize={220}
            />
            {sticker.emoji ? (
              <span className="text-sm text-muted-foreground">
                {sticker.emoji}
              </span>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex w-full gap-2">
              <Button
                variant="ghost"
                disabled={busy}
                aria-label={
                  favorite ? labels.removeFavorite : labels.addFavorite
                }
                className="shrink-0"
                onClick={() => onToggleFavorite(sticker, !favorite)}
              >
                <Star
                  aria-hidden="true"
                  weight={favorite ? "fill" : "regular"}
                  className="size-4"
                />
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                className="flex-1"
                onClick={() => onSend(sticker)}
              >
                {labels.send}
              </Button>
            </div>
          </div>
        ) : null}
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
