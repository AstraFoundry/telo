# Local development

## Requirements

- Go, at the version in `go.mod` (MyGo is a `go tool` dependency; no C toolchain: `CGO_ENABLED=0`)
- Node.js 22 and pnpm 9, for the pinned `prebuilt-tdlib` and Markdown lint
- GNU Make
- macOS, Windows or Linux with a graphical session

## Commands

```sh
make install     # pnpm install --frozen-lockfile
make tdlib       # stage libtdjson under build/tdlib-native/<platform>
make dev         # run Telo with live reload (mygo dev)
make demo        # run on the demo workspace
make reset       # run once with a throwaway profile
make check       # every gate CI runs
make help        # every target
```

`make dev` stages TDLib first. `make dev DEMO=1` (or `make demo`) sets `TELO_DEMO=1`: the in-memory demo workspace replaces Telegram and the demo gateway replaces the agent's providers, so no account or key is needed. There is no in-app way into the demo.

## Credentials

The Makefile reads `.env` (gitignored; copy `.env.example`), or the environment:

```sh
TELO_TELEGRAM_API_ID=12345 TELO_TELEGRAM_API_HASH=... make dev
```

- `TELO_TELEGRAM_API_ID` / `TELO_TELEGRAM_API_HASH` — your application from [my.telegram.org](https://my.telegram.org). Without them onboarding shows the not-configured step instead of the phone form. Release builds link them in (`make package`), so users never enter them.
- `TELO_GOOGLE_OAUTH_CLIENT_ID` — a Google Cloud Desktop OAuth client with the Generative Language API enabled and loopback redirects allowed. Without it Google takes an API key.
- `TELO_OPENAI_OAUTH_CLIENT_ID`, `TELO_ANTHROPIC_OAUTH_CLIENT_ID`, `TELO_XAI_OAUTH_CLIENT_ID`, `TELO_KIMI_OAUTH_CLIENT_ID` — override the vendors' public native clients.

## Other variables

- `TELO_DATA_DIR` — use another user data directory (an isolated profile).
- `TELO_TDLIB_VERBOSITY` — TDLib's log level on stderr (default 1, errors).

## Stored data

Every file Telo writes is listed in [`../backend/database.md`](../backend/database.md). Secrets are sealed under keys in the system credential store; on Linux that needs a Secret Service (GNOME Keyring or KWallet) in the session.

## Native menus

The menu bar is built from `bootstrap.Menus`; edit, window and services items use the system's roles, so their labels follow the system language. Check them by hand with `make dev`: tests assert the registry, not the native menu.
