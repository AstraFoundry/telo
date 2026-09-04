import { mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type { TelegramAccountDatabase } from "../../domain/telegram/telegram-ports";

export class FileTelegramAccountDatabase implements TelegramAccountDatabase {
  constructor(
    readonly directory: string,
    private readonly keyFile: string,
    private readonly encrypt: (value: string) => string,
    private readonly decrypt: (value: string) => string,
  ) {}

  async encryptionKey(): Promise<string> {
    try {
      return this.decrypt(await readFile(this.keyFile, "utf8"));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      const key = randomBytes(32).toString("base64");
      await mkdir(path.dirname(this.keyFile), { recursive: true });
      await writeFile(this.keyFile, this.encrypt(key), { mode: 0o600 });
      return key;
    }
  }

  async clear(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
    await rm(this.keyFile, { force: true });
  }
}

export async function copyIntoMediaCache(
  sourcePath: string,
  cacheDirectory: string,
  fileName: string,
): Promise<string> {
  await mkdir(cacheDirectory, { recursive: true });
  const destination = path.join(cacheDirectory, fileName);
  await copyFile(sourcePath, destination);
  return destination;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
