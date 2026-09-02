/**
 * The on-disk media cache seen as reclaimable storage. The adapter owns the
 * directory layout; the settings surface only needs to know how much space
 * the cache holds and how to give it back.
 */
export interface MediaCacheStore {
  /** Bytes the cache currently holds. */
  usageBytes(): Promise<number>;
  /** Deletes every cached file and answers the bytes reclaimed. */
  clear(): Promise<number>;
}
