# Telo

A privacy-first desktop Telegram client by AstraFoundry with a workspace-aware AI agent beside your conversations.

[![English](https://img.shields.io/badge/README-English-blue?style=flat-square)](README.md)
[![简体中文](https://img.shields.io/badge/README-简体中文-red?style=flat-square)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/README-日本語-green?style=flat-square)](README.ja.md)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square)](package.json)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square)](package.json)

![Telo desktop interface showing the chat list, conversation view, and AI agent panel](docs/readme/hero.png)

![Telo desktop interface in action with the chat list, conversation view, and AI agent panel](docs/readme/demo.gif)

## Features

- **Native TDLib Kernel**: Runs `tdl` and `prebuilt-tdlib` (TDLib 1.8.67) in the Electron main process with per-account SQLite databases encrypted via `safeStorage`, multi-account switching (up to 3 accounts), secret chats, server and keyword folders, polls, scheduled messages, voice notes, stickers, and animated emoji. (`prebuilt-tdlib` does not support Windows arm64.)
- **Workspace-Aware AI Agent**: Lives in a collapsible right-hand panel (`Cmd/Ctrl + B`) and streams responses over the AG-UI event protocol. Summarizes unread discussions, extracts decisions and to-dos, drafts or translates messages inline, cites messages via `telo://message/...` links, resolves `@Name` mentions, and supports trigger rules and scheduled tasks (`draft-only` by default or `auto-send`).
- **Bring Your Own Account (BYOA)**: Connects to OpenAI, Anthropic, Google, Groq, xAI, Kimi, DeepSeek, and Mistral via the AI SDK (desktop OAuth for OpenAI, Anthropic, Google, xAI, and Kimi; API keys for Groq, DeepSeek, and Mistral), plus any OpenAI-compatible HTTPS endpoint.
- **Zero-Trust Process Boundary**: Enforces `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`. API keys, OAuth tokens, and Telegram credentials stay in the main process encrypted with the OS keychain (`safeStorage`) and never cross the typed IPC bridge (`contracts/src/ipc.ts`). Scoped agent prompts redact emails, phone numbers, and API-key-like tokens before leaving the device and log SHA-256 prompt hashes to `agent-audit.jsonl`.
- **Desktop Craft & Live Settings**: Built with React 19, Electron 44, Tailwind CSS v4, Motion, and BEUI components. Includes System/Light/Dark themes, five accent palettes, 12px–18px message text scaling, token-driven chat backgrounds, searchable settings with live appearance and notification previews, and per-chat-kind notification and media auto-download controls.

## Quick Start

### Prerequisites

- **Node.js** `>= 22.0.0`
- **pnpm** `9.0.0` or newer
- **GNU Make**
- **OS**: macOS, Windows (x64), or Linux with a graphical display session

### Install and Run

```sh
git clone https://github.com/AstraFoundry/telo.git
cd telo
make install
make dev
```

To explore the in-memory demo workspace and deterministic demo agent without signing into a Telegram account or configuring an AI provider:

```sh
make dev DEMO=1
```

### Telegram and OAuth Credentials

To sign into a live Telegram account during local development, pass your application credentials from [my.telegram.org](https://my.telegram.org) (or place them in `.env`, copied from `.env.example`):

```sh
TELO_TELEGRAM_API_ID=1234567 TELO_TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef make dev
```

To enable Google OAuth (`Connect account`), supply a Google Cloud Desktop OAuth client ID with the Generative Language API enabled and loopback redirects (`http://127.0.0.1`) allowed:

```sh
TELO_GOOGLE_OAUTH_CLIENT_ID=123456789.apps.googleusercontent.com make dev
```

OpenAI, Anthropic, xAI, and Kimi use their public native OAuth clients by default and can be overridden with `TELO_OPENAI_OAUTH_CLIENT_ID`, `TELO_ANTHROPIC_OAUTH_CLIENT_ID`, `TELO_XAI_OAUTH_CLIENT_ID`, and `TELO_KIMI_OAUTH_CLIENT_ID`. Without `TELO_GOOGLE_OAUTH_CLIENT_ID`, Google can still be configured with an API key.

### Commands

| Command | Description |
| --- | --- |
| `make install` | Install dependencies from the lockfile and download the Electron binary |
| `make dev` | Install dependencies and start the Electron app with hot reload |
| `make dev DEMO=1` | Launch the app directly into the in-memory demo workspace |
| `make reset` | Delete Electron `userData` and return to a first-run state |
| `make check` | Run formatting, ESLint, TypeScript, unit coverage, TDLib capability check, Markdown lint, and Playwright E2E tests |
| `make test` | Run Vitest unit and integration tests with coverage |
| `make test-e2e` | Build in `e2e` mode and run Playwright Electron end-to-end tests |
| `make test-live` | Run secret-gated live Telegram E2E tests (`TELO_LIVE_E2E=1`) |
| `make lint` | Run ESLint including Feature-Sliced Design boundary checks |
| `make format` | Format source code and documentation with Prettier |
| `make docs` | Validate `README*.md` and `docs/**/*.md` with `markdownlint-cli2` |
| `make build` | Compile main, preload, and renderer bundles via `electron-vite` |
| `make package` | Stage native TDLib binaries and build unpacked application artifacts |
| `make tdlib-smoke` | Verify packaged `libtdjson` loads cleanly after `make package` |
| `pnpm release` | Build platform installers and distributables via `electron-builder` |

## Documentation

- [Documentation Index](docs/README.md) — Top-level documentation map and workflow guide.
- [Project Overview](docs/project/README.md) — Product goals and security boundaries.
- [System Architecture](docs/project/architecture.md) — Frontend FSD layers, backend DDD layers, IPC contracts, and data flows.
- [Agent & AG-UI Integration](docs/project/agent.md) — Streaming panel, citations, mentions, BYOA providers, redaction, and automation.
- [Telegram Capability Baseline](docs/telegram/README.md) — TDLib capability coverage matrix and client workflows.
- [Frontend Guidelines (FSD)](docs/frontend/README.md) — Feature-Sliced Design conventions and import rules.
- [Backend Guidelines (DDD)](docs/backend/README.md) — Domain-Driven Design layers, ports, and use cases.
- [Local Persistence](docs/backend/database.md) — Encrypted `userData` files and per-account TDLib storage.
- [Local Development](docs/operations/local-dev.md) — Environment variables, runtime setup, and debugging.
- [Build & Release](docs/operations/deployment.md) — Packaging, native TDLib staging, CI, and release artifacts.
- [Testing Strategy](docs/quality/testing.md) — Vitest coverage gates and Playwright Electron E2E journeys.
- [Architecture Decision Records](docs/decisions/README.md) — ADRs covering the IPC boundary, BYOA providers, automation safety, and TDLib kernel.

## Contributors

[![Telo Contributors](https://contrib.rocks/image?repo=AstraFoundry/telo)](https://github.com/AstraFoundry/telo/graphs/contributors)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=AstraFoundry/telo&type=Date)](https://star-history.com/#AstraFoundry/telo&Date)

## License

Released under the [MIT License](LICENSE).

Telo is an independent third-party client by AstraFoundry and is not affiliated with, sponsored by, or endorsed by Telegram FZ-LLC or Telegram Messenger Inc.
