"use client";

import {
  ArrowClockwise,
  ArrowsOutSimple,
  DownloadSimple,
  File,
  FileAudio,
  FileVideo,
  Play,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";

import type {
  MessageFileMediaDto,
  MessageMediaDto,
} from "../../../../../../contracts/src/ipc";
import { cn } from "@/shared/lib/cn";
import { LinkPreview } from "@/shared/ui/link-preview";
import { PressableBlock } from "@/shared/ui/pressable-block";
import { Sticker } from "@/shared/ui/sticker";
import { Button } from "@components/motion/button";

export interface MessageMediaState {
  readonly state: "downloading" | "ready" | "cancelled" | "failed";
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
  readonly url: string | null;
  readonly error: string | null;
}

export interface MessageMediaProps {
  readonly media: MessageMediaDto;
  readonly download: MessageMediaState | null;
  readonly labels: {
    download: string;
    cancel: string;
    retry: string;
    reveal: string;
    failed: string;
    expand: string;
    sticker: string;
    playSticker: string;
    openStickerSet: string;
  };
  /**
   * Album-tile layout: a square cover crop instead of the full card. Only
   * affects photo/video media.
   */
  readonly tile?: boolean;
  /**
   * Animated and video stickers replay on their own. Off — the reader turned
   * sticker looping off — gives them a single pass and then a held frame.
   */
  readonly loopStickers?: boolean;
  /**
   * Byte progress renders only for downloads the user explicitly started;
   * automatic thumbnail preloads stay quiet placeholders.
   */
  readonly downloadIsExplicit?: boolean;
  onDownload(): void;
  onCancel(): void;
  /** Opens the media in the viewer; receives the clicked element for the
   * viewer's origin-aware open transition. */
  onOpen?(trigger: HTMLElement): void;
}

export function MessageMedia(props: MessageMediaProps) {
  // Link previews carry no downloadable attachment; the thumbnail rides the
  // same download slot keyed by the carrying message id when one exists.
  if (props.media.kind === "webpage") {
    return (
      <LinkPreview
        preview={props.media}
        thumbnailUrl={
          props.download?.state === "ready" ? props.download.url : null
        }
      />
    );
  }
  // A sticker is a document, but Telegram never draws it as an attachment
  // card: no file name, no size, no download button — the alt emoji stands in
  // until the document lands and then the sticker itself takes the slot.
  if (props.media.kind === "sticker" && props.media.sticker) {
    const sticker = (
      <Sticker
        sticker={props.media.sticker}
        width={props.media.width}
        height={props.media.height}
        src={props.download?.state === "ready" ? props.download.url : null}
        label={props.labels.sticker}
        playLabel={props.labels.playSticker}
        loop={props.loopStickers}
      />
    );
    // Telegram opens the sticker's set when you tap it. Without a set there
    // is nothing to open, so the sticker stays a plain image rather than a
    // control that does nothing.
    if (!props.onOpen) return sticker;
    return (
      <PressableBlock
        aria-label={props.labels.openStickerSet}
        className="w-fit rounded-lg"
        onClick={(event) => props.onOpen?.(event.currentTarget)}
      >
        {sticker}
      </PressableBlock>
    );
  }
  return <FileMedia {...props} media={props.media} />;
}

function FileMedia({
  media,
  download,
  labels,
  tile = false,
  downloadIsExplicit = false,
  onDownload,
  onCancel,
  onOpen,
}: Omit<MessageMediaProps, "media"> & { media: MessageFileMediaDto }) {
  const visual = media.kind === "photo" || media.kind === "animation";
  const video = media.kind === "video" || media.kind === "video-note";

  if (visual || video) {
    return (
      <VisualMedia
        media={media}
        download={download}
        labels={labels}
        tile={tile}
        downloadIsExplicit={downloadIsExplicit}
        video={video}
        onDownload={onDownload}
        onCancel={onCancel}
        onOpen={onOpen}
      />
    );
  }

  const downloading = download?.state === "downloading";
  const failed = download?.state === "failed";
  const percent =
    downloading && download.totalBytes && download.totalBytes > 0
      ? Math.min(100, (download.downloadedBytes / download.totalBytes) * 100)
      : null;
  const Icon = video
    ? FileVideo
    : media.kind === "audio" || media.kind === "voice"
      ? FileAudio
      : File;

  return (
    <div className="min-w-64 rounded-lg bg-black/5 p-2.5 outline outline-1 -outline-offset-1 outline-black/10 dark:bg-white/5 dark:outline-white/10">
      <div className="flex items-center gap-2.5">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-background/70 text-muted-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {media.fileName ?? media.mimeType ?? media.kind}
          </div>
          <div className="text-xs tabular-nums text-muted-foreground">
            {downloading
              ? `${formatBytes(download.downloadedBytes)}${download.totalBytes ? ` / ${formatBytes(download.totalBytes)}` : ""}`
              : media.size === null
                ? media.mimeType
                : formatBytes(media.size)}
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-10 shrink-0"
          aria-label={
            downloading
              ? labels.cancel
              : failed
                ? labels.retry
                : labels.download
          }
          onClick={downloading ? onCancel : onDownload}
        >
          {downloading ? (
            <X aria-hidden="true" className="size-4" />
          ) : failed ? (
            <ArrowClockwise aria-hidden="true" className="size-4" />
          ) : (
            <DownloadSimple aria-hidden="true" className="size-4" />
          )}
        </Button>
      </div>
      {downloading ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={download.totalBytes ?? undefined}
          aria-valuenow={download.downloadedBytes}
          className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/10"
        >
          <div
            className={cn(
              "h-full rounded-full bg-primary",
              percent === null && "w-1/3 animate-pulse",
            )}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {labels.failed}
          {download.error ? `: ${download.error}` : ""}
        </p>
      ) : null}
    </div>
  );
}

// Telegram gives a photo its final box before a byte of it arrives: the
// message already carries the dimensions, so the bubble is laid out once and
// the pixels drop into a hole that is already the right shape. Anything less
// reflows the transcript under the reader mid-scroll.
const VISUAL_MEDIA_MAX_HEIGHT = 384;
// A sliver of a photo is unreadable, so a very tall one is boxed at 1:2 and
// fitted inside rather than rendered two fingers wide.
const VISUAL_MEDIA_MIN_ASPECT = 0.5;

/**
 * The display box for a photo or video, or null when the message carries no
 * dimensions. Both the placeholder and the loaded media take this exact box,
 * which is what keeps the scroll position still while a page fills in.
 */
export function visualMediaBox(
  width: number | null,
  height: number | null,
): { readonly aspectRatio: string; readonly width: string } | null {
  if (!width || !height || width < 0 || height < 0) return null;
  const aspect = Math.max(width / height, VISUAL_MEDIA_MIN_ASPECT);
  return {
    aspectRatio: `${aspect}`,
    // Capping the width rather than the height is what avoids letterboxing:
    // the box never gets taller than the cap, so it never has spare room.
    width: `min(100%, ${Math.round(aspect * VISUAL_MEDIA_MAX_HEIGHT)}px)`,
  };
}

function VisualMedia({
  media,
  download,
  labels,
  tile,
  downloadIsExplicit,
  video,
  onDownload,
  onCancel,
  onOpen,
}: Omit<MessageMediaProps, "media" | "tile" | "downloadIsExplicit"> & {
  media: MessageFileMediaDto;
  tile: boolean;
  downloadIsExplicit: boolean;
  video: boolean;
}) {
  const [spoilerRevealed, setSpoilerRevealed] = useState(!media.spoiler);
  const readyUrl = download?.state === "ready" ? download.url : null;
  const downloading = download?.state === "downloading";
  const failed = download?.state === "failed";
  const cancelled = download?.state === "cancelled";
  const showProgress = downloading && downloadIsExplicit;
  // While the auto-preloader can see this bubble it owns the fetch, so the
  // placeholder stays quiet; without it (no IntersectionObserver) or after a
  // cancel, the placeholder keeps an explicit download action.
  const preloadExpected =
    download === null && typeof IntersectionObserver !== "undefined";
  const showDownload =
    failed || cancelled || (download === null && !preloadExpected);

  const frame = tile
    ? "relative aspect-square overflow-hidden bg-black/5 dark:bg-white/5"
    : "relative overflow-hidden rounded-lg bg-black/5 outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10";
  // A tile is already a square, so only the full card reserves a box.
  const box = tile ? null : visualMediaBox(media.width, media.height);
  const boxStyle = box
    ? { aspectRatio: box.aspectRatio, width: box.width }
    : undefined;
  // Without dimensions there is nothing to reserve; the frame falls back to a
  // bounded placeholder and the transcript's scroll anchoring absorbs the
  // difference when the real size arrives.
  const unsizedFrame = !tile && !box ? "max-h-96 min-h-40 w-full" : undefined;

  const revealButton =
    !spoilerRevealed && readyUrl ? (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setSpoilerRevealed(true)}
        className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
      >
        {labels.reveal}
      </Button>
    ) : null;

  if (!readyUrl) {
    return (
      <div className={cn(frame, unsizedFrame)} style={boxStyle}>
        {showDownload ? (
          <Button
            size="icon"
            variant="secondary"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            aria-label={failed ? labels.retry : labels.download}
            onClick={onDownload}
          >
            {failed ? (
              <ArrowClockwise aria-hidden="true" className="size-4" />
            ) : (
              <DownloadSimple aria-hidden="true" className="size-4" />
            )}
          </Button>
        ) : null}
        {showProgress ? (
          <>
            <Button
              size="icon"
              variant="secondary"
              className="absolute right-2 top-2 size-10"
              aria-label={labels.cancel}
              onClick={onCancel}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={download.totalBytes ?? undefined}
              aria-valuenow={download.downloadedBytes}
              className="absolute inset-x-3 bottom-3 h-1 overflow-hidden rounded-full bg-foreground/10"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${
                    download.totalBytes && download.totalBytes > 0
                      ? Math.min(
                          100,
                          (download.downloadedBytes / download.totalBytes) *
                            100,
                        )
                      : 33
                  }%`,
                }}
              />
            </div>
          </>
        ) : null}
        {failed ? (
          <p
            role="alert"
            className="absolute inset-x-3 bottom-3 text-xs text-destructive"
          >
            {labels.failed}
            {download.error ? `: ${download.error}` : ""}
          </p>
        ) : null}
      </div>
    );
  }

  if (tile) {
    return (
      <div className={frame}>
        <button
          type="button"
          aria-label={media.fileName ?? labels.expand}
          className="block size-full cursor-zoom-in"
          onClick={(event) => {
            if (spoilerRevealed) onOpen?.(event.currentTarget);
          }}
        >
          {video ? (
            <>
              <video
                src={readyUrl}
                muted
                preload="metadata"
                aria-hidden="true"
                className={cn(
                  "pointer-events-none size-full object-cover",
                  !spoilerRevealed && "blur-xl",
                )}
              />
              <Play
                aria-hidden="true"
                weight="fill"
                // The fill triangle's area centroid sits ~5/256 left of the
                // glyph box centre, so geometric centring reads off-centre.
                className="absolute left-1/2 top-1/2 size-8 -translate-y-1/2 translate-x-[calc(-50%+1px)] text-white drop-shadow"
              />
            </>
          ) : (
            <img
              src={readyUrl}
              alt={media.fileName ?? ""}
              className={cn(
                "size-full object-cover",
                !spoilerRevealed && "blur-xl",
              )}
            />
          )}
        </button>
        {revealButton}
      </div>
    );
  }

  return (
    <div className={cn(frame, unsizedFrame)} style={boxStyle}>
      {video ? (
        <>
          <video
            src={readyUrl}
            controls
            preload="metadata"
            aria-label={media.fileName ?? undefined}
            className={cn(
              box ? "size-full object-contain" : "max-h-96 w-full",
              !spoilerRevealed && "blur-xl",
            )}
          />
          {onOpen ? (
            <Button
              size="icon"
              variant="secondary"
              className="absolute right-2 top-2 size-10"
              aria-label={labels.expand}
              onClick={(event) => onOpen(event.currentTarget)}
            >
              <ArrowsOutSimple aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          aria-label={media.fileName ?? labels.expand}
          className={cn(
            "block w-full",
            box && "h-full",
            onOpen && "cursor-zoom-in",
          )}
          onClick={(event) => {
            if (spoilerRevealed) onOpen?.(event.currentTarget);
          }}
        >
          <img
            src={readyUrl}
            alt={media.fileName ?? ""}
            className={cn(
              box
                ? "size-full object-contain"
                : "max-h-96 w-full object-contain",
              !spoilerRevealed && "blur-xl",
            )}
          />
        </button>
      )}
      {revealButton}
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: amount < 10 ? 1 : 0 }).format(amount)} ${units[unit]}`;
}
