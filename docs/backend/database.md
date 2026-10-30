# Local persistence

Telo has no database server or ORM. Small stores are files in the user data directory (MyGo's `PathUserData`, or `TELO_DATA_DIR`); Telegram's data is TDLib's own encrypted database per account. Writes go through a temporary file and a rename (`storage.WriteAtomic`), so a crash leaves the previous file intact.

Sealed files are AES-256-GCM encrypted JSON under a 32-byte key kept in the system credential store (macOS Keychain, Windows Credential Manager, the Secret Service on Linux), one key per file. Where the system has no credential store, reading or writing a sealed file fails with `storage.ErrNoCredentialStore`; Telo never falls back to writing the secret in the clear.

| Path | Content | Form |
| --- | --- | --- |
| `preferences.json` | Interface preferences: theme, accent, text size, background, time format, send key, notifications, media download and cache, panel widths, motion, passcode hash and auto-lock | plain JSON; holds no secret (the passcode is a PBKDF2-SHA256 hash, 210 000 rounds) |
| `keyword-folders.sealed` | Keyword folders and their matches | sealed |
| `telegram/accounts.json` | Account registry: ids, names, usernames, avatar placeholders, unread counts, the active account | plain JSON; no secret |
| `telegram/<account>/` | That account's TDLib database and files, encrypted with the key `tdlib:<account>` | TDLib |
| `agent/agent-configuration.sealed` | Provider, model, instructions, API key or OAuth tokens | sealed |
| `agent/agent-threads.sealed` | Agent conversations | sealed |
| `agent/agent-rules.sealed`, `agent/agent-tasks.sealed` | Trigger rules and scheduled tasks | sealed |
| `agent/agent-audit.jsonl` | One line per run: scope, message ids, redaction counts, model, SHA-256 of the prompt; never message text | JSON lines |
| `demo-cache/` | Generated demo media, demo workspace only | files |

- **Accounts.** Up to three. Switching parks the connected account's TDLib client and opens the other; its directory stays, so switching back restores it. Logging out deletes the directory and its key.
- **Normalization.** Preference files from an earlier version may lack fields; `Preferences.Normalize` fills each from its default and clamps out-of-range values.
- **Reset.** `make reset` runs Telo once against a throwaway directory; deleting the user data directory returns an installed Telo to its first run.
