import { BookmarkSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { copy } from "@/shared/config/copy";
import { cn } from "@/shared/lib/cn";

export interface AvatarProps {
  /** Photo source; a cache hit paints immediately via the `complete` check. */
  src?: string | null;
  /**
   * True while a photo is still resolving. The slot shows a skeleton, never
   * initials. Omit (or false) after the download settles with no photo.
   */
  pending?: boolean;
  /**
   * Saved Messages is a private chat with `getMe()`, so TDLib's photo is the
   * account userpic — often none. Telegram Desktop paints a bookmark disc
   * instead (`EmptyUserpic::PaintSavedMessages`). Use this on chat-identifying
   * slots (list, header, picker, profile), never on message-author photos.
   */
  mark?: "saved";
  className?: string;
}

/**
 * Conversation avatar: a cached photo appears immediately; otherwise the slot
 * is a skeleton until the download settles, then an empty circle. Initials are
 * never painted — that is a product rule, even though Telegram/Nicegram still
 * use `AvatarDrawable` letters. Saved Messages (`mark="saved"`) is the
 * bookmark disc, not a photo.
 */
export function Avatar({
  src,
  pending = false,
  mark,
  className,
}: AvatarProps) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // A changed source must fade in again rather than pop.
  const [previousSrc, setPreviousSrc] = useState(src);
  if (src !== previousSrc) {
    setPreviousSrc(src);
    setLoaded(false);
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

  const showSkeleton = src ? !loaded : pending;

  return (
    <span
      /* deslop-ignore-next-line 19 — circular avatars are a messaging convention */
      role={showSkeleton ? "status" : undefined}
      aria-label={showSkeleton ? copy.loadingAvatar : undefined}
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted",
        className,
      )}
    >
      {showSkeleton ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
        />
      ) : null}
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt=""
          loading="lazy"
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
