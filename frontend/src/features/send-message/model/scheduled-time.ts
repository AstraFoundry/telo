/**
 * Conversions for the composer's schedule flow: the datetime-local field
 * speaks `YYYY-MM-DDTHH:mm` in local time, the IPC contract speaks unix
 * seconds, and the scheduled list shows a compact local stamp.
 */

/** Pads a local date into the `YYYY-MM-DDTHH:mm` shape the field expects. */
export function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Parses a datetime-local field value into unix seconds, or null when the
 * field is empty or unparseable.
 */
export function sendAtFromLocalInput(value: string): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : Math.floor(time / 1000);
}

/**
 * Compact stamp for a scheduled delivery: "Sep 12, 14:30", with the year
 * appended when it is not the current one — the way tdesktop's scheduled
 * view only spells out what the reader cannot assume.
 */
export function formatScheduledAt(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
