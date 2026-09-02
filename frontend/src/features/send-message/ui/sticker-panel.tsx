import { useEffect, useState } from "react";

import type {
  StickerItemDto,
  StickerSetDto,
} from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { Button, Sticker } from "shared/ui";

/** Telegram's picker cell; the sticker sits inside with a little breathing room. */
const CELL_PX = 72;
const STICKER_PX = 64;

export interface StickerPanelProps {
  /** The sets load the first time the section is actually shown. */
  readonly active: boolean;
  onPick(sticker: StickerItemDto): void;
}

function StickerCell({
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

  // Set stickers ride the same media pipeline as message media, so the cell
  // asks for its own document and reads the shared download slot.
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
        }}
        width={sticker.width}
        height={sticker.height}
        src={download?.state === "ready" ? download.url : null}
        label={copy.sticker}
        playLabel={copy.playSticker}
        maxSize={STICKER_PX}
        // A grid of looping animations is the repeated attention cost motion
        // restraint exists to prevent, and a screenful of simultaneous
        // players is a real frame budget. Cells hold their first frame.
        still
      />
    </Button>
  );
}

/**
 * Sticker section of the composer's media picker: one tab per installed set
 * and a grid of that set's stickers. The sets load on first reveal rather than
 * at mount, because most sessions never open the picker and each set costs a
 * round trip.
 */
export function StickerPanel({ active, onPick }: StickerPanelProps) {
  const [sets, setSets] = useState<ReadonlyArray<StickerSetDto> | null>(null);
  const [activeSet, setActiveSet] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || sets !== null) return;
    let cancelled = false;
    void window.telo.workspace.listStickerSets().then(
      (next) => {
        if (cancelled) return;
        setSets(next);
        setActiveSet(next[0]?.shortName ?? null);
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, sets]);

  const current = sets?.find((set) => set.shortName === activeSet) ?? null;

  return (
    <>
      {loadError ? (
        <p
          role="alert"
          className="px-2 py-6 text-center text-sm text-destructive"
        >
          {copy.failed}: {loadError}
        </p>
      ) : sets === null ? (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">
          {copy.loading}
        </p>
      ) : sets.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">
          {copy.noStickerSets}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="max-h-72 overflow-y-auto">
            <div className="flex flex-wrap gap-0.5">
              {current?.stickers.map((sticker) => (
                <StickerCell
                  key={sticker.id}
                  sticker={sticker}
                  onPick={onPick}
                />
              ))}
            </div>
          </div>
          {sets.length > 1 ? (
            <div className="flex items-center gap-0.5 overflow-x-auto border-t border-border pt-1.5">
              {sets.map((set) => (
                <Button
                  key={set.shortName}
                  size="icon"
                  variant={set.shortName === activeSet ? "secondary" : "ghost"}
                  aria-label={set.title}
                  aria-pressed={set.shortName === activeSet}
                  onClick={() => setActiveSet(set.shortName)}
                >
                  <span aria-hidden="true" className="text-lg leading-none">
                    {set.stickers[0]?.emoji ?? "🙂"}
                  </span>
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
