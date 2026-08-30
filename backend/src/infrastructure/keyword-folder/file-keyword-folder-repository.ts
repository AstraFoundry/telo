import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  KeywordFolder,
  type KeywordFolderSnapshot,
} from "../../domain/keyword-folder/keyword-folder";
import type { KeywordFolderRepository } from "../../domain/keyword-folder/keyword-folder-ports";

interface StoredKeywordFolders {
  readonly folders: ReadonlyArray<KeywordFolderSnapshot>;
}

const EMPTY: StoredKeywordFolders = { folders: [] };

/**
 * Persists keyword folders in a single JSON file. Definitions hold no
 * secrets, so the file stays plain JSON like `preferences.json`, with the
 * same restrictive file mode.
 */
export class FileKeywordFolderRepository implements KeywordFolderRepository {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ReadonlyArray<KeywordFolder>> {
    return (await this.read()).folders.flatMap((snapshot) => {
      try {
        return [KeywordFolder.create(snapshot)];
      } catch {
        // A corrupt or predating entry is dropped so a bad file cannot
        // block the workspace from listing native folders.
        return [];
      }
    });
  }

  async save(folder: KeywordFolder): Promise<void> {
    const snapshot = folder.snapshot();
    const stored = await this.read();
    const folders = stored.folders.some((entry) => entry.id === snapshot.id)
      ? stored.folders.map((entry) =>
          entry.id === snapshot.id ? snapshot : entry,
        )
      : [...stored.folders, snapshot];
    await this.write({ folders });
  }

  async remove(id: number): Promise<void> {
    const stored = await this.read();
    await this.write({
      folders: stored.folders.filter((entry) => entry.id !== id),
    });
  }

  private async read(): Promise<StoredKeywordFolders> {
    try {
      return JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as StoredKeywordFolders;
    } catch (error) {
      if (isMissingFile(error)) return EMPTY;
      throw error;
    }
  }

  private async write(store: StoredKeywordFolders): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), {
      mode: 0o600,
    });
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
