# Logging

This document defines logging and error-observability conventions for Telo's Electron main process.

> **Status: partial.** There is no structured logger yet. Telegram catch-up
> and update-queue failures are written with `console.error` from
> `TeleprotoRepository.emitSyncError`. Do not add incidental `console.log`
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

- API keys, Telegram session strings, login codes, or passwords.
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
- Language-level Telegram sync failures (`TypeError`, `instanceof` not callable, and similar) stay in the main-process log. They are not published as `sync-error` workspace events. If one still arrives as an IPC rejection, the renderer drops it rather than mapping it to the generic "Telegram sync issue" copy: that string is never painted under the conversation header.
- A sync failure raised while the transport is down is published as `connection-state: "offline"`, never as `sync-error`. Telegram's `ConnectionsManager` reports exactly this condition as a connection state — the chat list title reads "Connecting…" — and never as an error surface, because reconnecting is not something the reader can act on. teleproto rejects with a bare `Error` whose prose ("Cannot send requests while disconnected. Please reconnect.") carries no type, so the classification reads the client's own `connected` flag rather than matching the message text. The renderer also drops that prose if a request fails before the `connection-state` event lands. The failure is still logged in the main process.
