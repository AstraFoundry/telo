import { Bell, BellSlash } from "@phosphor-icons/react";

import { copy } from "shared/config/copy";
import { ActionSwapIcon } from "shared/ui";

interface NotificationPreviewProps {
  /** Chat this notification would come from, when a real one is available. */
  readonly chatTitle: string | null;
  /** The message body this notification would carry. */
  readonly body: string;
  readonly senderName: boolean;
  readonly preview: boolean;
  readonly sound: boolean;
  /** Dimmed when the master switch is off and nothing would be raised. */
  readonly muted: boolean;
}

/**
 * The banner the shell would raise, assembled by the same two rules the chat
 * store applies before it calls `shell.notify`: the title is the chat or the
 * app, and the body is the message or a placeholder. Reading four switches out
 * of four sentences is guesswork; reading them off the banner is not.
 *
 * The sound switch has nothing else to show - a silent notification looks
 * identical - so it rides on the bell, which swaps rather than blinks.
 */
export function NotificationPreview({
  chatTitle,
  body,
  senderName,
  preview,
  sound,
  muted,
}: NotificationPreviewProps) {
  const title = senderName && chatTitle ? chatTitle : copy.appName;
  const text = preview ? body : copy.notifyIncomingMessageBody;

  return (
    <div
      role="img"
      aria-label={copy.notificationBanner}
      // A system banner is shadow-on-surface rather than bordered, which is
      // also what keeps it from reading as one more settings card. The 12px
      // radius sits inside the 16px card with 4px to spare, so the nested
      // corners stay concentric.
      className={`flex items-center gap-3 rounded-xl bg-popover p-3 shadow-[0_1px_2px_oklch(0_0_0/0.06),0_8px_20px_oklch(0_0_0/0.08)] transition-opacity duration-200 ${
        muted ? "opacity-40" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
      >
        {copy.appName.slice(0, 1)}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{title}</span>
        <span className="line-clamp-2 text-xs text-pretty text-muted-foreground">
          {text}
        </span>
      </span>
      <ActionSwapIcon
        value={sound ? "sound" : "silent"}
        className="ml-auto size-4 shrink-0 text-muted-foreground"
      >
        {sound ? (
          <Bell aria-hidden="true" className="size-4" />
        ) : (
          <BellSlash aria-hidden="true" className="size-4" />
        )}
      </ActionSwapIcon>
    </div>
  );
}
