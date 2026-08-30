import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { KeywordFolder } from "../../domain/keyword-folder/keyword-folder";
import { FileKeywordFolderRepository } from "./file-keyword-folder-repository";

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "telo-keyword-folders-"),
  );
  return path.join(directory, "keyword-folders.json");
}

describe("FileKeywordFolderRepository", () => {
  it("returns an empty list when the file is missing", async () => {
    const repository = new FileKeywordFolderRepository(await temporaryFile());
    expect(await repository.list()).toEqual([]);
  });

  it("persists folders across instances with a restrictive file mode", async () => {
    const filePath = await temporaryFile();
    const repository = new FileKeywordFolderRepository(filePath);
    const folder = KeywordFolder.create({
      id: -1,
      title: "Spacing",
      query: "spacing",
    });
    await repository.save(folder);

    const reloaded = new FileKeywordFolderRepository(filePath);
    expect((await reloaded.list()).map((entry) => entry.snapshot())).toEqual([
      folder.snapshot(),
    ]);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      folders: [folder.snapshot()],
    });
  });

  it("updates an existing folder and removes by id", async () => {
    const filePath = await temporaryFile();
    const repository = new FileKeywordFolderRepository(filePath);
    await repository.save(
      KeywordFolder.create({ id: -1, title: "Spacing", query: "spacing" }),
    );
    await repository.save(
      KeywordFolder.create({ id: -1, title: "Retry", query: "retry" }),
    );
    expect((await repository.list()).map((entry) => entry.snapshot())).toEqual([
      { id: -1, title: "Retry", query: "retry" },
    ]);

    await repository.remove(-1);
    expect(await repository.list()).toEqual([]);
  });
});
