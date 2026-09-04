import { Eye, Star, X } from "@phosphor-icons/react";

import type { StickerItemDto } from "../../../../../contracts/src/ipc";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Sticker,
} from "shared/ui";

const CELL_PX = 72;
const STICKER_PX = 64;

export interface StickerGridCellLabels {
  readonly sticker: string;
  readonly playSticker: string;
  readonly previewSticker: string;
  readonly addFavorite: string;
  readonly removeFavorite: string;
  readonly removeRecent: string;
}

export interface StickerGridCellProps {
  readonly sticker: StickerItemDto;
  readonly src: string | null;
  readonly labels: StickerGridCellLabels;
  readonly favorite: boolean;
  readonly removeFromRecent?: boolean;
  onPick(sticker: StickerItemDto): void;
  onPreview(sticker: StickerItemDto): void;
  onToggleFavorite(sticker: StickerItemDto, favorite: boolean): void;
  onRemoveRecent?(sticker: StickerItemDto): void;
}

/**
 * A sendable sticker cell with Telegram-style secondary actions. A click
 * sends; right-click or keyboard opens preview/favorite/recent actions. The
 * surrounding grid owns Telegram's hold-and-slide preview gesture.
 */
export function StickerGridCell({
  sticker,
  src,
  labels,
  favorite,
  removeFromRecent = false,
  onPick,
  onPreview,
  onToggleFavorite,
  onRemoveRecent,
}: StickerGridCellProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger touchLongPress={false}>
        <Button
          size="icon"
          variant="ghost"
          aria-label={sticker.emoji ?? labels.sticker}
          data-sticker-id={sticker.id}
          className="rounded-lg p-1"
          style={{ width: CELL_PX, height: CELL_PX }}
          onDragStart={(event) => event.preventDefault()}
          onClick={() => onPick(sticker)}
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
            label={labels.sticker}
            playLabel={labels.playSticker}
            maxSize={STICKER_PX}
            still
          />
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onPreview(sticker)}>
          <Eye aria-hidden="true" className="size-4" />
          {labels.previewSticker}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onToggleFavorite(sticker, !favorite)}>
          <Star
            aria-hidden="true"
            weight={favorite ? "fill" : "regular"}
            className="size-4"
          />
          {favorite ? labels.removeFavorite : labels.addFavorite}
        </ContextMenuItem>
        {removeFromRecent && onRemoveRecent ? (
          <ContextMenuItem onSelect={() => onRemoveRecent(sticker)}>
            <X aria-hidden="true" className="size-4" />
            {labels.removeRecent}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
