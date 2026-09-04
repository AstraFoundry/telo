import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  copyIntoMediaCache,
  FileTelegramAccountDatabase,
} from "./file-telegram-account-database";

describe("FileTelegramAccountDatabase", () => {
  let directory = "";

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("creates, decrypts, and clears a per-account encryption key", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "telo-tdlib-db-"));
    const keyFile = path.join(directory, "tdlib.key");
    const store = new FileTelegramAccountDatabase(
      path.join(directory, "db"),
      keyFile,
      (value) => Buffer.from(value, "utf8").toString("base64"),
      (value) => Buffer.from(value, "base64").toString("utf8"),
    );
    const first = await store.encryptionKey();
    const second = await store.encryptionKey();
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
    await mkdir(store.directory, { recursive: true });
    await store.clear();
    await expect(readFile(keyFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("copies a downloaded file into the media cache", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "telo-media-"));
    const source = path.join(directory, "source.bin");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(source, "payload");
    const cached = await copyIntoMediaCache(
      source,
      path.join(directory, "cache"),
      "tdfile_8.bin",
    );
    expect(await readFile(cached, "utf8")).toBe("payload");
  });
});
