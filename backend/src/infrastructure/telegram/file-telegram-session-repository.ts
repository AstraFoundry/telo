import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TelegramSessionRepository } from "../../domain/telegram/telegram-ports";

export class FileTelegramSessionRepository implements TelegramSessionRepository {
  constructor(
    private readonly filePath: string,
    private readonly encrypt: (value: string) => string,
    private readonly decrypt: (value: string) => string,
  ) {}

  async get(): Promise<string> {
    try {
      return this.decrypt(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (isMissingFile(error)) return "";
      throw error;
    }
  }

  async save(session: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, this.encrypt(session), { mode: 0o600 });
  }

  async clear(): Promise<void> {
    try {
      await rm(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
