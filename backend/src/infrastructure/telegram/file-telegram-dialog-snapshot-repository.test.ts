import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ChatDto } from "../../../../contracts/src/ipc";
import {
  FileTelegramDialogSnapshotRepository,
  dialogSnapshotPage,
} from "./file-telegram-dialog-snapshot-repository";

function chat(id: string): ChatDto {
  return {
    id,
    title: `Chat ${id}`,
    preview: "hello",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unreadCount: 1,
    lastReadMessageId: "9",
    muted: false,
    pinned: false,
    kind: "direct",
    initials: "C",
    avatarDataUrl: "data:image/png;base64,qq",
    draftPreview: null,
    typing: true,
    folderId: null,
  };
}

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "telo-dialogs-"));
  return path.join(directory, "dialogs.json");
}

describe("FileTelegramDialogSnapshotRepository", () => {
  it("returns null when the file is missing", async () => {
    const repository = new FileTelegramDialogSnapshotRepository(
      await temporaryFile(),
    );
    await expect(repository.get()).resolves.toBeNull();
  });

  it("persists chats without avatar bytes or typing state", async () => {
    const filePath = await temporaryFile();
    const repository = new FileTelegramDialogSnapshotRepository(filePath);
    await repository.save({
      version: 1,
      chats: [chat("a")],
      folders: [{ id: 2, title: "Work", unreadCount: 3 }],
      nextCursor: {
        chatId: "a",
        topMessageId: "9",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(await readFile(filePath, "utf8")).not.toContain("data:image/png");
    const stored = await repository.get();
    expect(stored?.chats[0]).toMatchObject({
      id: "a",
      avatarDataUrl: null,
      typing: false,
    });
    expect(stored?.folders).toEqual([{ id: 2, title: "Work", unreadCount: 3 }]);
  });

  it("returns null for a corrupt or version-mismatched file", async () => {
    const filePath = await temporaryFile();
    await writeFile(filePath, "{not-json", { mode: 0o600 });
    const repository = new FileTelegramDialogSnapshotRepository(filePath);
    await expect(repository.get()).resolves.toBeNull();

    await writeFile(filePath, JSON.stringify({ version: 2, chats: [], folders: [] }), {
      mode: 0o600,
    });
    await expect(repository.get()).resolves.toBeNull();
  });

  it("clear() removes the snapshot file", async () => {
    const filePath = await temporaryFile();
    const repository = new FileTelegramDialogSnapshotRepository(filePath);
    await repository.save({
      version: 1,
      chats: [chat("a")],
      folders: [],
      nextCursor: null,
    });
    await repository.clear();
    await expect(repository.get()).resolves.toBeNull();
  });
});

describe("dialogSnapshotPage", () => {
  it("returns the first page and a cursor when more chats are stored", () => {
    const chats = [chat("a"), chat("b"), chat("c")];
    expect(
      dialogSnapshotPage(
        { version: 1, chats, folders: [], nextCursor: null },
        { limit: 2 },
      ),
    ).toEqual({
      items: [chats[0], chats[1]],
      nextCursor: {
        chatId: "b",
        topMessageId: "9",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });
});
