import { useEffect, useRef, useState } from "react";

import { cn } from "@/shared/lib/cn";

export interface AvatarProps {
  /** Shown underneath the photo and whenever no photo exists. */
  initials: string;
  /** Photo source; cross-fades in over the initials once decoded. */
  src?: string | null;
  className?: string;
}

/**
 * Telegram-style avatar: the initials placeholder renders immediately and the
 * photo fades over it when ready — the slot never pops or changes size. This
 * mirrors `AvatarDrawable` + `ImageReceiver` cross-fade in Telegram's own
 * clients (Nicegram included).
 */
export function Avatar({ initials, src, className }: AvatarProps) {
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

  return (
    <span
      /* deslop-ignore-next-line 19 — circular avatars are a messaging convention */
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-xs font-semibold",
        className,
      )}
    >
      {initials}
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
