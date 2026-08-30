import { KeywordFolder } from "../../domain/keyword-folder/keyword-folder";
import type { KeywordFolderRepository } from "../../domain/keyword-folder/keyword-folder-ports";

/** Deterministic demo folder: query "spacing" matches the Telo Design fixture. */
export const DEMO_KEYWORD_FOLDER_ID = -1;
export const DEMO_KEYWORD_FOLDER_TITLE = "Spacing";
export const DEMO_KEYWORD_FOLDER_QUERY = "spacing";

/**
 * In-memory keyword folders for the demo workspace. Seeded with one folder
 * that matches a fixture chat so e2e can open the tab without setup.
 */
export class DemoKeywordFolderRepository implements KeywordFolderRepository {
  private readonly folders = new Map<number, KeywordFolder>([
    [
      DEMO_KEYWORD_FOLDER_ID,
      KeywordFolder.create({
        id: DEMO_KEYWORD_FOLDER_ID,
        title: DEMO_KEYWORD_FOLDER_TITLE,
        query: DEMO_KEYWORD_FOLDER_QUERY,
      }),
    ],
  ]);

  async list(): Promise<ReadonlyArray<KeywordFolder>> {
    return [...this.folders.values()];
  }

  async save(folder: KeywordFolder): Promise<void> {
    this.folders.set(folder.id, folder);
  }

  async remove(id: number): Promise<void> {
    this.folders.delete(id);
  }
}
