# Architecture

Telo is one Go process: a native window drawn by [MyGo](https://github.com/egoist/mygo), TDLib loaded through `purego`, and the agent's HTTP clients. There is no renderer process and no web view ([`006`](../decisions/006-mygo-native-desktop.md)).

## System

```text
main.go
  bootstrap/            composition root: stores, accounts, agent, window, menus, desktop adapter
    frontend/app        root view: onboarding · lock · workspace · settings, toasts, shortcuts
      pages → widgets → features → entities → shared      (FSD, Go packages)
    frontend/shared/runtime   the UI's boundary: services, desktop adapter, main-thread queue
  backend/application   use cases: agent runs and automation, preferences, keyword folders, notifications
  backend/domain        Telegram, agent, preferences and keyword-folder models and ports
  backend/infrastructure
    tdlib               libtdjson over purego + generated tdapi bindings
    telegram/live       tg.Repository and tg.Accounts over TDLib
    telegram/demo       the in-memory demo workspace (DEMO=1 and every UI test)
    agent               provider gateways, OAuth, model catalog, sealed stores, demo gateway
    storage             atomic JSON, sealed (AES-256-GCM) files, the keychain
```

## Threads

MyGo views run on the main thread and redraw from state every frame. Work that touches Telegram, files or the network runs in a goroutine through `runtime.Runtime.Go`; it returns a function that `Runtime.Post` queues, and the root view drains the queue at the start of the next frame (`Runtime.Drain`). State therefore only changes where the views read it. TDLib updates arrive on the session's receive goroutine, are mapped to domain events there, and reach the chat store through the same queue.

## Frontend

Feature-Sliced Design, with Go packages as slices ([`../frontend/README.md`](../frontend/README.md)):

| Layer | Packages |
| --- | --- |
| `app` | `frontend/app`: routing, theme, global shortcuts, notifications, badge, toasts, automation lifecycle |
| `pages` | `onboarding`, `workspace` (three columns), `settings`, `lock` |
| `widgets` | `chatlist`, `conversation`, `profile`, `settings` (panes and search index), `mediaviewer`, `paperplane` (onboarding's folding blueprint), `stepper` |
| `features` | `signin`, `compose`, `messageactions`, `chatactions`, `search`, `accountmenu`, `agent` |
| `entities` | `chat` (the chat store: list, transcripts, composers, downloads), `onboarding` |
| `shared` | `kit` (coss anatomy), `theme`, `copy`, `icons`, `config` (shortcuts, countries, emoji, links), `media`, `runtime`, `testkit`, `lib/timefmt`, `assets` |

`cmd/archcheck` enforces the direction `app → pages → widgets → features → entities → shared`, forbids sibling-slice imports, and keeps the UI away from `backend/infrastructure` (only `shared/testkit` and tests may reach the demo workspace).

## Backend

Domain-Driven Design ([`../backend/README.md`](../backend/README.md)):

- `domain/telegram` — chats, messages, entities, people, accounts and sign-in steps, events, the `Repository` and `Accounts` ports, Markdown parsing.
- `domain/agent` — configuration, threads, redaction, audit records, trigger rules, scheduled tasks, cron, and the gateway, OAuth, catalog and store ports.
- `domain/preferences`, `domain/keywordfolder` — local settings (including the passcode hash) and keyword folders.
- `application/agent` — scoped payloads, panel runs with audit, message actions, follow-ups, vendor connection, automation (runner, trigger engine, scheduler) and the model's tools.
- `application/preferences`, `application/keywordfolder`, `application/telegram` — preference updates, keyword-folder membership, notification and badge rules.
- `infrastructure` — implements the ports; `cmd/archcheck` keeps the domain free of every other layer.

## Data flows

### Telegram

1. `bootstrap` loads `libtdjson` from the app's resources (or `build/tdlib-native` in development) and builds `live.Accounts`. Release builds link the API credentials (`make package`); `make dev` reads `TELO_TELEGRAM_API_ID` and `TELO_TELEGRAM_API_HASH`. A build without them shows the not-configured step.
2. `live.Accounts` keeps up to three accounts, tdesktop-style. Each has its own TDLib directory under `telegram/<account id>/`, its database encrypted with a 32-byte key held in the system credential store. One account is connected; switching parks it and opens the other. Signing in another account runs beside the active one until it is ready.
3. A `live.Session` answers `authorizationStateWaitTdlibParameters` itself, then maps TDLib's states to the sign-in steps onboarding draws (phone, code, password, registration, QR).
4. The session keeps TDLib's objects as updates deliver them (users, chats, groups, secret chats, files, accent colors, folders) and maps them to domain values on read. Profile pictures download on their own; a settled file republishes every chat and user it belongs to.
5. The chat store (`entities/chat`) pages the list, loads transcripts, sends optimistically and reconciles on `updateMessageSendSucceeded` by client id, and applies every domain event.

### Agent

1. The panel or a message action asks `application/agent.Service`. A scope (selected messages, a chat's unread messages, or a folder) is read from Telegram, redacted (emails, phone numbers, API keys), and written into the prompt with `telo://message/<chat>/<message>` references.
2. The gateway streams the configured provider: OpenAI-style chat completions (OpenAI, Groq, xAI, Kimi, DeepSeek, Mistral, compatible servers), Anthropic messages, or Gemini. Tool calls loop up to the configured step limit; the tools read the visible workspace, read Telegram, and manage automation.
3. Every run that sent a payload appends an audit record with the SHA-256 of the exact prompt and no message text. Threads are sealed in the user data directory.
4. Automation subscribes to the connected account: matching trigger rules and due scheduled tasks run without the panel and deliver as a draft or a sent message ([`003`](../decisions/003-agent-automation-safety.md)).

## Storage

See [`../backend/database.md`](../backend/database.md) for every file Telo writes.
