import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FileTelegramSessionRepository } from "./file-telegram-session-repository";

function repositoryAt(filePath: string): FileTelegramSessionRepository {
  return new FileTelegramSessionRepository(
    filePath,
    (value) => Buffer.from(value).toString("base64"),
    (value) => Buffer.from(value, "base64").toString("utf8"),
  );
}

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "telo-session-"));
  return path.join(directory, "telegram.session");
}

describe("FileTelegramSessionRepository", () => {
  it("returns an empty session when the file is missing", async () => {
    const repository = repositoryAt(await temporaryFile());

    await expect(repository.get()).resolves.toBe("");
  });

  it("encrypts the session on disk with restrictive permissions", async () => {
    const filePath = await temporaryFile();
    const repository = repositoryAt(filePath);

    await repository.save("session-data");

    expect(await readFile(filePath, "utf8")).not.toContain("session-data");
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    await expect(repository.get()).resolves.toBe("session-data");
  });

  it("clear() removes the stored session", async () => {
    const filePath = await temporaryFile();
    const repository = repositoryAt(filePath);
    await repository.save("session-data");

    await repository.clear();

    await expect(repository.get()).resolves.toBe("");
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clear() is a no-op when no session file exists", async () => {
    const repository = repositoryAt(await temporaryFile());

    await expect(repository.clear()).resolves.toBeUndefined();
  });
});
