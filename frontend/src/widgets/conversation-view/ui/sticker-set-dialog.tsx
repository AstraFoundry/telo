import { useEffect, useState } from "react";

import type {
  StickerItemDto,
  StickerSetDto,
} from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  Skeleton,
  SkeletonGroup,
  Sticker,
} from "shared/ui";

/** The sheet's grid cell, matching the composer picker's measure. */
const CELL_PX = 72;
const STICKER_PX = 64;

interface StickerSetDialogProps {
  /** Short name of the set to show; null closes the sheet. */
  shortName: string | null;
  onClose(): void;
}

function SetSticker({
  sticker,
  onPick,
}: {
  readonly sticker: StickerItemDto;
  onPick(sticker: StickerItemDto): void;
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
    <Button
      size="icon"
      variant="ghost"
      aria-label={sticker.emoji ?? copy.sticker}
      className="rounded-lg p-1"
      style={{ width: CELL_PX, height: CELL_PX }}
      onClick={() => onPick(sticker)}
    >
      <Sticker
        sticker={{
          emoji: sticker.emoji,
          format: sticker.format,
          setName: null,
          outlinePath: sticker.outlinePath,
        }}
        width={sticker.width}
        height={sticker.height}
        src={download?.state === "ready" ? download.url : null}
        label={copy.sticker}
        playLabel={copy.playSticker}
        maxSize={STICKER_PX}
        still
      />
    </Button>
  );
}

/**
 * Telegram opens a sticker's set when you tap it: the whole pack, an add or
 * remove action, and every sticker in it sendable. A set reached this way may
 * not be installed, which is the point of the action.
 */
export function StickerSetDialog({
  shortName,
  onClose,
}: StickerSetDialogProps) {
  const sendSticker = useChatStore((state) => state.sendSticker);
  const [set, setSet] = useState<StickerSetDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Each open refetches: the set may have been installed or removed since,
  // and the sheet is rare enough that a stale cache would cost more than the
  // round trip saves.
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (shortName !== openFor) {
    setOpenFor(shortName);
    setSet(null);
    setLoadError(null);
    setBusy(false);
  }

  useEffect(() => {
    if (!shortName) return;
    let cancelled = false;
    void window.telo.workspace.getStickerSet(shortName).then(
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
  }, [shortName]);

  const toggleInstalled = async () => {
    if (!set) return;
    setBusy(true);
    try {
      await window.telo.workspace.setStickerSetInstalled(
        set.shortName,
        !set.installed,
      );
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

  return (
    <CenterMorphModal
      open={shortName !== null}
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
                <div className="flex flex-wrap gap-0.5">
                  {set.stickers.map((sticker) => (
                    <SetSticker
                      key={sticker.id}
                      sticker={sticker}
                      onPick={pick}
                    />
                  ))}
                </div>
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
    </CenterMorphModal>
  );
}
