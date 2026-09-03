/**
 * Account-switcher persistence port, mirroring tdesktop's `Main::Domain`:
 * several signed-in accounts on one device, exactly one of them active and
 * connected. The registry is the switcher's source of truth; everything
 * else (session, profile, dialog snapshot, media cache) lives in
 * per-account files the registry's account ids name.
 */

/**
 * One signed-in Telegram account as the switcher persists it. Identity
 * fields refresh from the account's `CurrentUserDto` whenever it connects;
 * `unreadCount` is the last total captured while the account was active —
 * only the active account stays connected, so an inactive account's count
 * is never a live number.
 */
export interface TelegramAccountRecord {
  /** Stable id assigned at first login; never the Telegram user id. */
  readonly id: string;
  readonly displayName: string;
  readonly username: string | null;
  readonly avatarDataUrl: string | null;
  readonly unreadCount: number;
  /** ISO timestamps; `lastActiveAt` orders "most recently used". */
  readonly createdAt: string;
  readonly lastActiveAt: string;
}

/**
 * The persisted switcher state. `accounts` is display order: the active
 * account first, then the most recently used. `activeAccountId` names the
 * account the workspace attaches to; null only when no account has ever
 * signed in.
 */
export interface TelegramAccountRegistrySnapshot {
  readonly accounts: ReadonlyArray<TelegramAccountRecord>;
  readonly activeAccountId: string | null;
}

/**
 * Implementations answer `null` from `get()` until the first `save()`, so
 * the caller can tell "no registry yet" (run the legacy single-account
 * migration) apart from "registry with zero accounts" (every account was
 * logged out).
 */
export interface TelegramAccountRegistry {
  get(): Promise<TelegramAccountRegistrySnapshot | null>;
  save(snapshot: TelegramAccountRegistrySnapshot): Promise<void>;
}
