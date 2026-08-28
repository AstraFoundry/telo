import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  UserPreferences,
  type UserPreferencesSnapshot,
} from "../../domain/preferences/user-preferences";
import type { UserPreferencesRepository } from "../../domain/preferences/preferences-ports";

export class FileUserPreferencesRepository implements UserPreferencesRepository {
  constructor(private readonly filePath: string) {}

  async get(): Promise<UserPreferences> {
    try {
      const stored = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as UserPreferencesSnapshot;
      return UserPreferences.create(stored);
    } catch (error) {
      if (isMissingFile(error)) return UserPreferences.default();
      throw error;
    }
  }

  async save(preferences: UserPreferences): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify(preferences.snapshot(), null, 2),
      { mode: 0o600 },
    );
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
