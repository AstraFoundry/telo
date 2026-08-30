/**
 * Clipboard screenshot files arrive with a generic name ("image.png" from
 * Chromium, or none at all). Rename those to a deterministic
 * `screenshot-<timestamp>.<ext>` so the attachment tray and the sent file
 * carry a meaningful name. Files pasted from a real file manager keep their
 * own names.
 */
const GENERIC_CLIPBOARD_NAMES = new Set(["", "image.png"]);

export function namePastedFile(file: File, now: number = Date.now()): File {
  if (!GENERIC_CLIPBOARD_NAMES.has(file.name)) return file;
  const subtype = file.type.split("/")[1] ?? "";
  const extension = subtype === "jpeg" ? "jpg" : subtype || "png";
  return new File([file], `screenshot-${now}.${extension}`, {
    type: file.type,
  });
}
