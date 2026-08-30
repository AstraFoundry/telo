/**
 * A chat belongs to a keyword folder when any message body contains the
 * folder's query as a case-insensitive substring. Matching is deliberately
 * simple (no word boundaries, no regex) so the rule is inspectable and
 * stable across the demo workspace and live Telegram search results.
 */
export function messageBodyMatchesKeyword(
  body: string,
  query: string,
): boolean {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return false;
  return body.toLocaleLowerCase().includes(term);
}

export const KEYWORD_FOLDERS_MAX = 20;
export const KEYWORD_FOLDER_TITLE_MAX = 80;
export const KEYWORD_FOLDER_QUERY_MAX = 200;

export interface KeywordFolderSnapshot {
  readonly id: number;
  readonly title: string;
  readonly query: string;
}

export class KeywordFolder {
  private constructor(private readonly value: KeywordFolderSnapshot) {}

  static create(input: KeywordFolderSnapshot): KeywordFolder {
    if (!Number.isInteger(input.id) || input.id >= 0) {
      throw new Error("Keyword folder id must be a negative integer");
    }
    const title = input.title.trim();
    const query = input.query.trim();
    if (!title) throw new Error("Keyword folder title is required");
    if (!query) throw new Error("Keyword folder query is required");
    if (title.length > KEYWORD_FOLDER_TITLE_MAX) {
      throw new Error(
        `Keyword folder title must be at most ${KEYWORD_FOLDER_TITLE_MAX} characters`,
      );
    }
    if (query.length > KEYWORD_FOLDER_QUERY_MAX) {
      throw new Error(
        `Keyword folder query must be at most ${KEYWORD_FOLDER_QUERY_MAX} characters`,
      );
    }
    return new KeywordFolder({ id: input.id, title, query });
  }

  get id(): number {
    return this.value.id;
  }

  get title(): string {
    return this.value.title;
  }

  get query(): string {
    return this.value.query;
  }

  update(input: { title: string; query: string }): KeywordFolder {
    return KeywordFolder.create({
      id: this.value.id,
      title: input.title,
      query: input.query,
    });
  }

  snapshot(): KeywordFolderSnapshot {
    return { ...this.value };
  }
}

/** Next unused negative id; the first folder is `-1`. */
export function nextKeywordFolderId(
  folders: ReadonlyArray<KeywordFolder>,
): number {
  if (folders.length === 0) return -1;
  return Math.min(...folders.map((folder) => folder.id)) - 1;
}
