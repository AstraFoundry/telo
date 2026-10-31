# Telo

A privacy-first desktop Telegram client by AstraFoundry with a workspace-aware AI agent beside your conversations.

[![English](https://img.shields.io/badge/README-English-blue?style=flat-square)](README.md)
[![简体中文](https://img.shields.io/badge/README-简体中文-red?style=flat-square)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/README-日本語-green?style=flat-square)](README.ja.md)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square)](mygo.json)
[![Go](https://img.shields.io/badge/Go-1.27-00ADD8?style=flat-square)](go.mod)
[![MyGo](https://img.shields.io/badge/MyGo-0.7-47848F?style=flat-square)](go.mod)

![Telo desktop interface showing the chat list, conversation view, and AI agent panel](docs/readme/hero.png)

![Telo desktop interface in action with the chat list, conversation view, and AI agent panel](docs/readme/demo.gif)

## Features

- **Native, one process**: Written in Go on [MyGo](https://github.com/egoist/mygo): a native window, no Electron, no web view, no C toolchain. TDLib 1.8.67 loads through `purego`, with per-account databases encrypted under keys in the system credential store, up to three accounts, secret chats, server and keyword folders, polls, scheduled messages and stickers. (`prebuilt-tdlib` does not support Windows arm64.)
- **Telegram for macOS parity**: Interactions follow [telegram-macos](https://github.com/TelegramMessenger/telegram-macos): menus, keyboard shortcuts, settings and context menus carry the upstream item they reproduce, and `make check` fails when Telo drifts from its committed parity ledger.
- **Workspace-aware AI agent**: A right-hand panel (`⌘J` / `Ctrl+J`) that summarizes unread discussions, extracts decisions and to-dos, translates, rewrites or drafts replies into the composer, cites messages as numbered `telo://message/...` links, and runs trigger rules and scheduled tasks (`draft-only` by default, or `auto-send`).
- **Bring your own account (BYOA)**: OpenAI, Anthropic, Google, Groq, xAI, Kimi, DeepSeek and Mistral (vendor sign-in for OpenAI, Anthropic, Google, xAI and Kimi; API keys for the others), plus any OpenAI-compatible HTTPS endpoint.
- **Secrets stay sealed**: API keys, OAuth tokens and Telegram database keys are sealed with AES-256-GCM under keys in the OS credential store and never reach the UI. Agent context is redacted (emails, phone numbers, API keys) before it leaves the device, and every run logs the SHA-256 of its prompt to `agent-audit.jsonl`, never the text.
- **Desktop craft**: coss component anatomy shared with AstraFoundry's Arion and Telo's own palette: System, Light and Dark themes, five accents, 12–18 px message text, a local passcode with auto-lock, searchable settings, and per-chat-kind notification and media download controls.

## Quick Start

### Prerequisites

- **Go** at the version in `go.mod`
- **Node.js** `>= 22.0.0` and **pnpm** `9.0.0` or newer (they stage the pinned TDLib build and lint the docs)
- **GNU Make**
- **OS**: macOS, Windows (x64), or Linux with a graphical session

### Install and Run

```sh
git clone https://github.com/AstraFoundry/telo.git
cd telo
make install
make dev
```

To explore the in-memory demo workspace and the deterministic demo agent without a Telegram account or an AI provider:

```sh
make demo
```

### Telegram and OAuth Credentials

To sign into a live Telegram account during local development, pass your application credentials from [my.telegram.org](https://my.telegram.org) (or place them in `.env`, copied from `.env.example`):

```sh
TELO_TELEGRAM_API_ID=1234567 TELO_TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef make dev
```

To enable Google sign-in for the agent, supply a Google Cloud Desktop OAuth client ID with the Generative Language API enabled and loopback redirects (`http://127.0.0.1`) allowed:

```sh
TELO_GOOGLE_OAUTH_CLIENT_ID=123456789.apps.googleusercontent.com make dev
```

OpenAI, Anthropic, xAI and Kimi use their public native OAuth clients by default and can be overridden with `TELO_OPENAI_OAUTH_CLIENT_ID`, `TELO_ANTHROPIC_OAUTH_CLIENT_ID`, `TELO_XAI_OAUTH_CLIENT_ID` and `TELO_KIMI_OAUTH_CLIENT_ID`. Without `TELO_GOOGLE_OAUTH_CLIENT_ID`, Google takes an API key.

### Commands

| Command | Description |
| --- | --- |
| `make install` | Install the pinned TDLib package and the documentation tooling from the lockfile |
| `make dev` | Stage TDLib and run Telo with live reload |
| `make demo` | Run Telo on the in-memory demo workspace |
| `make reset` | Run Telo once with an empty, throwaway profile |
| `make check` | Run every gate CI runs: gofmt, vet, generated code, FSD/DDD imports, TDLib capabilities, telegram-macos parity, tests, and docs |
| `make test` | Run the Go tests, headless UI tests included, against the staged libtdjson |
| `make parity` | Check the telegram-macos parity ledger against the code |
| `make snapshots` | Render the UI tests' frames to `.workspace/snapshots` |
| `make test-live` | Drive the live Telegram baseline on a signed-in account (`TELO_LIVE_E2E=1`) |
| `make build` | Build the Telo binary for this platform |
| `make package` | Build the packaged app and installers with `mygo build` |
| `make help` | List every target |

## Documentation

- [Documentation Index](docs/README.md) — Top-level documentation map and workflow guide.
- [Project Overview](docs/project/README.md) — Product goals and boundaries.
- [System Architecture](docs/project/architecture.md) — Frontend FSD layers, backend DDD layers, threads, and data flows.
- [Agent](docs/project/agent.md) — Panel, citations, BYOA providers, redaction, and automation.
- [Telegram](docs/telegram/README.md) — TDLib capability matrix and the live baseline.
- [telegram-macos Parity](docs/telegram/parity.md) — The parity ledger and the gate in `make check`.
- [Frontend Guidelines (FSD)](docs/frontend/README.md) — Feature-Sliced Design in Go and the design system.
- [Backend Guidelines (DDD)](docs/backend/README.md) — Domain-Driven Design layers, ports, and use cases.
- [Local Persistence](docs/backend/database.md) — Sealed files and per-account TDLib storage.
- [Local Development](docs/operations/local-dev.md) — Environment variables and runtime setup.
- [Build & Release](docs/operations/deployment.md) — Packaging, CI, and release artifacts.
- [Testing Strategy](docs/quality/testing.md) — The gates of `make check` and the headless UI tests.
- [Architecture Decision Records](docs/decisions/README.md) — ADRs covering the native desktop, BYOA providers, automation safety, the TDLib kernel, and parity scope.

## Contributors

[![Telo Contributors](https://contrib.rocks/image?repo=AstraFoundry/telo)](https://github.com/AstraFoundry/telo/graphs/contributors)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=AstraFoundry/telo&type=Date)](https://star-history.com/#AstraFoundry/telo&Date)

## License

Released under the [MIT License](LICENSE).

Telo is an independent third-party client by AstraFoundry and is not affiliated with, sponsored by, or endorsed by Telegram FZ-LLC or Telegram Messenger Inc.
