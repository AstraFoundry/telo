# Telo

[![English](https://img.shields.io/badge/README-English-blue?style=flat-square)](README.md)
[![简体中文](https://img.shields.io/badge/README-简体中文-red?style=flat-square)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/README-日本語-green?style=flat-square)](README.ja.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square)](https://github.com/ProjectKumo/telo)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

> A modern, privacy-first desktop Telegram workspace with a context-aware global AI agent residing directly beside your conversations.

---

## Overview

**Telo** is a high-performance desktop Telegram client engineered with **React 19**, **Electron 44**, and the **AI SDK**. It unites real-time Telegram communication with an autonomous AI assistant capable of observing visible conversation state to summarize discussions, draft contextual replies, translate across languages, and extract actionable insights.

Designed from the ground up for strict privacy and security, Telo isolates credentials and Telegram sessions in the Electron main process using OS keychain encryption (`safeStorage`). The renderer executes in an unprivileged, isolated sandbox with zero access to API keys or session secrets.

```text
+-------------------+----------------------------------+------------------------+
|   Chats Sidebar   |       Active Conversation        |    Global AI Agent     |
|                   |                                  |                        |
| • Direct Chats    | • Quoted Reply Previews          | • AG-UI Stream Output  |
| • Channel Feeds   | • In-place Message Editing       | • Thinking Shimmer     |
| • Group Chats     | • Message Forwarding & Deletion  | • Workspace Inspector  |
| • Unread / Mute   | • Rich Markdown Message Composer | • Multi-thread History |
| • Pinned Dialogs  | • Context Menus (Copy/Reply/Edit)| • OS Notifications     |
+-------------------+----------------------------------+------------------------+
```

---

## Key Features

### ⚡ TDLib client kernel

- **Native Telegram runtime**: Powered by TDLib (`tdl` + `prebuilt-tdlib` 1.8.67) in the Electron main process. The renderer never imports `tdl` or `td_api`. Packaged builds unpack `libtdjson` beside the asar.
- **Per-account SQLite**: Each account stores chats and messages under `userData/tdlib/<accountId>/`, encrypted with a `safeStorage` key. Existing Teleproto sessions cannot be imported — sign in again.
- **Windows arm64**: not supported by `prebuilt-tdlib`.
- **Seamless Authentication**: Standard phone number login supporting SMS/Telegram verification codes and Cloud Password (2FA) challenges.
- **Zero-Login Demo Workspace**: Launch with `make dev DEMO=1` to explore the interface and agent workflows without signing into a Telegram account. There is no in-app demo button.

### 🤖 Workspace-Aware Global Agent

- **Multi-Provider Support**: Connect seamlessly to OpenAI (`gpt-4o`, `o3-mini`) or any OpenAI-compatible endpoint (DeepSeek, OpenRouter, Groq, Ollama, LM Studio).
- **Workspace Context Inspection (`inspectWorkspace`)**: The agent inspects visible chat metadata and open conversation messages upon request to assist with queries in real time.
- **AG-UI Protocol Streaming**: Real-time event streaming featuring animated `ThinkingShimmer` state indicators, execution steps, token streaming, and graceful error boundaries.
- **Persistent Multi-Session Threads**: Switch between isolated conversation threads saved locally in `agent-threads.json`.
- **Background Desktop Alerts**: Triggers native OS notifications when agent tasks finish while the application window is unfocused.

### 🛡️ Zero-Trust Security Architecture

- **Strict Sandbox & Context Isolation**: `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`. External navigation is blocked and links open safely in your default OS browser.
- **OS Keychain Encryption**: API keys and Telegram session credentials are encrypted with Electron `safeStorage` before reaching the disk.
- **Zero Raw Secrets in Renderer**: The web renderer communicates exclusively through typed IPC contracts and never receives raw keys or tokens.

### 🎨 Craft-Obsessed Desktop UX

- **Fluid Animations**: Built with Motion (Framer Motion v13) and BEUI motion components including morphing modals, popovers, and smooth sidebars.
- **Full Customizability**:
  - Theme switching: **System**, **Light**, and **Dark** modes.
  - Accent palettes: **Blue**, **Green**, **Purple**, **Red**, and **Orange**.
  - Dynamic message text scaling slider (**12px – 18px**).
  - Chat backgrounds: **Plain**, **Dots**, **Grid**, and an accent **Gradient**, all drawn from theme tokens.
  - Time formatting: **System default**, **12-hour**, and **24-hour**.
  - Flexible keyboard shortcuts: send messages with `Enter` or `Cmd/Ctrl + Enter`.
  - Keyboard toggle: `Cmd/Ctrl + B` toggles the AI Agent sidebar instantly.
- **Settings That Answer Back**:
  - Search indexes settings, not sections: type an alias, arrow to it, press `Enter`, and land on the row itself — which flashes on arrival.
  - Live previews instead of descriptions: Appearance renders real transcript bubbles under the same tokens the conversation uses, and Notifications renders the exact banner the OS would raise.
  - Notification control per chat kind (**Private chats**, **Groups**, **Channels**), plus sender name, message text, and sound.
  - Media auto-download per kind (**Photos**, **Videos and GIFs**, **Files**) on top of the on-disk cache ceiling.

### 💬 Comprehensive Message Operations

- **Quoted Replies**: Visual quote blocks linking replies directly to the source message.
- **Message Editing**: In-place edits with live updates and `edited` status indicators.
- **Message Forwarding**: Forward any message across chats with preview updates.
- **Message Deletion**: Safe deletion with confirmation dialogs.
- **Animated Emoji**: A one-emoji message plays Telegram's own animation, once and then still. Clicking it asks Telegram for the oversized effect and plays it over the transcript — and the peer's click plays the same burst on your side. Emoji-only text with no animation is drawn large, up to Telegram's three-emoji cap.
- **Chat Management**: Pin/unpin dialogs, mute/unmute notification states, and mark chats as read/unread.

---

## Architecture & Design Principles

Telo enforces a clean separation of concerns using industry-standard architectural patterns:

```text
+-------------------------------------------------------------------------+
|                       Frontend: React 19 (FSD)                          |
|    app  -->  pages  -->  widgets  -->  features  -->  entities  --> shared|
+-------------------------------------------------------------------------+
                                    |
                    Narrow Typed IPC (contextBridge)
                    contracts/src/ipc.ts (TeloDesktopApi)
                                    |
+-------------------------------------------------------------------------+
|                  Backend: Electron Main Process (DDD)                   |
|     interfaces  -->  application  -->  domain  <--  infrastructure     |
+-------------------------------------------------------------------------+
          |                         |                        |
     [TDLib]                    [AI SDK]             [safeStorage]
   (tdl + libtdjson)      (OpenAI / Compatible)   (Encrypted Local Data)
```

- **Frontend (Feature-Sliced Design)**: Predictable downward dependency flow across `app`, `pages`, `widgets`, `features`, `entities`, and `shared`.
- **Backend (Domain-Driven Design)**: Pure `domain` logic free of framework dependencies, orchestrating use cases in `application`, implemented via concrete `infrastructure` adapters.
- **Typed IPC Contracts**: Every interaction between Electron and the UI is strictly typed under `contracts/src/ipc.ts`.

---

## Quick Start

### Prerequisites

- **Node.js**: `v22.0.0` or higher
- **Package Manager**: `pnpm` `v9.0.0` or higher
- **Build Tool**: `GNU Make`
- **OS**: macOS, Windows, or Linux with a graphical display session

### Installation

1. **Clone the repository**:

   ```sh
   git clone https://github.com/ProjectKumo/telo.git
   cd telo
   ```

2. **Install dependencies**:

   ```sh
   make install
   ```

3. **Start the development application**:

   ```sh
   make dev
   ```

### Running with Custom Telegram Application Credentials

To connect to live Telegram accounts, supply your application credentials obtained from [my.telegram.org](https://my.telegram.org):

```sh
TELO_TELEGRAM_API_ID=1234567 TELO_TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef make dev
```

Google Connect account needs a Desktop OAuth client id from Google Cloud (Generative Language API, loopback `http://127.0.0.1`):

```sh
TELO_GOOGLE_OAUTH_CLIENT_ID=123456789.apps.googleusercontent.com make dev
```

OpenAI, Anthropic, xAI, and Kimi Connect use those vendors' public native OAuth clients. Optional overrides: `TELO_OPENAI_OAUTH_CLIENT_ID`, `TELO_ANTHROPIC_OAUTH_CLIENT_ID`, `TELO_XAI_OAUTH_CLIENT_ID`, `TELO_KIMI_OAUTH_CLIENT_ID`.

To open the in-memory demo workspace instead of onboarding:

```sh
make dev DEMO=1
```

_Note: If no credentials are provided at build time, a configured release shows a "missing credentials" notice instead of the sign-in form. Demo workspace is a local launch flag, not a fallback._

---

## Quality Assurance & Testing

Telo maintains comprehensive testing standards across both backend and frontend:

```sh
# Run complete quality gate (Format, Lint, Types, Unit & Integration Tests, Markdown, E2E)
make check

# Run unit and integration tests with coverage
make test

# Run Electron end-to-end tests with Playwright
make test-e2e

# Run linter and formatting checks
make lint
make format
```

- **Vitest**: Runs unit and integration suites with strict coverage thresholds (minimum 80% statements/lines/functions, 75% branches).
- **Playwright**: Executes end-to-end user journeys in a packaged Electron instance, validating onboarding, real-time messaging, settings persistence, agent interaction, and message lifecycles.

---

## Command Reference

| Command         | Action                                                                      |
| --------------- | --------------------------------------------------------------------------- |
| `make install`  | Install dependencies from the lockfile and download the Electron binary     |
| `make dev`      | Install dependencies, then start the Electron app with hot reloading        |
| `make check`    | Run formatting, linting, type checks, unit tests, docs check, and E2E tests |
| `make test`     | Run unit and integration tests with coverage reporting via Vitest           |
| `make test-e2e` | Run end-to-end Electron tests via Playwright                                |
| `make lint`     | Run ESLint with Feature-Sliced Design boundary checks                       |
| `make format`   | Format source code and documentation using Prettier                         |
| `make docs`     | Validate all Markdown documentation using markdownlint                      |
| `make build`    | Compile main, preload, and renderer bundles via electron-vite               |
| `make package`  | Build unpacked application distribution artifacts                           |
| `make reset`    | Delete Electron user data and return to a first-run launch                  |

---

## Configuration & Local Storage

Telo persists user configurations under the platform-specific Electron `userData` directory:

| File                 | Purpose                                                               | Storage Mode              |
| -------------------- | --------------------------------------------------------------------- | ------------------------- |
| `agent.json`         | Model configuration, encrypted API key, encrypted OAuth tokens        | Encrypted (`safeStorage`) |
| `agent-threads.json` | Stored AI assistant conversation transcripts and active thread ID     | Plain JSON                |
| `telegram.session`   | Telegram MTProto session key                                          | Encrypted (`safeStorage`) |
| `telegram.profile`   | Current user profile and cached avatar                                | Encrypted (`safeStorage`) |
| `dialogs.json`       | Cached chat list and folder badges for session restore                | Plain JSON                |
| `preferences.json`   | Theme, accent color, text size, time format, and shortcut preferences | Plain JSON                |

_For headless Linux CI environments without an OS keychain, set `TELO_PLAINTEXT_SECRETS=1` to enable local testing fallback._

---

## Packaging & Distribution

Build standalone installers and binaries for your platform:

```sh
# Build native distribution package
pnpm release
```

- **macOS**: Apple Silicon & Intel DMG / ZIP packages (`.dmg`, `.zip`)
- **Windows**: NSIS installer executable (`.exe`)
- **Linux**: AppImage and Debian package (`.AppImage`, `.deb`)

---

## Documentation Index

Detailed technical documentation is available in the [`docs/`](docs/) directory:

- [Project Architecture](docs/project/architecture.md) — Module boundaries, data flow, and IPC design.
- [Agent & AG-UI Integration](docs/project/agent.md) — AG-UI event protocol, workspace snapshots, and thread management.
- [Frontend Guidelines (FSD)](docs/frontend/README.md) — Feature-Sliced Design rules, layer hierarchies, and component conventions.
- [Backend Guidelines (DDD)](docs/backend/README.md) — Domain-Driven Design patterns, repositories, and use case services.
- [Local Development Guide](docs/operations/local-dev.md) — Environment configuration, secrets handling, and debug workflows.
- [Testing Strategy](docs/quality/testing.md) — Vitest coverage and Playwright Electron end-to-end test fixtures.
- [Release Process](docs/operations/deployment.md) — Build matrix, signing, notarization, and deployment.

---

## Disclaimer

Telo is an independent third-party client and is **not** affiliated with, sponsored by, or endorsed by Telegram FZ-LLC or Telegram Messenger Inc.

---

## License

This project is licensed under the [MIT License](LICENSE).
