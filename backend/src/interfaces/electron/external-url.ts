const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:"]);

/** Allows only protocols that are intentionally handed to the operating OS. */
export function isSafeExternalUrl(value: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
