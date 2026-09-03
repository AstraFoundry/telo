/**
 * The search-history list, as both reference clients model it: recency-ordered
 * chat ids, most recent first, deduplicated by moving a repeat to the front,
 * capped at twenty (Telegram Web K's limit, `appUsersManager.ts:277-293`).
 */
export const RECENT_SEARCHES_MAX = 20;

/**
 * Records a result the reader opened. History is written on selection, never
 * on typing or on searching — both clients push on the result row's click
 * only, so an abandoned query leaves no trace.
 */
export function pushRecentSearch(
  list: ReadonlyArray<string>,
  chatId: string,
): ReadonlyArray<string> {
  if (!chatId) return list;
  return [chatId, ...list.filter((id) => id !== chatId)].slice(
    0,
    RECENT_SEARCHES_MAX,
  );
}

export function removeRecentSearch(
  list: ReadonlyArray<string>,
  chatId: string,
): ReadonlyArray<string> {
  return list.filter((id) => id !== chatId);
}
