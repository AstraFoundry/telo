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
import { useState, type CSSProperties } from "react";

import type {
  MessageFileMediaDto,
  MessageMediaDto,
} from "../../../../../../contracts/src/ipc";
import { cn } from "@/shared/lib/cn";
import { LinkPreview } from "@/shared/ui/link-preview";
import { PressableBlock } from "@/shared/ui/pressable-block";
import { ProgressRing } from "@/shared/ui/progress-ring";
import { Skeleton } from "@/shared/ui/skeleton";
import { Sticker } from "@/shared/ui/sticker";
import { SpoilerCover } from "@/shared/ui/spoiler-cover";
import type { SpoilerRevealOrigin } from "@/shared/ui/spoiler-cover";
import { Button } from "@components/motion/button";

/**
 * The hole a media spoiler's reveal punches, as a mask on the blurred layer.
 * `SpoilerCover` writes the three variables every frame, so this stays a
 * static style object and the geometry never round-trips through React.
 * The gradient's soft inner stop matches the canvas hole's feathered edge.
 */
const SPOILER_HOLE_INITIAL = {
  "--spoiler-x": "50%",
  "--spoiler-y": "50%",
  "--spoiler-r": "0px",
} as CSSProperties;
const SPOILER_HOLE_MASK: CSSProperties = {
  // Stops are absolute lengths rather than a sized gradient, and a final
  // stop pins the far field opaque: with every stop at 0 the gradient is
  // degenerate and Chromium resolves the whole mask to transparent, which
  // uncovers the media before the reveal has begun.
  maskImage:
    "radial-gradient(circle at var(--spoiler-x) var(--spoiler-y), transparent 0, transparent calc(var(--spoiler-r) * 0.55), black var(--spoiler-r), black 100%)",
};

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
   * The photo/video IS the bubble (Telegram's no-caption rule): the bubble
   * frame owns the silhouette and the shadow, so the card drops its own
   * radius. Captioned media keeps the card inside the padded bubble.
   */
  readonly fill?: boolean;
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
  fill = false,
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
        fill={fill}
        video={video}
        onDownload={onDownload}
        onCancel={onCancel}
        onOpen={onOpen}
      />
    );
  }

  const downloading = download?.state === "downloading";
  const failed = download?.state === "failed";
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
        <span className="relative grid size-10 shrink-0 place-items-center">
          {downloading ? (
            // The ring wraps the cancel target rather than taking a row of
            // its own under the file name, which is where Telegram puts it
            // too: progress and "stop this" are one control.
            <ProgressRing
              value={
                download.totalBytes && download.totalBytes > 0
                  ? download.downloadedBytes / download.totalBytes
                  : null
              }
              label={labels.download}
              size={40}
              className="absolute inset-0 text-primary"
            />
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            className="size-10 rounded-full"
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
        </span>
      </div>
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
): {
  readonly aspectRatio: string;
  readonly width: string;
  readonly maxWidth: string;
} | null {
  if (!width || !height || width < 0 || height < 0) return null;
  const aspect = Math.max(width / height, VISUAL_MEDIA_MIN_ASPECT);
  return {
    aspectRatio: `${aspect}`,
    // Capping the width rather than the height is what avoids letterboxing:
    // the box never gets taller than the cap, so it never has spare room.
    // The width is definite rather than `min(100%, …)`: a bubble with no
    // caption is shrink-to-fit, so a percentage width would resolve against
    // a parent that is itself sized by this element and collapse the box to
    // a few pixels. `max-width` still keeps it inside a narrow column.
    width: `${Math.round(aspect * VISUAL_MEDIA_MAX_HEIGHT)}px`,
    maxWidth: "100%",
  };
}

function VisualMedia({
  media,
  download,
  labels,
  tile,
  fill,
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
  const [spoilerReveal, setSpoilerReveal] =
    useState<SpoilerRevealOrigin | null>(null);
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

  // Telegram convention: chat media never carries a visible outline — corner
  // rounding plus the bubble's soft shadow does the edge work (tdesktop
  // MediaRoundingMask + fillImageShadow, Web A .has-shadow). The `fill`
  // frame owns the rounding when the photo is the whole bubble.
  const frame = tile
    ? "relative aspect-square overflow-hidden bg-black/5 dark:bg-white/5"
    : fill
      ? "relative overflow-hidden bg-black/5 dark:bg-white/5"
      : "relative overflow-hidden rounded-lg bg-black/5 dark:bg-white/5";
  // A tile is already a square, so only the full card reserves a box.
  const box = tile ? null : visualMediaBox(media.width, media.height);
  const boxStyle = box
    ? {
        aspectRatio: box.aspectRatio,
        width: box.width,
        maxWidth: box.maxWidth,
      }
    : undefined;
  // Without dimensions the frame still owes a media-shaped box: a 4:3 card
  // with a floor on the width, rather than collapsing to the bubble's minimum
  // width and stretching into a vertical strip. Scroll anchoring absorbs the
  // difference when the real size arrives.
  const unsizedFrame =
    !tile && !box ? "aspect-[4/3] max-h-96 w-full min-w-64" : undefined;

  // The cover is a layer over the media, not a blur on it: Telegram hides a
  // spoilered photo behind its own blurred stripped thumbnail with the dot
  // field on top, and blurring the full-resolution image instead is a GPU
  // pass per frame for as long as the reader keeps scrolling.
  const spoilerCover =
    media.spoiler && !spoilerRevealed && readyUrl ? (
      <div
        className="absolute inset-0 z-10 overflow-hidden rounded-[inherit]"
        style={SPOILER_HOLE_INITIAL}
      >
        {media.blurredThumbnail ? (
          <img
            src={media.blurredThumbnail}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 size-full scale-110 object-cover blur-md"
            style={SPOILER_HOLE_MASK}
          />
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/70"
            style={SPOILER_HOLE_MASK}
          />
        )}
        <SpoilerCover
          mode="media"
          revealFrom={spoilerReveal}
          onRevealed={() => setSpoilerRevealed(true)}
          className="z-10 text-white"
        />
        {spoilerReveal === null ? (
          // Anywhere on the cover reveals, and the click never reaches the
          // media underneath — it would otherwise open the viewer on the
          // same press that uncovered it.
          <button
            type="button"
            aria-label={labels.reveal}
            className="absolute inset-0 z-20 size-full cursor-pointer"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setSpoilerReveal({
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
              });
            }}
          />
        ) : null}
      </div>
    ) : null;

  if (!readyUrl) {
    return (
      <div className={cn(frame, unsizedFrame)} style={boxStyle}>
        <MediaPlaceholder thumbnail={media.blurredThumbnail ?? null} />
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
          // Telegram puts the ring on the media and the cancel inside it, so
          // one 40px target both reports progress and stops the download.
          // A bar would need a row of its own and would sit on the photo it
          // is describing.
          <span className="absolute left-1/2 top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white">
            <ProgressRing
              value={
                download.totalBytes && download.totalBytes > 0
                  ? download.downloadedBytes / download.totalBytes
                  : null
              }
              label={labels.download}
              size={40}
              className="absolute inset-0"
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label={labels.cancel}
              className="size-10 rounded-full text-white hover:bg-white/10"
              onClick={onCancel}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </span>
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
                className="pointer-events-none size-full object-cover"
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
              className="size-full object-cover"
            />
          )}
        </button>
        {spoilerCover}
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
            className={box ? "size-full object-contain" : "max-h-96 w-full"}
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
            )}
          />
        </button>
      )}
      {spoilerCover}
    </div>
  );
}

/**
 * What fills a photo or video's reserved box before its bytes arrive.
 *
 * Telegram's answer is the message's own stripped thumbnail — a ~100-byte
 * JPEG a few dozen pixels wide — blurred and upscaled
 * (`getStrippedThumbIfNeeded.ts:41-56`, `history_view_photo.cpp:1025`). The
 * blur is applied at that tiny size and the compositor does the enlarging,
 * which is why it costs nothing: blurring the full-resolution image instead
 * is a GPU pass per frame for the whole time the reader keeps scrolling.
 *
 * Only when Telegram sent no thumbnail is there genuinely no shape to draw,
 * and that is where the skeleton belongs.
 */
function MediaPlaceholder({
  thumbnail,
}: {
  readonly thumbnail: string | null;
}) {
  if (!thumbnail) {
    return (
      <Skeleton rounded className="absolute inset-0 size-full rounded-none" />
    );
  }
  return (
    <img
      src={thumbnail}
      alt=""
      aria-hidden="true"
      // Blur samples transparent pixels past the edges and leaves a faded
      // border, so the thumbnail is drawn slightly oversized and clipped by
      // the frame — the CSS equivalent of both clients' over-draw.
      className="absolute inset-0 size-full scale-110 object-cover blur-md"
    />
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
