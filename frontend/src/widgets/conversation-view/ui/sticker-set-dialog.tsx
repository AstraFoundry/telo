import { useEffect, useState } from "react";

import type {
  StickerItemDto,
  StickerSetDto,
  StickerSetReferenceDto,
} from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import {
  StickerGridCell,
  StickerHoldPreview,
  StickerPreviewDialog,
  StickerPreviewGesture,
} from "features/send-message";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  Skeleton,
  SkeletonGroup,
} from "shared/ui";

/** The sheet's grid cell, matching the composer picker's measure. */
const CELL_PX = 72;
const STICKER_PX = 64;

interface StickerSetDialogProps {
  /** Telegram set reference carried by the received sticker. */
  reference: StickerSetReferenceDto | null;
  onClose(): void;
}

function SetSticker({
  sticker,
  favorite,
  onPick,
  onPreview,
  onToggleFavorite,
}: {
  readonly sticker: StickerItemDto;
  readonly favorite: boolean;
  onPick(sticker: StickerItemDto): void;
  onPreview(sticker: StickerItemDto): void;
  onToggleFavorite(sticker: StickerItemDto, favorite: boolean): void;
}) {
  const download = useChatStore(
    (state) => state.mediaDownloads[sticker.id] ?? null,
  );
  const downloadMedia = useChatStore((state) => state.downloadMedia);
  const needsDownload = download === null;

  useEffect(() => {
    if (needsDownload) void downloadMedia(sticker.id);
  }, [needsDownload, downloadMedia, sticker.id]);

  return (
    <StickerGridCell
      sticker={sticker}
      src={download?.state === "ready" ? download.url : null}
      favorite={favorite}
      labels={{
        sticker: copy.sticker,
        playSticker: copy.playSticker,
        previewSticker: copy.previewSticker,
        addFavorite: copy.addFavoriteSticker,
        removeFavorite: copy.removeFavoriteSticker,
        removeRecent: copy.removeRecentSticker,
      }}
      onPick={onPick}
      onPreview={onPreview}
      onToggleFavorite={onToggleFavorite}
    />
  );
}

/**
 * Telegram opens a sticker's set when you tap it: the whole pack, an add or
 * remove action, and every sticker in it sendable. A set reached this way may
 * not be installed, which is the point of the action.
 */
export function StickerSetDialog({
  reference,
  onClose,
}: StickerSetDialogProps) {
  const sendSticker = useChatStore((state) => state.sendSticker);
  const favoriteStickers = useChatStore((state) => state.favoriteStickers);
  const setStickerFavorite = useChatStore((state) => state.setStickerFavorite);
  const setStickerSetInstalled = useChatStore(
    (state) => state.setStickerSetInstalled,
  );
  const [set, setSet] = useState<StickerSetDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StickerItemDto | null>(null);
  const [heldPreview, setHeldPreview] = useState<StickerItemDto | null>(null);
  const favoriteIds = new Set(favoriteStickers.map((sticker) => sticker.id));
  const previewDownload = useChatStore((state) =>
    preview ? (state.mediaDownloads[preview.id] ?? null) : null,
  );
  const heldPreviewDownload = useChatStore((state) =>
    heldPreview ? (state.mediaDownloads[heldPreview.id] ?? null) : null,
  );

  // Each open refetches: the set may have been installed or removed since,
  // and the sheet is rare enough that a stale cache would cost more than the
  // round trip saves.
  const referenceKey = reference ? JSON.stringify(reference) : null;
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (referenceKey !== openFor) {
    setOpenFor(referenceKey);
    setSet(null);
    setLoadError(null);
    setBusy(false);
  }

  useEffect(() => {
    if (!reference) return;
    let cancelled = false;
    void window.telo.workspace.getStickerSet(reference).then(
      (next) => {
        if (!cancelled) setSet(next);
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reference, referenceKey]);

  const toggleInstalled = async () => {
    if (!set) return;
    setBusy(true);
    try {
      await setStickerSetInstalled(set, !set.installed);
      setSet({ ...set, installed: !set.installed });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const pick = (sticker: StickerItemDto) => {
    void sendSticker(sticker);
    onClose();
  };

  const toggleFavorite = async (sticker: StickerItemDto, favorite: boolean) => {
    setBusy(true);
    setLoadError(null);
    try {
      await setStickerFavorite(sticker, favorite);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenterMorphModal
      open={reference !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <CenterMorphModalContent
        ariaLabel={set?.title ?? copy.stickerPicker}
        closeButtonLabel={copy.closeDialog}
      >
        <div className="flex max-h-[60vh] flex-col p-3">
          {/* deslop-ignore-next-line 12 */}
          <h2 className="px-2.5 pt-1 pb-2 text-base font-semibold">
            {set?.title ?? copy.stickerPicker}
          </h2>
          {loadError ? (
            <p role="alert" className="px-2.5 py-6 text-sm text-destructive">
              {copy.failed}: {loadError}
            </p>
          ) : set === null ? (
            /* The sheet is about to be a wall of same-size cells, so the
               placeholder is that wall. Two rows is the shortest set worth
               opening, which keeps the sheet from shrinking when the real
               grid lands. */
            <SkeletonGroup
              label={copy.loadingStickerSet}
              className="flex flex-wrap gap-0.5 px-1.5 py-1"
            >
              {Array.from({ length: 8 }, (_, index) => (
                <div
                  key={index}
                  className="grid place-items-center"
                  style={{ width: CELL_PX, height: CELL_PX }}
                >
                  <Skeleton
                    rounded
                    style={{ width: STICKER_PX, height: STICKER_PX }}
                  />
                </div>
              ))}
            </SkeletonGroup>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-1.5">
                <StickerPreviewGesture
                  stickers={set.stickers}
                  onPreview={setHeldPreview}
                >
                  <div className="flex flex-wrap gap-0.5">
                    {set.stickers.map((sticker) => (
                      <SetSticker
                        key={sticker.id}
                        sticker={sticker}
                        favorite={favoriteIds.has(sticker.id)}
                        onPick={pick}
                        onPreview={setPreview}
                        onToggleFavorite={(item, favorite) =>
                          void toggleFavorite(item, favorite)
                        }
                      />
                    ))}
                  </div>
                </StickerPreviewGesture>
              </div>
              <div className="px-2.5 pt-3">
                <Button
                  variant={set.installed ? "ghost" : "primary"}
                  disabled={busy}
                  className="w-full"
                  onClick={() => void toggleInstalled()}
                >
                  {set.installed ? copy.removeStickerSet : copy.addStickerSet}
                </Button>
              </div>
            </>
          )}
        </div>
      </CenterMorphModalContent>
      <StickerPreviewDialog
        sticker={preview}
        src={previewDownload?.state === "ready" ? previewDownload.url : null}
        favorite={preview ? favoriteIds.has(preview.id) : false}
        busy={busy}
        error={loadError}
        labels={{
          preview: copy.previewSticker,
          sticker: copy.sticker,
          playSticker: copy.playSticker,
          send: copy.sendSticker,
          addFavorite: copy.addFavoriteSticker,
          removeFavorite: copy.removeFavoriteSticker,
          close: copy.closeDialog,
        }}
        onClose={() => {
          setPreview(null);
          setLoadError(null);
        }}
        onSend={(sticker) => {
          setPreview(null);
          pick(sticker);
        }}
        onToggleFavorite={(sticker, favorite) =>
          void toggleFavorite(sticker, favorite)
        }
      />
      <StickerHoldPreview
        sticker={heldPreview}
        src={
          heldPreviewDownload?.state === "ready"
            ? heldPreviewDownload.url
            : null
        }
        label={copy.sticker}
        playLabel={copy.playSticker}
      />
    </CenterMorphModal>
  );
}
