# Logging

This document defines logging and error-observability conventions for Telo's Electron main process.

> **Status: partial.** There is no structured logger yet. Unexpected Telegram
> adapter failures are written with `console.error` from
> `TdlibTelegramRepository` and `TdlibClientCoordinator`. Do not add incidental `console.log`
> debugging.

## Scope

- These rules cover the **main process** (backend: domain, application, infrastructure, interfaces).
- Renderer diagnostics are out of scope here; renderer failures surface to the user through UI states, not logs.

## Requirements

- Logs are structured (one JSON object per line) and written to stdout; the packaged app redirects stdout to a log file under the user-data directory.
- Logs are written in English.
- Sensitive data is masked before it is logged (see Masking).

## Log levels

| Level   | Use                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| `debug` | Detailed diagnostics (IPC payload shapes, retry attempts). Off by default in packaged builds.                      |
| `info`  | Lifecycle and business events: app ready, window created, Telegram auth state transitions, agent run start/finish. |
| `warn`  | Recoverable problems: a reconnect, a rejected notification, an unsupported platform capability.                    |
| `error` | Failures that require attention: IPC handler errors, persistence write failures, agent run failures.               |

## What to log

- App lifecycle: startup, window creation, shutdown.
- IPC handler outcomes: channel name, duration, success/failure — **not** raw payloads.
- External service calls (Telegram, agent backend) with duration and outcome.
- Agent runs: include the `runId` already generated in `register-ipc.ts`; it acts as the correlation ID for all events of that run.
- Errors with context, but without sensitive payloads.

## What not to log

- API keys, OAuth tokens, Telegram session strings, login codes, or passwords.
- Message bodies or other user content crossing IPC.
- Full IPC payloads that contain user data — log shape and identifiers only.
- Filesystem paths in user-facing error messages (they may appear in internal debug logs only).

## Masking

Mask sensitive fields with a consistent pattern:

```json
{
  "phone": "+1-***-****-1234",
  "session": "tg_***"
}
```

## Correlation

- An agent run propagates its `runId` through every log entry and AG-UI event of that run.
- One-shot IPC calls are correlated by channel name; if cross-layer tracing is ever needed, generate a request ID in the handler and pass it inward.

## Errors

- Log unexpected errors with full context in the main process.
- Do not swallow errors with silent `catch` blocks.
- Translate low-level errors into domain/application errors before they cross IPC; the renderer only receives concise, user-safe messages (see [`api-conventions.md`](api-conventions.md)).
- Language-level Telegram sync failures (`TypeError`, `instanceof` not callable, and similar) stay in the main-process log. They are not published as `sync-error` workspace events, and the conversation header has no error strip for them.
- A sync failure raised while the transport is down is published as `connection-state: "offline"`, never as `sync-error`. Telegram's `ConnectionsManager` reports exactly this condition as a connection state — the chat list title reads "Connecting…" — and never as an error surface, because reconnecting is not something the reader can act on. TDLib reports the same condition as `connectionStateWaitingForNetwork` / `connectionStateConnecting`. The failure is still logged in the main process.
- User-facing catch-up and update-queue failures (`FLOOD_WAIT_*` and similar) are logged the same way. They are not published as workspace events and are not painted in the renderer.
