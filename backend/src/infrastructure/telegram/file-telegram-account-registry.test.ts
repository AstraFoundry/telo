import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { TelegramAccountRegistrySnapshot } from "../../domain/telegram/telegram-account-registry";
import { FileTelegramAccountRegistry } from "./file-telegram-account-registry";

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "telo-accounts-"));
  return path.join(directory, "accounts.json");
}

const snapshot: TelegramAccountRegistrySnapshot = {
  activeAccountId: "acc-1",
  accounts: [
    {
      id: "acc-1",
      displayName: "Alice",
      username: "alice",
      avatarDataUrl: "telo-media://cache/avatar_1.jpg",
      unreadCount: 4,
      createdAt: "2026-09-01T10:00:00.000Z",
      lastActiveAt: "2026-09-02T10:00:00.000Z",
    },
    {
      id: "acc-2",
      displayName: "Bob",
      username: null,
      avatarDataUrl: null,
      unreadCount: 0,
      createdAt: "2026-09-01T11:00:00.000Z",
      lastActiveAt: "2026-09-01T12:00:00.000Z",
    },
  ],
};

describe("FileTelegramAccountRegistry", () => {
  it("answers null before the first save so migration can run", async () => {
    const registry = new FileTelegramAccountRegistry(await temporaryFile());

    await expect(registry.get()).resolves.toBeNull();
  });

  it("round-trips the ordered accounts and the active pointer", async () => {
    const registry = new FileTelegramAccountRegistry(await temporaryFile());

    await registry.save(snapshot);

    await expect(registry.get()).resolves.toEqual(snapshot);
  });

  it("distinguishes an empty registry from a missing one", async () => {
    const registry = new FileTelegramAccountRegistry(await temporaryFile());

    await registry.save({ accounts: [], activeAccountId: null });

    // Every account was logged out: this is not the pre-registry world, so
    // the caller must not re-run the legacy migration.
    await expect(registry.get()).resolves.toEqual({
      accounts: [],
      activeAccountId: null,
    });
  });

  it("writes the whole file in one shot, leaving no temp file behind", async () => {
    const filePath = await temporaryFile();
    const registry = new FileTelegramAccountRegistry(filePath);

    await registry.save(snapshot);

    const stored = JSON.parse(await readFile(filePath, "utf8")) as {
      version: number;
      activeAccountId: string;
    };
    expect(stored.version).toBe(1);
    expect(stored.activeAccountId).toBe("acc-1");
    await expect(readFile(`${filePath}.tmp`, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reports a corrupt file as an empty registry instead of re-migrating", async () => {
    const filePath = await temporaryFile();
    await writeFile(filePath, "{ not json");
    const registry = new FileTelegramAccountRegistry(filePath);

    await expect(registry.get()).resolves.toEqual({
      accounts: [],
      activeAccountId: null,
    });
  });

  it("falls back to the first account when the active id dangles", async () => {
    const registry = new FileTelegramAccountRegistry(await temporaryFile());

    await registry.save({ ...snapshot, activeAccountId: "gone" });

    await expect(registry.get()).resolves.toMatchObject({
      activeAccountId: "acc-1",
    });
  });
});
