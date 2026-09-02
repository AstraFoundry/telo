"use client";

import { useReducedMotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { MessageStickerDto } from "../../../../contracts/src/ipc";

import { cn } from "@/shared/lib/cn";

/**
 * Telegram caps a sticker at half the message column and never lets it grow
 * past a readable size; 180px is the desktop equivalent of the 170dp cell
 * Telegram-Android draws.
 */
const STICKER_MAX_PX = 180;

export interface StickerProps {
  readonly sticker: MessageStickerDto;
  /** Intrinsic document size; a square box stands in when Telegram omits it. */
  readonly width: number | null;
  readonly height: number | null;
  /** Ready media URL, or null while the document is still downloading. */
  readonly src: string | null;
  /** Accessible name for a sticker whose set carries no emoji. */
  readonly label: string;
  /** Names the play control that reduced motion puts on a paused sticker. */
  readonly playLabel: string;
  /** Caps the longest side; the transcript keeps Telegram's cell size. */
  readonly maxSize?: number;
  /**
   * Holds animated and video stickers on their first frame with no play
   * control. The picker grid uses it: a wall of looping animations is the
   * repeated attention cost that motion restraint exists to prevent, and a
   * screenful of simultaneous players is a real frame budget.
   */
  readonly still?: boolean;
  /**
   * Animated and video stickers replay on their own, the way Telegram plays
   * them. Off — the reader turned sticker looping off — gives them one pass
   * and then the same held frame and play control reduced motion produces.
   */
  readonly loop?: boolean;
  readonly className?: string;
}

interface LottiePlayer {
  destroy(): void;
  goToAndStop(value: number, isFrame?: boolean): void;
  goToAndPlay(value: number, isFrame?: boolean): void;
  addEventListener(name: "complete", callback: () => void): void;
}

/**
 * A sticker is a document Telegram draws without any bubble: transparent,
 * sized from its own dimensions, and standing in for an emoji. Static stickers
 * are WebP, animated ones are gzipped Lottie (`.tgs`), and video ones are
 * silent WebM — this renders all three from the same box so the row never
 * reflows when the download lands.
 *
 * Motion follows Telegram: animated and video stickers loop on their own,
 * because the animation is the content rather than interface decoration. Under
 * `prefers-reduced-motion` they hold their first frame and expose a play
 * control, which is the gentler equivalent rather than no sticker at all, and
 * a reader who turned looping off gets a single pass and then that same held
 * frame.
 */
export function Sticker({
  sticker,
  width,
  height,
  src,
  label,
  playLabel,
  maxSize = STICKER_MAX_PX,
  still = false,
  loop = true,
  className,
}: StickerProps) {
  const reduce = useReducedMotionConfig() ?? false;
  // A still sticker is frozen for layout reasons, so it owes no play control;
  // a reduced-motion one is frozen for the reader, so it does.
  const frozen = reduce || still;
  // A frozen sticker has no pass to repeat, so reduced motion and the
  // picker's stillness both outrank the looping choice.
  const repeat = !frozen && loop;
  const box = stickerBox(width, height, maxSize);
  const name = sticker.emoji ?? label;

  if (!src) {
    return (
      <StickerBox box={box} className={className}>
        {/* Telegram paints the alt emoji in the same slot until the document
            is on disk, so the row keeps its height and nothing jumps. */}
        <span
          role="img"
          aria-label={name}
          className="grid size-full place-items-center text-5xl leading-none select-none"
        >
          {sticker.emoji}
        </span>
      </StickerBox>
    );
  }

  if (sticker.format === "animated") {
    return (
      <StickerBox box={box} className={className}>
        <LottieSticker
          src={src}
          name={name}
          frozen={frozen}
          loop={repeat}
          play={still ? null : playLabel}
        />
      </StickerBox>
    );
  }

  if (sticker.format === "video") {
    return (
      <StickerBox box={box} className={className}>
        <VideoSticker
          src={src}
          name={name}
          frozen={frozen}
          loop={repeat}
          play={still ? null : playLabel}
        />
      </StickerBox>
    );
  }

  return (
    <StickerBox box={box} className={className}>
      {/* No image outline here: a sticker is a transparent cutout, so the
          outline photos get would draw a box around empty pixels. */}
      <img
        src={src}
        alt={name}
        loading="lazy"
        decoding="async"
        className="size-full object-contain"
      />
    </StickerBox>
  );
}

function StickerBox({
  box,
  className,
  children,
}: {
  readonly box: { width: number; height: number };
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      data-slot="sticker"
      style={{ width: box.width, height: box.height }}
      className={cn("relative shrink-0", className)}
    >
      {children}
    </div>
  );
}

function VideoSticker({
  src,
  name,
  frozen,
  loop,
  play,
}: {
  readonly src: string;
  readonly name: string;
  readonly frozen: boolean;
  readonly loop: boolean;
  readonly play: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(frozen);

  const start = useCallback(() => {
    setPaused(false);
    // A finished video rewinds itself on play(), so the control replays the
    // single pass instead of resuming a sticker that is already at its end.
    void videoRef.current?.play();
  }, []);

  // The preference behind `frozen` can flip while a sticker is on screen, and
  // `autoplay` only matters at mount: freezing has to stop the element and
  // rewind it to the frame it should hold, and lifting it starts the sticker
  // again rather than leaving a still image behind.
  const wasFrozen = useRef(frozen);
  useEffect(() => {
    if (wasFrozen.current === frozen) return;
    wasFrozen.current = frozen;
    setPaused(frozen);
    const video = videoRef.current;
    if (!video) return;
    if (frozen) {
      video.pause();
      video.currentTime = 0;
      return;
    }
    void video.play();
  }, [frozen]);

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        aria-label={name}
        autoPlay={!frozen}
        loop={loop}
        muted
        playsInline
        onEnded={() => {
          // A sticker that does not loop gets one pass on demand: it holds
          // its last frame and offers the control again.
          if (!loop) setPaused(true);
        }}
        className="size-full object-contain"
      />
      {paused && play ? <PlayOverlay label={play} onPlay={start} /> : null}
    </>
  );
}

function LottieSticker({
  src,
  name,
  frozen,
  loop,
  play,
}: {
  readonly src: string;
  readonly name: string;
  readonly frozen: boolean;
  readonly loop: boolean;
  readonly play: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<LottiePlayer | null>(null);
  const [paused, setPaused] = useState(frozen);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let player: LottiePlayer | null = null;
    void (async () => {
      try {
        // The player is ~150KB and only a chat with animated stickers needs
        // it, so it loads on first use instead of riding in the main bundle.
        const [{ default: lottie }, animationData] = await Promise.all([
          import("lottie-web/build/player/lottie_light"),
          loadTgs(src),
        ]);
        if (cancelled || !containerRef.current) return;
        player = lottie.loadAnimation({
          container: containerRef.current,
          renderer: "svg",
          loop,
          autoplay: !frozen,
          animationData,
        });
        // The player is rebuilt whenever the mode changes, so the control
        // tracks it: held stickers offer it, playing ones do not.
        setPaused(frozen);
        if (frozen) player.goToAndStop(0, true);
        // The same hold the video sticker gets from `onEnded`: one pass, then
        // the last frame and the control that replays it.
        if (!loop) player.addEventListener("complete", () => setPaused(true));
        playerRef.current = player;
      } catch (error) {
        // A sticker that cannot be decoded falls back to its emoji rather
        // than leaving an empty hole in the transcript, but the reason still
        // belongs in the log — a silent catch would hide a broken player.
        console.error("Sticker animation failed to load", error);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
    };
  }, [src, frozen, loop]);

  if (failed) {
    return (
      <span
        role="img"
        aria-label={name}
        className="grid size-full place-items-center text-5xl leading-none select-none"
      >
        {name}
      </span>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        role="img"
        aria-label={name}
        className="size-full"
      />
      {paused && play ? (
        <PlayOverlay
          label={play}
          onPlay={() => {
            setPaused(false);
            // From the first frame either way: a held sticker never started,
            // and a single-pass one is sitting on its last frame.
            playerRef.current?.goToAndPlay(0, true);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Reduced motion holds the sticker on its first frame, so it needs a way to
 * play. The control covers the whole sticker: the target is already far past
 * the 40px floor, and anywhere on the sticker is where a reader would press.
 */
function PlayOverlay({
  label,
  onPlay,
}: {
  readonly label: string;
  readonly onPlay: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPlay}
      className="absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    />
  );
}

function stickerBox(
  width: number | null,
  height: number | null,
  maxSize: number,
): { width: number; height: number } {
  if (!width || !height) {
    return { width: maxSize, height: maxSize };
  }
  const scale = maxSize / Math.max(width, height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * `.tgs` is gzipped Lottie JSON. Chromium ships the gunzip transform, so the
 * sticker needs no decompression dependency of its own.
 */
async function loadTgs(src: string): Promise<unknown> {
  const response = await fetch(src);
  if (!response.body) throw new Error("Sticker document is empty");
  const json = await new Response(
    response.body.pipeThrough(new DecompressionStream("gzip")),
  ).text();
  return JSON.parse(json);
}
