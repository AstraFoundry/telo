# Local development

## Requirements

- Node.js 22 or newer
- pnpm 9
- GNU Make
- macOS, Windows, or Linux with a graphical session

## Setup and commands

```sh
make install
make dev
make dev DEMO=1
make check
make test
make test-e2e
make build
make package
```

`make install` runs `pnpm install --frozen-lockfile`, which also downloads the Electron platform binary via `install-electron`. Electron 42 and later no longer download that binary in the package's own install script, and electron-vite still requires `node_modules/electron/path.txt` before it can launch the app. `make dev` runs `make install` first, then starts Electron Vite with hot reload. `make dev DEMO=1` sets `TELO_DEMO_WORKSPACE=1` so the process opens the in-memory demo workspace instead of onboarding; there is no in-app demo-workspace action. `make check` runs formatting, lint, TypeScript, coverage-gated tests, Markdown validation, and Electron E2E tests. CI runs the same checks as two GitHub Actions jobs (`check` and `e2e`); the e2e job wraps Playwright in `xvfb-run`.

Local Telegram application credentials live in `.env` (gitignored; copy `.env.example`). `electron-vite` loads `TELO_TELEGRAM_API_ID` and `TELO_TELEGRAM_API_HASH` from that file, or from the process environment:

```sh
TELO_TELEGRAM_API_ID=12345 TELO_TELEGRAM_API_HASH=... make dev
```

The demo workspace is a local-development and e2e launch flag, not a product surface:

```sh
make dev DEMO=1
```

The release workflow reads the same values from the `TELO_TELEGRAM_API_ID` and `TELO_TELEGRAM_API_HASH` repository secrets and embeds them in the Electron main bundle. Users never enter credentials: a configured release shows only phone number, login code, and optional two-factor password, while a build without them shows a "missing credentials" notice instead of the sign-in form. On Linux CI, run Electron tests under `xvfb-run`.

`pnpm test:e2e` builds with Electron Vite's `e2e` mode, which deliberately omits local Telegram application credentials. This keeps the missing-credentials onboarding path deterministic even when the developer has a populated `.env`; production and ordinary development builds continue to embed their configured credentials.

## Stored data

The application writes `agent.json`, `agent-threads.json`, `telegram.profile`, `telegram.session`, and `preferences.json` under Electron's `app.getPath("userData")`. Telegram profile and session data are encrypted with Electron `safeStorage`; `preferences.json` and `agent-threads.json` hold no secrets and stay plain JSON. Delete those files to reset local credentials and preferences. Demo conversations are in memory.

`safeStorage` requires an OS keychain. On machines or sessions without one (headless Linux, Playwright), set `TELO_PLAINTEXT_SECRETS=1` to fall back to plain base64 encoding for secrets. This escape hatch exists only for local development and the e2e suite — never use it in production or with real accounts.

## Native editing context menu

The main process (`backend/src/interfaces/electron/main.ts`) registers a `context-menu` handler on the renderer's `webContents` and pops a `Menu` built from standard edit roles (undo/redo/cut/copy/paste/selectAll for editable fields, Copy only for a plain text selection). Role labels follow the system locale, so no copy keys are involved. Native menus cannot be asserted by Playwright; verify manually with `make dev` by right-clicking the message composer and a selected message text.
