# Logging

> **Status.** Telo writes no diagnostic log. Failures reach the person as UI states and toasts worded from the copy catalog, and TDLib's own log goes to stderr at verbosity 1, errors only (`TELO_TDLIB_VERBOSITY` raises it while developing). The agent audit log (`agent/agent-audit.jsonl`, [`database.md`](database.md)) is the only record Telo keeps, and it holds no message text. Do not add incidental `fmt.Println` or `log` debugging.

When a diagnostic log is added, it follows these rules.

## Requirements

- Structured: `log/slog` with a JSON handler, one object per line, in a file under the user data directory.
- English messages.
- Sensitive data masked before it is logged.

## Levels

| Level | Use |
| --- | --- |
| `debug` | Detailed diagnostics (TDLib request names, retries). Off in release builds. |
| `info` | Lifecycle: start, window, Telegram authorization steps, account switches, agent run start and end. |
| `warn` | Recoverable problems: reconnects, a rejected notification, a missing platform capability. |
| `error` | Failures that need attention: store writes, agent run failures, TDLib errors the UI cannot word. |

## What never appears

- API keys, OAuth tokens, database keys, login codes, passwords, the passcode.
- Message bodies, captions, drafts or agent prompts.
- Phone numbers and emails, except masked (`+1-***-****-1234`).

## Correlation

An agent run's id (`NewID`) correlates its log lines with its audit record.

## Errors

- Never swallow an error silently. Return it, or turn it into a domain error the UI shows.
- A dropped connection is a connection state (`tg.ConnectionChanged`: "Connecting…", "Updating…" in the chat list title, as Telegram shows it), never an error banner.
