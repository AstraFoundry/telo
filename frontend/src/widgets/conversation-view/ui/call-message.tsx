import { Phone, VideoCamera } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type {
  MessageCallDto,
  MessageCallStatus,
  TimeFormatPreference,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";

// Same shape as the transcript's own `time` helper in conversation-view.tsx
// (and the copies in chat-profile-panel.tsx / conversation-sidebar.tsx —
// this widget folder has no shared time module). "system" defers to the
// locale's hour12 default, while 12h/24h pin it explicitly.
function time(value: string, format: TimeFormatPreference): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(format === "system" ? {} : { hour12: format === "12h" }),
  }).format(new Date(value));
}

// tdesktop's `Data::MediaCall::Text`: direction and discard reason fold into
// one label — outgoing+missed reads "Cancelled", incoming+missed "Missed",
// incoming+declined "Declined". A still-running group call reads "Ongoing".
function callTitle(call: MessageCallDto): string {
  switch (call.status) {
    case "outgoing":
      return copy.outgoingCall;
    case "incoming":
      return copy.incomingCall;
    case "missed":
      return copy.missedCall;
    case "declined":
      return copy.declinedCall;
    case "cancelled":
      return copy.cancelledCall;
    case "group":
      return call.active ? copy.ongoingCall : copy.groupCall;
  }
}

// The statuses tdesktop paints in `historyCallArrowMissed` (its destructive
// accent): anything that never connected reads as a failure, not a call.
const FAILED_STATUS: Partial<Record<MessageCallStatus, true>> = {
  missed: true,
  declined: true,
  cancelled: true,
};
function callDuration(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The transcript card for a `messageCall`/`messageGroupCall` — tdesktop's
 * `HistoryView::Media::Call`. It reuses the ordinary message bubble surface
 * (the caller mounts it inside `MessageBubbleContent`) and draws the call's
 * own info: an icon on the outer edge (leading for incoming, trailing for
 * outgoing, the way tdesktop mirrors the card), the folded status title, and
 * a meta line of "time, m:ss duration".
 *
 * It is deliberately static content, not a button: telo cannot redial —
 * VoIP media is out of product scope — so the card affords nothing beyond
 * reading. Delivery ticks arrive as `trailing` so outgoing calls keep the
 * exact glyph ordinary messages show (tdesktop draws them on the card's
 * time too).
 */
export function CallMessage({
  call,
  outgoing,
  sentAt,
  timeFormat,
  trailing,
}: {
  readonly call: MessageCallDto;
  readonly outgoing: boolean;
  readonly sentAt: string;
  readonly timeFormat: TimeFormatPreference;
  /** Delivery ticks for outgoing calls; omitted for incoming ones. */
  readonly trailing?: ReactNode;
}) {
  const Icon = call.video ? VideoCamera : Phone;
  const failed = FAILED_STATUS[call.status] === true;
  const icon = (
    <span
      data-slot="call-icon"
      data-video={call.video ? "true" : undefined}
      aria-hidden="true"
      className="shrink-0 text-foreground/70"
    >
      <Icon className="size-5" />
    </span>
  );

  return (
    <div data-slot="message-call" className="flex items-center gap-3">
      {outgoing ? null : icon}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          data-slot="call-title"
          className={`font-medium ${failed ? "text-destructive" : ""}`}
        >
          {callTitle(call)}
        </span>
        <span
          data-slot="call-meta"
          className="inline-flex items-center gap-1 text-[length:var(--message-meta-font-size)] leading-none tabular-nums text-foreground/60"
        >
          <time>
            {time(sentAt, timeFormat)}
            {call.durationSeconds > 0
              ? `, ${callDuration(call.durationSeconds)}`
              : ""}
          </time>
          {trailing}
        </span>
      </div>
      {outgoing ? icon : null}
    </div>
  );
}
