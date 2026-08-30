import { mkdtemp, rm, writeFile, utimes, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MEDIA_CACHE_MAX_BYTES,
  enforceMediaCacheLimit,
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

  it("exposes a 512 MB default cap", () => {
    expect(MEDIA_CACHE_MAX_BYTES).toBe(512 * 1024 ** 2);
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
