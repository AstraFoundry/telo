import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  utimes,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MEDIA_CACHE_MAX_BYTES,
  avatarCacheFileName,
  avatarMediaUrl,
  chatIdFromAvatarFileName,
  clearMediaCache,
  enforceMediaCacheLimit,
  listCachedAvatarUrls,
  mediaCacheUsageBytes,
  touchMediaCacheFile,
} from "./media-cache";

describe("enforceMediaCacheLimit", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "telo-media-cache-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function stage(name: string, size: number, mtime: Date): Promise<void> {
    const filePath = path.join(directory, name);
    await writeFile(filePath, Buffer.alloc(size));
    await utimes(filePath, mtime, mtime);
  }

  it("keeps every file when the cache fits the cap", async () => {
    await stage("a.bin", 40, new Date("2026-08-01T00:00:00Z"));
    await stage("b.bin", 30, new Date("2026-08-02T00:00:00Z"));

    await enforceMediaCacheLimit(directory, 100);

    expect((await readdir(directory)).sort()).toEqual(["a.bin", "b.bin"]);
  });

  it("evicts the least recently used files until the cache fits", async () => {
    await stage("old.bin", 60, new Date("2026-08-01T00:00:00Z"));
    await stage("mid.bin", 60, new Date("2026-08-02T00:00:00Z"));
    await stage("new.bin", 60, new Date("2026-08-03T00:00:00Z"));

    await enforceMediaCacheLimit(directory, 100);

    expect(await readdir(directory)).toEqual(["new.bin"]);
  });

  it("never evicts the newest file, even when it alone exceeds the cap", async () => {
    await stage("huge.bin", 500, new Date("2026-08-03T00:00:00Z"));
    await stage("stale.bin", 10, new Date("2026-08-01T00:00:00Z"));

    await enforceMediaCacheLimit(directory, 100);

    expect(await readdir(directory)).toEqual(["huge.bin"]);
  });

  it("treats a missing directory as an empty cache", async () => {
    await expect(
      enforceMediaCacheLimit(path.join(directory, "missing"), 100),
    ).resolves.toBeUndefined();
  });

  it("honours a caller-supplied limit instead of the default cap", async () => {
    await stage("old.bin", 80, new Date("2026-08-01T00:00:00Z"));
    await stage("new.bin", 80, new Date("2026-08-02T00:00:00Z"));

    // Both files fit the 512 MiB const many times over, so an eviction here
    // can only come from the limit the caller passed.
    await enforceMediaCacheLimit(directory, 100);
    expect(await readdir(directory)).toEqual(["new.bin"]);

    await stage("old.bin", 80, new Date("2026-08-01T00:00:00Z"));
    await enforceMediaCacheLimit(directory, MEDIA_CACHE_MAX_BYTES);
    expect((await readdir(directory)).sort()).toEqual(["new.bin", "old.bin"]);
  });

  it("exposes a 512 MB default cap", () => {
    expect(MEDIA_CACHE_MAX_BYTES).toBe(512 * 1024 ** 2);
  });
});

describe("mediaCacheUsageBytes", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "telo-media-usage-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("sums the size of every cached file", async () => {
    await writeFile(path.join(directory, "a.bin"), Buffer.alloc(40));
    await writeFile(path.join(directory, "b.bin"), Buffer.alloc(1024));
    await mkdir(path.join(directory, "nested"));

    expect(await mediaCacheUsageBytes(directory)).toBe(1064);
  });

  it("reports an empty cache as zero bytes", async () => {
    expect(await mediaCacheUsageBytes(directory)).toBe(0);
  });

  it("reports a missing directory as zero bytes", async () => {
    expect(await mediaCacheUsageBytes(path.join(directory, "missing"))).toBe(0);
  });
});

describe("clearMediaCache", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "telo-media-clear-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("deletes every cached file and answers the reclaimed bytes", async () => {
    await writeFile(path.join(directory, "a.bin"), Buffer.alloc(40));
    await writeFile(path.join(directory, "b.bin"), Buffer.alloc(60));

    expect(await clearMediaCache(directory)).toBe(100);
    expect(await readdir(directory)).toEqual([]);
    expect(await mediaCacheUsageBytes(directory)).toBe(0);
  });

  it("reclaims nothing from a missing directory", async () => {
    expect(await clearMediaCache(path.join(directory, "missing"))).toBe(0);
  });
});

describe("touchMediaCacheFile", () => {
  it("refreshes the file mtime so it ranks as recently used", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "telo-media-cache-"));
    try {
      const filePath = path.join(directory, "hit.bin");
      await writeFile(filePath, "data");
      const stale = new Date("2026-08-01T00:00:00Z");
      await utimes(filePath, stale, stale);

      await touchMediaCacheFile(filePath);

      const { mtimeMs } = await import("node:fs/promises").then(({ stat }) =>
        stat(filePath),
      );
      expect(mtimeMs).toBeGreaterThan(stale.getTime());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("avatar cache files", () => {
  it("names a flat jpeg and maps it back to the chat id", () => {
    expect(avatarCacheFileName("123")).toBe("avatar_123.jpg");
    expect(chatIdFromAvatarFileName("avatar_123.jpg")).toBe("123");
    expect(chatIdFromAvatarFileName("photo.bin")).toBeNull();
    expect(avatarMediaUrl("avatar_123.jpg")).toBe(
      "telo-media://cache/avatar_123.jpg",
    );
  });

  it("lists protocol URLs for avatar files already on disk", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "telo-avatars-"));
    try {
      await writeFile(path.join(directory, "avatar_9.jpg"), Buffer.from("x"));
      await writeFile(path.join(directory, "other.bin"), Buffer.from("y"));
      const urls = await listCachedAvatarUrls(directory);
      expect([...urls.entries()]).toEqual([
        ["9", "telo-media://cache/avatar_9.jpg"],
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
