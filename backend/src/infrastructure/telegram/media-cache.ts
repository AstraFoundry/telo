import path from "node:path";
import { readdir, rm, stat, utimes } from "node:fs/promises";
import type { Dirent } from "node:fs";

/**
 * Default disk budget for the media cache, used until a caller passes the
 * user's `mediaCacheLimitMb` preference. Least-recently-used files are
 * evicted past whichever budget applies.
 */
export const MEDIA_CACHE_MAX_BYTES = 512 * 1024 ** 2;

interface CacheFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * LRU governance for the media cache directory: when the total size exceeds
 * `maxBytes`, the least recently used files (recency is tracked through
 * mtime; reads refresh it via `touchMediaCacheFile`) are deleted until the
 * cache fits again. The newest file is never evicted, even when it alone
 * exceeds the cap — deleting the file the user just downloaded would
 * immediately break the viewer it was fetched for.
 */
export async function enforceMediaCacheLimit(
  directory: string,
  maxBytes = MEDIA_CACHE_MAX_BYTES,
): Promise<void> {
  const files = await listCacheFiles(directory);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  const byOldest = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const file of byOldest.slice(0, -1)) {
    if (total <= maxBytes) break;
    await rm(file.path, { force: true });
    total -= file.size;
  }
}

/** Bytes the cache holds on disk right now; a missing cache holds none. */
export async function mediaCacheUsageBytes(directory: string): Promise<number> {
  const files = await listCacheFiles(directory);
  return files.reduce((sum, file) => sum + file.size, 0);
}

/**
 * Deletes every cached file and answers the bytes reclaimed. Unlike eviction
 * this spares nothing: the user asked for the disk back, and the viewer
 * re-downloads whatever it still needs.
 */
export async function clearMediaCache(directory: string): Promise<number> {
  let reclaimed = 0;
  for (const file of await listCacheFiles(directory)) {
    await rm(file.path, { force: true });
    reclaimed += file.size;
  }
  return reclaimed;
}

// Each account's cache is flat (the media protocol rejects nested paths),
// but the userData root holds one such directory per account plus the
// pre-multi-account flat files, so the walk recurses into subdirectories.
// A cache directory that does not exist yet reads as empty; entries that
// vanish mid-walk are skipped.
async function listCacheFiles(
  directory: string,
): Promise<ReadonlyArray<CacheFile>> {
  let entries: ReadonlyArray<Dirent>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: CacheFile[] = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listCacheFiles(filePath)));
      continue;
    }
    if (!entry.isFile()) continue;
    const details = await stat(filePath).catch(() => null);
    if (!details) continue;
    files.push({
      path: filePath,
      size: details.size,
      mtimeMs: details.mtimeMs,
    });
  }
  return files;
}

/** Marks a cache hit so LRU eviction ranks the file as recently used. */
export async function touchMediaCacheFile(filePath: string): Promise<void> {
  const now = new Date();
  await utimes(filePath, now, now);
}

/** Current on-disk generation: 640px `big` (or ≥320px `chatPhoto` size). */
const SHARP_AVATAR_PREFIX = "avatar2_";
/** Pre-sharp 160px `small` files; still painted until the 640px copy lands. */
const LEGACY_AVATAR_PREFIX = "avatar_";

function sanitizeAvatarPeerId(chatId: string): string {
  return chatId.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Flat cache file for a dialog photo; the media protocol rejects nested paths. */
export function avatarCacheFileName(chatId: string): string {
  return `${SHARP_AVATAR_PREFIX}${sanitizeAvatarPeerId(chatId)}.jpg`;
}

export function chatIdFromAvatarFileName(fileName: string): string | null {
  if (!fileName.endsWith(".jpg")) return null;
  if (fileName.startsWith(SHARP_AVATAR_PREFIX)) {
    return fileName.slice(SHARP_AVATAR_PREFIX.length, -".jpg".length);
  }
  if (fileName.startsWith(LEGACY_AVATAR_PREFIX)) {
    return fileName.slice(LEGACY_AVATAR_PREFIX.length, -".jpg".length);
  }
  return null;
}

export function isSharpAvatarCacheFile(fileName: string): boolean {
  return fileName.startsWith(SHARP_AVATAR_PREFIX) && fileName.endsWith(".jpg");
}

/** True when the protocol URL points at a 640px-generation cache file. */
export function isSharpAvatarCacheUrl(url: string): boolean {
  return url.includes(SHARP_AVATAR_PREFIX);
}

export function avatarMediaUrl(fileName: string): string {
  return `telo-media://cache/${encodeURIComponent(fileName)}`;
}

/** Map chat id → telo-media URL for avatar files already on disk. */
export async function listCachedAvatarUrls(
  directory: string,
): Promise<ReadonlyMap<string, string>> {
  let entries: ReadonlyArray<string>;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const urls = new Map<string, string>();
  for (const entry of entries) {
    const chatId = chatIdFromAvatarFileName(entry);
    if (!chatId) continue;
    const existing = urls.get(chatId);
    if (
      existing &&
      isSharpAvatarCacheUrl(existing) &&
      !isSharpAvatarCacheFile(entry)
    ) {
      continue;
    }
    urls.set(chatId, avatarMediaUrl(entry));
  }
  return urls;
}
