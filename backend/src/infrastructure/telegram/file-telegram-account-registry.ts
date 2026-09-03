import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  TelegramAccountRecord,
  TelegramAccountRegistry,
  TelegramAccountRegistrySnapshot,
} from "../../domain/telegram/telegram-account-registry";

const REGISTRY_VERSION = 1 as const;

/**
 * `accounts.json` in Electron's userData directory. The file holds no
 * secrets (session strings live in the per-account `telegram-<id>.session`
 * files), so it is plain JSON with a restrictive mode, like
 * `preferences.json`.
 */
export class FileTelegramAccountRegistry implements TelegramAccountRegistry {
  constructor(private readonly filePath: string) {}

  async get(): Promise<TelegramAccountRegistrySnapshot | null> {
    let stored: unknown;
    try {
      stored = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      // A missing file is the pre-registry world: the caller migrates the
      // legacy single-account files. A corrupt one is unrecoverable, but it
      // must not re-run that migration — report it as an empty registry.
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      if (error instanceof SyntaxError)
        return { accounts: [], activeAccountId: null };
      throw error;
    }
    if (
      typeof stored !== "object" ||
      stored === null ||
      (stored as { version?: unknown }).version !== REGISTRY_VERSION ||
      !Array.isArray((stored as { accounts?: unknown }).accounts)
    ) {
      return { accounts: [], activeAccountId: null };
    }
    const raw = stored as {
      accounts: ReadonlyArray<Partial<TelegramAccountRecord>>;
      activeAccountId?: unknown;
    };
    // Coerce rather than reject: a hand-edited or partially written record
    // should degrade to defaults, not strand the accounts that parse.
    const accounts = raw.accounts
      .filter((account) => typeof account?.id === "string" && account.id)
      .map((account) => ({
        id: account.id as string,
        displayName:
          typeof account.displayName === "string" ? account.displayName : "",
        username:
          typeof account.username === "string" ? account.username : null,
        avatarDataUrl:
          typeof account.avatarDataUrl === "string"
            ? account.avatarDataUrl
            : null,
        unreadCount:
          typeof account.unreadCount === "number" ? account.unreadCount : 0,
        createdAt:
          typeof account.createdAt === "string" ? account.createdAt : "",
        lastActiveAt:
          typeof account.lastActiveAt === "string" ? account.lastActiveAt : "",
      }));
    const activeAccountId =
      typeof raw.activeAccountId === "string" &&
      accounts.some((account) => account.id === raw.activeAccountId)
        ? raw.activeAccountId
        : (accounts[0]?.id ?? null);
    return { accounts, activeAccountId };
  }

  // Saves are serialized: the switcher persists from several async flows
  // (identity refresh, park, activate) that must never race the shared
  // temp file of the atomic write below.
  private tail: Promise<void> = Promise.resolve();

  save(snapshot: TelegramAccountRegistrySnapshot): Promise<void> {
    const write = this.tail.then(() => this.writeSnapshot(snapshot));
    this.tail = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  private async writeSnapshot(
    snapshot: TelegramAccountRegistrySnapshot,
  ): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    // Write-then-rename keeps the registry atomic: a crash mid-write leaves
    // either the old or the new file, never a truncated one whose loss
    // would strand the per-account session files it points at.
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(
      temporaryPath,
      JSON.stringify(
        {
          version: REGISTRY_VERSION,
          activeAccountId: snapshot.activeAccountId,
          accounts: snapshot.accounts,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await rename(temporaryPath, this.filePath);
  }
}
