import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  TelegramConnectionProfile,
  TelegramConnectionProfileRepository,
} from "../../domain/telegram/telegram-ports";

export class FileTelegramConnectionProfileRepository implements TelegramConnectionProfileRepository {
  constructor(
    private readonly filePath: string,
    private readonly encrypt: (value: string) => string,
    private readonly decrypt: (value: string) => string,
  ) {}

  async get(): Promise<TelegramConnectionProfile | null> {
    try {
      const encrypted = await readFile(this.filePath, "utf8");
      return JSON.parse(this.decrypt(encrypted)) as TelegramConnectionProfile;
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async save(profile: TelegramConnectionProfile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, this.encrypt(JSON.stringify(profile)), {
      mode: 0o600,
    });
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
