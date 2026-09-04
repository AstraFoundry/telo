import {
  ArrowsDownUp,
  CaretDown,
  CaretUp,
  Check,
  ClockCounterClockwise,
  MagnifyingGlass,
  Star,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  StickerItemDto,
  StickerSetDto,
} from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { Button, Input, Skeleton, SkeletonGroup, Sticker } from "shared/ui";

import { StickerGridCell } from "./sticker-grid-cell";
import { StickerHoldPreview } from "./sticker-hold-preview";
import { StickerPreviewDialog } from "./sticker-preview-dialog";
import { StickerPreviewGesture } from "./sticker-preview-gesture";

export interface StickerPanelProps {
  /** The catalog loads the first time the section is actually shown. */
  readonly active: boolean;
  onPick(sticker: StickerItemDto): void;
}

const CELL_LABELS = {
  sticker: copy.sticker,
  playSticker: copy.playSticker,
  previewSticker: copy.previewSticker,
  addFavorite: copy.addFavoriteSticker,
  removeFavorite: copy.removeFavoriteSticker,
  removeRecent: copy.removeRecentSticker,
};

const PREVIEW_LABELS = {
  preview: copy.previewSticker,
  sticker: copy.sticker,
  playSticker: copy.playSticker,
  send: copy.sendSticker,
  addFavorite: copy.addFavoriteSticker,
  removeFavorite: copy.removeFavoriteSticker,
  close: copy.closeDialog,
};

type SectionId = "recent" | "favorites" | `set:${string}`;

const STICKER_SKELETON_COUNT = 12;
const PACK_SKELETON_COUNT = 5;

function StickerGridSkeleton() {
  return (
    <SkeletonGroup
      label={copy.loadingStickerSet}
      className="flex h-72 flex-wrap content-start gap-0.5"
    >
      {Array.from({ length: STICKER_SKELETON_COUNT }, (_, index) => (
        <span
          key={index}
          data-slot="sticker-grid-skeleton"
          className="grid size-[72px] place-items-center"
        >
          <Skeleton rounded className="size-16" />
        </span>
      ))}
    </SkeletonGroup>
  );
}

function StickerPanelSkeleton() {
  return (
    <SkeletonGroup
      label={copy.loadingStickerSet}
      className="flex flex-col gap-2"
    >
      <Skeleton rounded className="h-11 w-full" />
      <Skeleton className="mx-1 h-4 w-24" />
      <div className="flex h-72 flex-wrap content-start gap-0.5">
        {Array.from({ length: STICKER_SKELETON_COUNT }, (_, index) => (
          <span
            key={index}
            data-slot="sticker-grid-skeleton"
            className="grid size-[72px] place-items-center"
          >
            <Skeleton rounded className="size-16" />
          </span>
        ))}
      </div>
      <div className="flex items-center gap-0.5 border-t border-border pt-1.5">
        {Array.from({ length: PACK_SKELETON_COUNT }, (_, index) => (
          <span
            key={index}
            data-slot="sticker-pack-thumbnail-skeleton"
            className="grid size-10 place-items-center"
          >
            <Skeleton rounded className="size-7" />
          </span>
        ))}
      </div>
    </SkeletonGroup>
  );
}

function StickerCell({
  sticker,
  favorite,
  recent,
  onPick,
  onPreview,
  onToggleFavorite,
  onRemoveRecent,
}: {
  readonly sticker: StickerItemDto;
  readonly favorite: boolean;
  readonly recent: boolean;
  onPick(sticker: StickerItemDto): void;
  onPreview(sticker: StickerItemDto): void;
  onToggleFavorite(sticker: StickerItemDto, favorite: boolean): void;
  onRemoveRecent(sticker: StickerItemDto): void;
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
      labels={CELL_LABELS}
      favorite={favorite}
      removeFromRecent={recent}
      onPick={onPick}
      onPreview={onPreview}
      onToggleFavorite={onToggleFavorite}
      onRemoveRecent={onRemoveRecent}
    />
  );
}

function PackThumbnail({
  sticker,
}: {
  readonly sticker: StickerItemDto | null;
}) {
  const download = useChatStore((state) =>
    sticker ? (state.mediaDownloads[sticker.id] ?? null) : null,
  );
  const downloadMedia = useChatStore((state) => state.downloadMedia);

  useEffect(() => {
    if (sticker && download === null) void downloadMedia(sticker.id);
  }, [download, downloadMedia, sticker]);

  if (!sticker) {
    return (
      <span data-slot="sticker-pack-thumbnail-skeleton">
        <Skeleton rounded className="size-7" />
      </span>
    );
  }
  return (
    <span aria-hidden="true">
      <Sticker
        sticker={{
          emoji: sticker.emoji,
          format: sticker.format,
          setReference: null,
          outlinePath: sticker.outlinePath,
        }}
        width={sticker.width}
        height={sticker.height}
        src={download?.state === "ready" ? download.url : null}
        label={copy.sticker}
        playLabel={copy.playSticker}
        maxSize={28}
        still
      />
    </span>
  );
}

/**
 * Telegram's sticker catalog: recent and favorites lead the installed packs,
 * while a management mode persists the installed-pack order server-side.
 */
export function StickerPanel({ active, onPick }: StickerPanelProps) {
  const sets = useChatStore((state) => state.stickerSets);
  const recent = useChatStore((state) => state.recentStickers);
  const favorites = useChatStore((state) => state.favoriteStickers);
  const loadError = useChatStore((state) => state.stickerSetsError);
  const loadStickerSets = useChatStore((state) => state.loadStickerSets);
  const reorderStickerSets = useChatStore((state) => state.reorderStickerSets);
  const setStickerFavorite = useChatStore((state) => state.setStickerFavorite);
  const removeRecentSticker = useChatStore(
    (state) => state.removeRecentSticker,
  );
  const clearRecentStickers = useChatStore(
    (state) => state.clearRecentStickers,
  );
  const [section, setSection] = useState<SectionId | null>(null);
  const [managing, setManaging] = useState(false);
  const [preview, setPreview] = useState<StickerItemDto | null>(null);
  const [heldPreview, setHeldPreview] = useState<StickerItemDto | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] =
    useState<ReadonlyArray<StickerItemDto> | null>(null);
  const [searching, setSearching] = useState(false);
  const [resolvedSets, setResolvedSets] = useState<
    Readonly<Record<string, StickerSetDto>>
  >({});
  const [setLoadErrors, setSetLoadErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const searchTimer = useRef<number | null>(null);
  const searchRequest = useRef(0);

  useEffect(() => {
    if (active) void loadStickerSets();
  }, [active, loadStickerSets]);

  useEffect(
    () => () => {
      if (searchTimer.current !== null)
        window.clearTimeout(searchTimer.current);
      searchRequest.current += 1;
    },
    [],
  );

  const availableSections = useMemo<ReadonlyArray<SectionId>>(
    () => [
      "recent",
      "favorites",
      ...(sets ?? []).map((set) => `set:${set.id}` as const),
    ],
    [sets],
  );

  const activeSection =
    section && availableSections.includes(section)
      ? section
      : recent.length > 0
        ? "recent"
        : favorites.length > 0
          ? "favorites"
          : sets?.[0]
            ? (`set:${sets[0].id}` as const)
            : "recent";

  const activeSetSummary = activeSection.startsWith("set:")
    ? (sets?.find((set) => activeSection === `set:${set.id}`) ?? null)
    : null;
  const activeResolvedSet = activeSetSummary
    ? (resolvedSets[activeSetSummary.id] ?? null)
    : null;
  const activeSetError = activeSetSummary
    ? (setLoadErrors[activeSetSummary.id] ?? null)
    : null;

  useEffect(() => {
    if (!activeSetSummary || activeResolvedSet || activeSetError) return;
    let cancelled = false;
    void window.telo.workspace.getStickerSet(activeSetSummary.reference).then(
      (resolved) => {
        if (cancelled) return;
        setResolvedSets((current) => ({
          ...current,
          [activeSetSummary.id]: resolved,
        }));
      },
      (error: unknown) => {
        if (cancelled) return;
        setSetLoadErrors((current) => ({
          ...current,
          [activeSetSummary.id]:
            error instanceof Error ? error.message : String(error),
        }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [activeResolvedSet, activeSetError, activeSetSummary]);

  const currentStickers =
    activeSection === "recent"
      ? recent
      : activeSection === "favorites"
        ? favorites
        : (activeResolvedSet?.stickers ?? []);
  const searchActive = searchQuery.trim().length > 0;
  const displayedStickers = searchActive
    ? (searchResults ?? [])
    : currentStickers;
  const favoriteIds = useMemo(
    () => new Set(favorites.map((sticker) => sticker.id)),
    [favorites],
  );
  const previewDownload = useChatStore((state) =>
    preview ? (state.mediaDownloads[preview.id] ?? null) : null,
  );
  const heldPreviewDownload = useChatStore((state) =>
    heldPreview ? (state.mediaDownloads[heldPreview.id] ?? null) : null,
  );

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const moveSet = (index: number, offset: -1 | 1) => {
    if (!sets) return;
    const target = index + offset;
    if (target < 0 || target >= sets.length) return;
    const reordered = [...sets];
    [reordered[index], reordered[target]] = [
      reordered[target]!,
      reordered[index]!,
    ];
    void runAction(() => reorderStickerSets(reordered.map((set) => set.id)));
  };

  const updateSearch = (value: string) => {
    setSearchQuery(value);
    setActionError(null);
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    const requestId = ++searchRequest.current;
    const normalized = value.trim();
    if (!normalized) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearchResults(null);
    setSearching(true);
    searchTimer.current = window.setTimeout(() => {
      void window.telo.workspace
        .searchStickers(normalized)
        .then((results) => {
          if (requestId === searchRequest.current) setSearchResults(results);
        })
        .catch((error: unknown) => {
          if (requestId !== searchRequest.current) return;
          setSearchResults([]);
          setActionError(
            error instanceof Error ? error.message : String(error),
          );
        })
        .finally(() => {
          if (requestId === searchRequest.current) setSearching(false);
        });
    }, 250);
  };

  if (loadError) {
    return (
      <p
        role="alert"
        className="px-2 py-6 text-center text-sm text-destructive"
      >
        {copy.failed}: {loadError}
      </p>
    );
  }
  if (sets === null) {
    return <StickerPanelSkeleton />;
  }

  return (
    <div className="flex flex-col gap-2">
      {managing ? (
        <div className="flex h-72 flex-col gap-1 overflow-y-auto">
          {sets.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {copy.noStickerSets}
            </p>
          ) : (
            sets.map((set, index) => (
              <div
                key={set.id}
                className="flex min-h-10 items-center gap-2 rounded-lg px-2 hover:bg-muted/50"
              >
                <span className="flex w-6 justify-center">
                  <PackThumbnail
                    sticker={resolvedSets[set.id]?.stickers[0] ?? null}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {set.title}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={busy || index === 0}
                  aria-label={`${copy.moveStickerSetUp}: ${set.title}`}
                  className="size-10"
                  onClick={() => moveSet(index, -1)}
                >
                  <CaretUp aria-hidden="true" className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={busy || index === sets.length - 1}
                  aria-label={`${copy.moveStickerSetDown}: ${set.title}`}
                  className="size-10"
                  onClick={() => moveSet(index, 1)}
                >
                  <CaretDown aria-hidden="true" className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <Input
            value={searchQuery}
            aria-label={copy.searchStickers}
            placeholder={copy.searchStickers}
            leftIcon={<MagnifyingGlass aria-hidden="true" className="size-4" />}
            onChange={updateSearch}
          />
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground">
              {searchActive
                ? copy.stickerSearchResults
                : activeSection === "recent"
                  ? copy.recentStickers
                  : activeSection === "favorites"
                    ? copy.favoriteStickers
                    : sets.find((set) => activeSection === `set:${set.id}`)
                        ?.title}
            </span>
            {!searchActive &&
            activeSection === "recent" &&
            recent.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void runAction(clearRecentStickers)}
              >
                {copy.clearRecentStickers}
              </Button>
            ) : null}
          </div>
          <div className="h-72 overflow-y-auto">
            {searching ||
            (activeSetSummary && !activeResolvedSet && !activeSetError) ? (
              <StickerGridSkeleton />
            ) : displayedStickers.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {searchActive
                  ? copy.noSearchResults
                  : activeSetError
                    ? `${copy.failed}: ${activeSetError}`
                    : sets.length === 0 &&
                        recent.length === 0 &&
                        favorites.length === 0
                      ? copy.noStickerSets
                      : activeSection === "recent"
                        ? copy.noRecentStickers
                        : activeSection === "favorites"
                          ? copy.noFavoriteStickers
                          : copy.noStickerSets}
              </p>
            ) : (
              <StickerPreviewGesture
                stickers={displayedStickers}
                onPreview={setHeldPreview}
              >
                <div className="flex flex-wrap gap-0.5">
                  {displayedStickers.map((sticker) => (
                    <StickerCell
                      key={sticker.id}
                      sticker={sticker}
                      favorite={favoriteIds.has(sticker.id)}
                      recent={!searchActive && activeSection === "recent"}
                      onPick={onPick}
                      onPreview={setPreview}
                      onToggleFavorite={(item, favorite) =>
                        void runAction(() => setStickerFavorite(item, favorite))
                      }
                      onRemoveRecent={(item) =>
                        void runAction(() => removeRecentSticker(item.id))
                      }
                    />
                  ))}
                </div>
              </StickerPreviewGesture>
            )}
          </div>
        </>
      )}
      {actionError ? (
        <p role="alert" className="px-1 text-xs text-destructive">
          {copy.failed}: {actionError}
        </p>
      ) : null}
      <div className="flex items-center gap-0.5 overflow-x-auto border-t border-border pt-1.5">
        <Button
          size="icon"
          variant={
            activeSection === "recent" && !managing ? "secondary" : "ghost"
          }
          aria-label={copy.recentStickers}
          aria-pressed={activeSection === "recent" && !managing}
          onClick={() => {
            updateSearch("");
            setManaging(false);
            setSection("recent");
          }}
        >
          <ClockCounterClockwise aria-hidden="true" className="size-4" />
        </Button>
        <Button
          size="icon"
          variant={
            activeSection === "favorites" && !managing ? "secondary" : "ghost"
          }
          aria-label={copy.favoriteStickers}
          aria-pressed={activeSection === "favorites" && !managing}
          onClick={() => {
            updateSearch("");
            setManaging(false);
            setSection("favorites");
          }}
        >
          <Star aria-hidden="true" className="size-4" />
        </Button>
        {sets.map((set) => (
          <Button
            key={set.id}
            size="icon"
            variant={
              activeSection === `set:${set.id}` && !managing
                ? "secondary"
                : "ghost"
            }
            aria-label={set.title}
            aria-pressed={activeSection === `set:${set.id}` && !managing}
            onClick={() => {
              updateSearch("");
              setManaging(false);
              setSection(`set:${set.id}`);
              if (setLoadErrors[set.id]) {
                setSetLoadErrors((current) => {
                  const next = { ...current };
                  delete next[set.id];
                  return next;
                });
              }
            }}
          >
            <PackThumbnail
              sticker={resolvedSets[set.id]?.stickers[0] ?? null}
            />
          </Button>
        ))}
        {sets.length > 1 ? (
          <Button
            size="icon"
            variant={managing ? "secondary" : "ghost"}
            aria-label={
              managing ? copy.finishManagingStickerSets : copy.manageStickerSets
            }
            aria-pressed={managing}
            onClick={() => {
              updateSearch("");
              setManaging((value) => !value);
            }}
          >
            {managing ? (
              <Check aria-hidden="true" className="size-4" />
            ) : (
              <ArrowsDownUp aria-hidden="true" className="size-4" />
            )}
          </Button>
        ) : null}
      </div>
      <StickerPreviewDialog
        sticker={preview}
        src={previewDownload?.state === "ready" ? previewDownload.url : null}
        favorite={preview ? favoriteIds.has(preview.id) : false}
        busy={busy}
        error={actionError}
        labels={PREVIEW_LABELS}
        onClose={() => {
          setPreview(null);
          setActionError(null);
        }}
        onSend={(sticker) => {
          setPreview(null);
          onPick(sticker);
        }}
        onToggleFavorite={(sticker, favorite) =>
          void runAction(() => setStickerFavorite(sticker, favorite))
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
    </div>
  );
}
