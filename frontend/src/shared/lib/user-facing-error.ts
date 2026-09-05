/**
 * Renderer-safe error text. Kernel names, protocol codes, and language-level
 * exceptions belong in the main-process log, not next to a control.
 */
export function userFacingErrorDetail(error: unknown): string | null {
  const message =
    error instanceof Error ? error.message.trim() : String(error).trim();
  if (!message || isTechnicalErrorMessage(message)) return null;
  return message;
}

export function isTechnicalErrorMessage(message: string): boolean {
  if (
    /tdlib|tdjson|\btdl\b|teleproto|gramjs/i.test(message) ||
    /is not callable|is not a function|instanceof|Cannot read propert/i.test(
      message,
    ) ||
    /cannot send requests while disconnected/i.test(message)
  ) {
    return true;
  }
  if (/^[A-Z][A-Z0-9_]+$/.test(message)) return true;
  return /\b[A-Z]{3,}(?:_[A-Z0-9]+)+\b/.test(message);
}
