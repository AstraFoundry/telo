# Local persistence

Telo does not use a database or ORM. Infrastructure adapters persist small records under Electron's per-user data directory:

- `agent.json`: agent configuration with an encrypted API key and encrypted OAuth tokens, restrictive file mode.
- `agent-threads.json`: agent conversation transcripts and the active-thread pointer. They hold no secrets, so the file is plain JSON with a restrictive file mode.
- `telegram.profile`: the Telegram connection profile (application credentials and phone number), encrypted with Electron `safeStorage`.
- `telegram.session`: the Teleproto string session. Logging out disconnects the client and deletes this file (`clear()`); a missing file on the next launch simply skips session restoration.
- `dialogs.json`: a snapshot of the chat list and folder badges (no secrets). Avatar bytes stay out of this file; protocol URLs (`telo-media://cache/avatar_<peerId>.jpg`) are kept so restore can paint photos already on disk in `media-cache/`. In-memory data URLs and `avatarPending` are stripped. The cache is keyed by Telegram peer id rather than by dialog, so message authors who have no dialog of their own — group members, channel posters — share the same files and the same `chat-avatar` events. On launch the workspace hydrates from this file while the Telegram session is restoring, then refreshes with a paged `messages.GetDialogs`. Folder unread is computed from the snapshot rather than a second full dialog walk. Logout deletes the file.
- `preferences.json`: user preferences (agent panel visibility, demo workspace flag, interface theme, accent color, message text size, time format, send-with-Enter, notifications toggle). The demo flag is written on process start from `TELO_DEMO_WORKSPACE=1` (`make dev DEMO=1`); it is not an in-app opt-in. The file holds no secrets, so the file is plain JSON with a restrictive file mode rather than `safeStorage` encryption. Files written by older builds may lack newer fields; the domain normalizer falls back to each field's default instead of rejecting the file.

Domain and application layers depend on repository ports, so a keychain or database adapter can replace file persistence without changing use cases. Never move credential reads into the renderer. `make reset` deletes Electron's userData (and the matching cache/log directories) so the next launch is first-run.

## Plaintext escape hatch (local development and e2e only)

`safeStorage` needs an OS keychain, which is absent under Playwright and on some headless Linux sessions. Setting `TELO_PLAINTEXT_SECRETS=1` degrades the encrypt/decrypt pair in `interfaces/electron/container.ts` to plain base64 passthrough so local development and the e2e suite can exercise the secret-storage round trip. Never set this variable in production builds or for real accounts — secrets on disk are then only base64-encoded, not encrypted.
