# Local development

## Requirements

- Node.js 20 or newer
- pnpm 9
- GNU Make
- macOS, Windows, or Linux with a graphical session

## Setup and commands

```sh
pnpm install --frozen-lockfile
make dev
make check
make test
make test-e2e
make build
make package
```

`make dev` starts Electron Vite with hot reload. `make check` runs formatting, lint, TypeScript, coverage-gated tests, Markdown validation, a production build, and Electron E2E tests.

Production builds should provide the Telegram application credentials used by all users:

```sh
TELO_TELEGRAM_API_ID=12345 TELO_TELEGRAM_API_HASH=... make dev
```

The release workflow reads the same values from the `TELO_TELEGRAM_API_ID` and `TELO_TELEGRAM_API_HASH` repository secrets and embeds them in the Electron main bundle. Users never enter credentials: a configured release shows only phone number, login code, and optional two-factor password, while a build without them shows a "missing credentials" notice instead of the sign-in form. On Linux CI, run Electron tests under `xvfb-run`.

## Stored data

The application writes `agent.json`, `agent-threads.json`, `telegram.profile`, `telegram.session`, and `preferences.json` under Electron's `app.getPath("userData")`. Telegram profile and session data are encrypted with Electron `safeStorage`; `preferences.json` and `agent-threads.json` hold no secrets and stay plain JSON. Delete those files to reset local credentials and preferences. Demo conversations are in memory.

`safeStorage` requires an OS keychain. On machines or sessions without one (headless Linux, Playwright), set `TELO_PLAINTEXT_SECRETS=1` to fall back to plain base64 encoding for secrets. This escape hatch exists only for local development and the e2e suite — never use it in production or with real accounts.

## Native editing context menu

The main process (`backend/src/interfaces/electron/main.ts`) registers a `context-menu` handler on the renderer's `webContents` and pops a `Menu` built from standard edit roles (undo/redo/cut/copy/paste/selectAll for editable fields, Copy only for a plain text selection). Role labels follow the system locale, so no copy keys are involved. Native menus cannot be asserted by Playwright; verify manually with `make dev` by right-clicking the message composer and a selected message text.
