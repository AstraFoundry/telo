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
make reset
make check
make test
make test-e2e
make test-live
make tdlib-smoke
make build
make package
```

`make install` runs `pnpm install --frozen-lockfile`, which also downloads the Electron platform binary via `install-electron`. Electron 42 and later no longer download that binary in the package's own install script, and electron-vite still requires `node_modules/electron/path.txt` before it can launch the app. `make dev` runs `make install` first, then starts Electron Vite with hot reload. `make dev DEMO=1` sets `TELO_DEMO_WORKSPACE=1` so the process opens the in-memory demo workspace instead of onboarding and swaps the agent gateway for the deterministic `DemoAgentGateway` (no API key or network needed); there is no in-app demo-workspace action. `make check` runs formatting, lint, TypeScript, coverage-gated tests, the TDLib capability baseline, Markdown validation, and Electron E2E tests. CI runs the same checks as two GitHub Actions jobs (`check` and `e2e`); the e2e job wraps Playwright in `xvfb-run`. `make test-live` is secret-gated live Telegram E2E. `make tdlib-smoke` probes packaged `libtdjson` after `make package`.

Local Telegram application credentials live in `.env` (gitignored; copy `.env.example`). `electron-vite` loads `TELO_TELEGRAM_API_ID` and `TELO_TELEGRAM_API_HASH` from that file, or from the process environment:

```sh
TELO_TELEGRAM_API_ID=12345 TELO_TELEGRAM_API_HASH=... make dev
```

Google Connect account uses the same injection for a Desktop OAuth client id (`TELO_GOOGLE_OAUTH_CLIENT_ID`). Register a Desktop app in Google Cloud, enable the Generative Language API, and allow loopback redirects (`http://127.0.0.1`). A build without that id still configures Google with an API key. OpenAI, Anthropic, xAI, and Kimi Connect use public native clients by default; set `TELO_OPENAI_OAUTH_CLIENT_ID`, `TELO_ANTHROPIC_OAUTH_CLIENT_ID`, `TELO_XAI_OAUTH_CLIENT_ID`, or `TELO_KIMI_OAUTH_CLIENT_ID` to override. `TELO_E2E=1` (Playwright) swaps in a fixture OAuth client so Connect does not open a browser.

The demo workspace is a local-development and e2e launch flag, not a product surface:

```sh
make dev DEMO=1
```

The release workflow reads the same values from the `TELO_TELEGRAM_API_ID`, `TELO_TELEGRAM_API_HASH`, and `TELO_GOOGLE_OAUTH_CLIENT_ID` repository secrets and embeds them in the Electron main bundle. Users never enter credentials: a configured release shows only phone number, login code, and optional two-factor password, while a build without them shows a "missing credentials" notice instead of the sign-in form. On Linux CI, run Electron tests under `xvfb-run`.

`pnpm test:e2e` builds with Electron Vite's `e2e` mode, which deliberately omits local Telegram application credentials. This keeps the missing-credentials onboarding path deterministic even when the developer has a populated `.env`; production and ordinary development builds continue to embed their configured credentials.

## Stored data

The application writes `agent.json`, `agent-threads.json`, `agent-audit.jsonl`, `kimi-device-id`, `accounts.json`, `telegram-<id>.profile`, `tdlib/<id>/`, `tdlib-<id>.key`, `keyword-folders.json`, `preferences.json`, and `media-cache/` under Electron's `app.getPath("userData")`. Telegram profiles and TDLib encryption keys are encrypted with Electron `safeStorage`; `preferences.json` and `agent-threads.json` hold no secrets and stay plain JSON. `kimi-device-id` is a non-secret UUID Kimi OAuth sends as `X-Msh-Device-Id`. `make reset` deletes the userData (and cache/log) directories so the next `make dev` is a first-run launch. Demo conversations are in memory. Leftover GramJS `telegram.session` / `dialogs.json` files are deleted on first boot and cannot be imported.

`safeStorage` requires an OS keychain. On machines or sessions without one (headless Linux, Playwright), set `TELO_PLAINTEXT_SECRETS=1` to fall back to plain base64 encoding for secrets. This escape hatch exists only for local development and the e2e suite — never use it in production or with real accounts.

## Native editing context menu

The main process (`backend/src/interfaces/electron/main.ts`) registers a `context-menu` handler on the renderer's `webContents` and pops a `Menu` built from standard edit roles (undo/redo/cut/copy/paste/selectAll for editable fields, Copy only for a plain text selection). Role labels follow the system locale, so no copy keys are involved. Native menus cannot be asserted by Playwright; verify manually with `make dev` by right-clicking the message composer and a selected message text.
