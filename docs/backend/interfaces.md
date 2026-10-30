# Interfaces Layer

The interfaces layer adapts the application to the outside world. Telo has no network server, IPC bridge or CLI: the UI runs in the same Go process. Two packages play this role.

## `bootstrap` — the composition root

`bootstrap` (called from `main.go`) builds everything once:

- **`app.go`** opens the user data directory, the keychain, the preferences and keyword-folder stores, the Telegram accounts over TDLib (or the demo workspace with `TELO_DEMO=1`), the agent service with its gateway, OAuth and sealed stores, and the runtime the UI receives. It holds the release credentials linked in by `make package`, takes the single-instance lock, and opens the window (`TitleBarHidden`, 1180 × 760, minimum 760 × 520, its frame remembered).
- **`menus.go`** declares the menu bar as data (`Menus`): roles for the standard items and actions for Telo's. Each item carries the telegram-macos id it reproduces, which `make parity` checks with the keys.
- **`desktop.go`** implements `runtime.Desktop` with MyGo: notifications that open their chat, the dock badge, the clipboard, file dialogs, opening and revealing files, and URLs.

Only `bootstrap` imports infrastructure and MyGo's app-level APIs; the UI never imports `bootstrap` (`make arch`).

## `frontend/shared/runtime` — the boundary the UI calls

`runtime.Runtime` is everything a view may reach: `Accounts` (and through it the active `tg.Repository`), the `Preferences`, `KeywordFolders` and `Agent` services, the `Desktop` adapter and the build `Info`. `Runtime.Go` runs a call off the main thread and `Runtime.Post` brings the result back; the root view drains posts at the start of each frame.

## Rules

- Keep `bootstrap` thin: construct, wire, and route menu actions to the root view. No business rules.
- Views call services, never infrastructure, and never block the main thread on Telegram, the network or the disk.
- Nothing secret crosses into the UI ([`api-conventions.md`](api-conventions.md)).
- A new capability needs a port in the domain, an implementation in infrastructure, the wiring in `bootstrap`, and a test at the service level.

## Error handling

- Expected failures are domain errors the UI words from the copy catalog ([`api-conventions.md`](api-conventions.md)).
- A failure at start (libtdjson missing or unloadable, an unreadable store) shows a native error dialog and quits; Telo does not start half-configured.
