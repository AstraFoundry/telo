// Allows only protocols that are safe to hand to the OS browser; anything
// else (javascript:, data:, custom schemes) renders as plain text.
export function safeLink(value: string): string | null {
  const candidate = value.startsWith("www.") ? `https://${value}` : value;
  try {
    const url = new URL(candidate);
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
