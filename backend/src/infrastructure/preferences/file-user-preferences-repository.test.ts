import { mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { UserPreferences } from "../../domain/preferences/user-preferences";
import { FileUserPreferencesRepository } from "./file-user-preferences-repository";

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "telo-preferences-"));
  return path.join(directory, "preferences.json");
}

describe("FileUserPreferencesRepository", () => {
  it("falls back to the default preferences when the file is missing", async () => {
    const repository = new FileUserPreferencesRepository(await temporaryFile());

    expect((await repository.get()).snapshot()).toEqual(
      UserPreferences.default().snapshot(),
    );
  });

  it("restores the saved preferences with a restrictive file mode", async () => {
    const filePath = await temporaryFile();
    const repository = new FileUserPreferencesRepository(filePath);
    const preferences = UserPreferences.create({
      ...UserPreferences.default().snapshot(),
      agentPanelOpen: true,
      demoWorkspace: true,
      theme: "dark",
    });

    await repository.save(preferences);

    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect((await repository.get()).snapshot()).toEqual(preferences.snapshot());
  });

  it("rejects corrupted JSON instead of falling back", async () => {
    const filePath = await temporaryFile();
    await writeFile(filePath, "not json");
    const repository = new FileUserPreferencesRepository(filePath);

    await expect(repository.get()).rejects.toThrow(SyntaxError);
  });

  it("coerces malformed persisted values to booleans", async () => {
    const filePath = await temporaryFile();
    await writeFile(
      filePath,
      JSON.stringify({ agentPanelOpen: "yes", demoWorkspace: 0 }),
    );
    const repository = new FileUserPreferencesRepository(filePath);

    expect((await repository.get()).snapshot()).toEqual(
      UserPreferences.create({
        ...UserPreferences.default().snapshot(),
        agentPanelOpen: true,
        demoWorkspace: false,
      }).snapshot(),
    );
  });

  it("falls back to the system theme for an unrecognized persisted value", async () => {
    const filePath = await temporaryFile();
    await writeFile(
      filePath,
      JSON.stringify({
        agentPanelOpen: false,
        demoWorkspace: false,
        theme: "neon",
      }),
    );
    const repository = new FileUserPreferencesRepository(filePath);

    expect((await repository.get()).snapshot().theme).toBe("system");
  });
});
