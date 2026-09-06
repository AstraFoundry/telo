# Local persistence

Telo does not use an application ORM. Agent, preferences, and the account registry stay as small files under Electron's per-user data directory. Telegram client data lives in TDLib's per-account SQLite tree.

- `agent.json`: agent configuration with an encrypted API key and encrypted OAuth tokens, restrictive file mode.
- `agent-threads.json`: agent conversation transcripts and the active-thread pointer. They hold no secrets, so the file is plain JSON with a restrictive file mode.
- `agent-automation-rules.json`: trigger rules (match dimensions, delivery mode, prompt template, enabled flag, creator). No secrets; plain JSON with a restrictive file mode.
- `agent-automation-tasks.json`: scheduled tasks (cron or one-shot schedule, delivery chat and mode, prompt template, optional context scope, `lastRunAt`). No secrets; plain JSON with a restrictive file mode.
- `accounts.json`: the Telegram account registry (plain JSON, restrictive mode, atomic write-then-rename). Ordered account records `{ id, displayName, username, avatarDataUrl, avatarPlaceholder, unreadCount, createdAt, lastActiveAt }` — active first, then most recently used — plus `activeAccountId`. `avatarPlaceholder` is the empty userpic (glyph plus accent fills) used when `avatarDataUrl` is null. Holds no secrets.
- `telegram-<id>.profile`: one Telegram connection profile per account (application credentials and phone number), encrypted with Electron `safeStorage`.
- `tdlib/<id>/`: TDLib database and files directory for that account (`use_message_database: true`, `use_secret_chats: true`). Encrypted with a key stored in `tdlib-<id>.key` via `safeStorage`. This is the source of truth for chats and messages after restart. Logging out deletes the directory and key. Switching accounts only `close()`s the client — the parked directory stays on disk so switching back restores it.
- `preferences.json`: user preferences (agent panel visibility, demo workspace flag, interface theme, accent color, message text size, time format, send-with-Enter, notifications toggle). The demo flag is written on process start from `TELO_DEMO_WORKSPACE=1` (`make dev DEMO=1`); it is not an in-app opt-in. The file holds no secrets, so the file is plain JSON with a restrictive file mode rather than `safeStorage` encryption. Files written by older builds may lack newer fields; the domain normalizer falls back to each field's default instead of rejecting the file.

Media downloads are copied into `media-cache/<accountId>/` and served on `telo-media:`. `make reset` deletes Electron's userData (including `tdlib/`) so the next launch is first-run.

Older Teleproto files (`telegram-<id>.session`, `dialogs-<id>.json`) are not written by the TDLib adapter and cannot be imported. Users sign in again.

Domain and application layers depend on repository ports, so a keychain or database adapter can replace file persistence without changing use cases. Never move credential reads into the renderer. `make reset` deletes Electron's userData (and the matching cache/log directories) so the next launch is first-run.

## Plaintext escape hatch (local development and e2e only)

`safeStorage` needs an OS keychain, which is absent under Playwright and on some headless Linux sessions. Setting `TELO_PLAINTEXT_SECRETS=1` degrades the encrypt/decrypt pair in `interfaces/electron/container.ts` to plain base64 passthrough so local development and the e2e suite can exercise the secret-storage round trip. Never set this variable in production builds or for real accounts — secrets on disk are then only base64-encoded, not encrypted.
