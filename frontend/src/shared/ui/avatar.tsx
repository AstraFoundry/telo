import { BookmarkSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { copy } from "@/shared/config/copy";
import { cn } from "@/shared/lib/cn";

export interface AvatarPlaceholder {
  readonly glyph: string;
  readonly lightColors: ReadonlyArray<string>;
  readonly darkColors: ReadonlyArray<string>;
}

export interface AvatarProps {
  /** Photo source; a cache hit paints immediately via the `complete` check. */
  src?: string | null;
  /**
   * True while a photo is still resolving. The slot shows a skeleton unless a
   * placeholder can paint immediately.
   */
  pending?: boolean;
  /**
   * Saved Messages is a private chat with `getMe()`, so TDLib's photo is the
   * account userpic — often none. Telegram Desktop paints a bookmark disc
   * instead (`EmptyUserpic::PaintSavedMessages`). Use this on chat-identifying
   * slots (list, header, picker, profile), never on message-author photos.
   */
  mark?: "saved";
  /**
   * TDLib empty userpic: one letter or emoji on `accent_color_id` fills.
   * Painted when there is no photo.
   */
  placeholder?: AvatarPlaceholder | null;
  className?: string;
}

function subscribeHtmlClass(onStoreChange: () => void): () => void {
  const root = document.documentElement;
  const observer = new MutationObserver(onStoreChange);
  observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function htmlIsDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

function htmlIsLight(): boolean {
  return false;
}

function placeholderFill(colors: ReadonlyArray<string>): string {
  if (colors.length >= 2) {
    return `linear-gradient(180deg, ${colors[0]}, ${colors[1]})`;
  }
  return colors[0] ?? "transparent";
}

/**
 * Conversation avatar: a cached photo appears immediately; otherwise the slot
 * is a skeleton until the download settles unless an empty userpic can
 * paint (one grapheme or emoji on the accent fill). Saved Messages
 * (`mark="saved"`) is the bookmark disc, not a photo.
 */
export function Avatar({
  src,
  pending = false,
  mark,
  placeholder,
  className,
}: AvatarProps) {
  const [loaded, setLoaded] = useState(false);
  // A dead source (the cache file was evicted or cleared) must not pin the
  // slot in its loading skeleton — fall back to the empty-userpic fill.
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dark = useSyncExternalStore(
    subscribeHtmlClass,
    htmlIsDark,
    htmlIsLight,
  );
  // A changed source must fade in again rather than pop.
  const [previousSrc, setPreviousSrc] = useState(src);
  if (src !== previousSrc) {
    setPreviousSrc(src);
    setLoaded(false);
    setFailed(false);
  }

  // A cached image can finish before React attaches onLoad; `complete` covers
  // that path while onLoad covers the normal one.
  useEffect(() => {
    if (src && imgRef.current?.complete) setLoaded(true);
  }, [src]);

  if (mark === "saved") {
    return (
      <span
        /* deslop-ignore-next-line 19 — circular avatars are a messaging convention */
        className={cn(
          "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary text-primary-foreground",
          className,
        )}
      >
        <BookmarkSimple
          aria-hidden="true"
          weight="fill"
          className="size-[52%]"
        />
      </span>
    );
  }

  const showPhoto = Boolean(src) && !failed;
  const showPlaceholder = !showPhoto && Boolean(placeholder);
  const showSkeleton = failed
    ? false
    : showPhoto
      ? !loaded
      : pending && !showPlaceholder;
  const fill = placeholder
    ? placeholderFill(dark ? placeholder.darkColors : placeholder.lightColors)
    : undefined;
  const glyphIsLetter = placeholder
    ? /^\p{L}$/u.test(placeholder.glyph)
    : false;

  return (
    <span
      /* deslop-ignore-next-line 19 — circular avatars are a messaging convention */
      role={showSkeleton ? "status" : undefined}
      aria-label={showSkeleton ? copy.loadingAvatar : undefined}
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted [container-type:size]",
        className,
      )}
      style={showPlaceholder ? { background: fill } : undefined}
    >
      {showSkeleton ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
        />
      ) : null}
      {showPlaceholder && placeholder ? (
        <span
          aria-hidden="true"
          className={cn(
            "font-medium leading-none text-white",
            glyphIsLetter ? "text-[42cqmin]" : "text-[55cqmin]",
          )}
        >
          {placeholder.glyph}
        </span>
      ) : null}
      {showPhoto ? (
        <img
          src={src ?? undefined}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn(
            "absolute inset-0 size-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10",
            "transition-opacity duration-200 ease-out",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </span>
  );
}
