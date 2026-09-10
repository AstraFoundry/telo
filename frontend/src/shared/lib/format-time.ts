import type { TimeFormatPreference } from "../../../../contracts/src/ipc";

/**
 * Hour/minute formatter shared by the transcript, sidebar rows, call cards,
 * and the profile panel. "system" defers to the locale's hour12 default,
 * while 12h/24h pin it explicitly.
 */
export function formatTime(
  value: string,
  format: TimeFormatPreference,
): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(format === "system" ? {} : { hour12: format === "12h" }),
  }).format(new Date(value));
}
