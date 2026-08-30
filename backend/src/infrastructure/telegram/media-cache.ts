import path from "node:path";
import { readdir, rm, stat, utimes } from "node:fs/promises";

/** Disk budget for the media cache; least-recently-used files are evicted past it. */
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
  let entries: ReadonlyArray<string>;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const files: CacheFile[] = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry);
    const details = await stat(filePath).catch(() => null);
    if (!details?.isFile()) continue;
    files.push({
      path: filePath,
      size: details.size,
      mtimeMs: details.mtimeMs,
    });
  }
  let total = files.reduce((sum, file) => sum + file.size, 0);
  const byOldest = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const file of byOldest.slice(0, -1)) {
    if (total <= maxBytes) break;
    await rm(file.path, { force: true });
    total -= file.size;
  }
}

/** Marks a cache hit so LRU eviction ranks the file as recently used. */
export async function touchMediaCacheFile(filePath: string): Promise<void> {
  const now = new Date();
  await utimes(filePath, now, now);
}
