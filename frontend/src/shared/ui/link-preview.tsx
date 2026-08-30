import type { MessageWebPageMediaDto } from "../../../../contracts/src/ipc";
import { cn } from "@/shared/lib/cn";
import { safeLink } from "@/shared/lib/safe-link";

export interface LinkPreviewProps {
  readonly preview: MessageWebPageMediaDto;
  /** Ready media URL for the preview photo; the card renders without it. */
  readonly thumbnailUrl?: string | null;
  readonly className?: string;
}

/**
 * Telegram-style link preview card: a static surface (no motion — it sits in
 * the high-frequency transcript) whose whole body is the link, keeping the
 * hit area well above 40px. The URL is sanitized through the same safe-link
 * path as inline message links; an unusable URL renders as plain text.
 */
export function LinkPreview({
  preview,
  thumbnailUrl,
  className,
}: LinkPreviewProps) {
  const href = safeLink(preview.url);
  const heading = preview.title ?? preview.displayUrl ?? preview.url;

  const body = (
    <>
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          className="size-10 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        />
      ) : null}
      <span className="min-w-0 flex-1">
        {preview.siteName ? (
          <span className="block truncate text-xs font-medium text-primary">
            {preview.siteName}
          </span>
        ) : null}
        <span className="block truncate text-sm font-medium">{heading}</span>
        {preview.description ? (
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
            {preview.description}
          </span>
        ) : null}
        {preview.title ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {preview.displayUrl ?? preview.url}
          </span>
        ) : null}
      </span>
    </>
  );

  const surface = cn(
    "min-h-10 w-full min-w-64 items-center gap-2.5 rounded-lg bg-black/5 p-2.5 outline outline-1 -outline-offset-1 outline-black/10 dark:bg-white/5 dark:outline-white/10",
    className,
  );

  if (!href) {
    return <div className={cn(surface, "flex")}>{body}</div>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        surface,
        "flex transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10",
      )}
    >
      {body}
    </a>
  );
}
