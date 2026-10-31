# Project

Telo is a native desktop Telegram client for macOS, Windows and Linux, with an agent beside the conversation. It is written in Go on [MyGo](https://github.com/egoist/mygo), uses TDLib as its Telegram kernel, and follows [Telegram for macOS](https://github.com/TelegramMessenger/telegram-macos) for its interactions and features.

## Stack

- **UI:** MyGo native views, organized by Feature-Sliced Design ([`../frontend/README.md`](../frontend/README.md)), with the coss component anatomy shared with AstraFoundry's Arion and Telo's own palette ([`../frontend/design-system.md`](../frontend/design-system.md)).
- **Telegram:** TDLib 1.8.67 through `purego`, with bindings generated from the pinned `td_api.tl` ([`../telegram/README.md`](../telegram/README.md)).
- **Agent:** streaming HTTP clients for the providers of [`002`](../decisions/002-byoa-providers.md), with redaction, audit and automation ([`agent.md`](agent.md)).
- **Parity:** a committed ledger of every telegram-macos surface, checked by `make check` ([`../telegram/parity.md`](../telegram/parity.md)).

## Product boundaries

- Telo is an independent third-party client and is not affiliated with Telegram.
- Telegram sessions, API keys and OAuth tokens stay in the Go process and are stored sealed with keys from the system credential store; nothing is written in the clear where no credential store exists.
- The agent reads only the payload the user scoped (redacted before it leaves the device) and the tools it is given. It never sends on its own except through an automation the user or the agent set to auto-send, in plain view of the automation list and the audit log.
- Calls, payments and web content are out of scope ([`007`](../decisions/007-telegram-macos-parity-scope.md)).

See [architecture](architecture.md), [agent](agent.md) and [references](references.md).
