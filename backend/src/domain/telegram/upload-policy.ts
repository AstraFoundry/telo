/**
 * Telegram's vendor upload limits, shared by the IPC boundary (shape
 * validation) and the application layer (re-validation) so the two never
 * drift.
 */

/** Telegram albums carry at most ten files per send. */
export const MAX_ALBUM_FILES = 10;

/** Telegram rejects user uploads past 2 GB per file. */
export const MAX_UPLOAD_FILE_BYTES = 2 * 1024 ** 3;

/** Story photos are capped at 10 MB; story videos are not bound by this budget. */
export const STORY_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
