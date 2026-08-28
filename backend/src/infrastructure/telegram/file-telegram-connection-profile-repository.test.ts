import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FileTelegramConnectionProfileRepository } from "./file-telegram-connection-profile-repository";

describe("FileTelegramConnectionProfileRepository", () => {
  it("encrypts and restores application credentials", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "telo-profile-"));
    const filePath = path.join(directory, "telegram.profile");
    const repository = new FileTelegramConnectionProfileRepository(
      filePath,
      (value) => Buffer.from(value).toString("base64"),
      (value) => Buffer.from(value, "base64").toString("utf8"),
    );
    const profile = {
      apiId: 12345,
      apiHash: "hash",
      phoneNumber: "+12025550123",
    };

    await expect(repository.get()).resolves.toBeNull();
    await repository.save(profile);

    expect(await readFile(filePath, "utf8")).not.toContain("hash");
    await expect(repository.get()).resolves.toEqual(profile);
  });
});
