export interface MentionQuery {
  /** UTF-16 offset of the triggering `@`. */
  readonly start: number;
  /** Text after `@` up to the caret; empty while the user just typed `@`. */
  readonly query: string;
}

export interface MentionQueryOptions {
  /**
   * Let the query span words, for pickers that complete display names
   * ("@Lev Kim") rather than handles. The caller closes the list once nothing
   * matches, so an ordinary sentence after a stray `@` never keeps it open.
   */
  readonly allowSpaces?: boolean;
}

/**
 * Returns the in-progress `@mention` at `caret` when the `@` starts a token
 * (start of string or after whitespace). Handle-style queries accept username
 * characters only; `allowSpaces` additionally accepts single spaces between
 * words. Mid-word `@` never matches.
 */
export function mentionQueryAtCaret(
  body: string,
  caret: number,
  options: MentionQueryOptions = {},
): MentionQuery | null {
  if (caret < 0 || caret > body.length) return null;
  const before = body.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
  const query = before.slice(at + 1);
  const shape = options.allowSpaces
    ? /^[^\s@]*(?: [^\s@]+)*(?: )?$/u
    : /^[A-Za-z0-9_]*$/;
  if (!shape.test(query)) return null;
  return { start: at, query };
}

/** One row of a mention picker; the shape every caller maps its data into. */
export interface MentionItem {
  readonly id: string;
  /** Primary text, usually a display name or chat title. */
  readonly label: string;
  /** Secondary text such as `@handle`; matched by prefix. */
  readonly description: string | null;
  readonly avatarUrl: string | null;
  readonly avatarPending?: boolean;
}

/**
 * Items whose description starts with the query or whose label contains it,
 * compared case-insensitively. An empty query keeps every item.
 */
export function filterMentionItems<T extends MentionItem>(
  items: ReadonlyArray<T>,
  query: string,
): T[] {
  const needle = query.toLocaleLowerCase();
  return items.filter(
    (item) =>
      item.description?.toLocaleLowerCase().startsWith(needle) ||
      item.description?.toLocaleLowerCase().startsWith(`@${needle}`) ||
      item.label.toLocaleLowerCase().includes(needle),
  );
}
