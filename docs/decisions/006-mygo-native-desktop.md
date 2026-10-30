# 006: MyGo native UI replaces Electron

## Status

Accepted. Supersedes [`001-electron-ipc-boundary.md`](001-electron-ipc-boundary.md). Amends [`002-byoa-providers.md`](002-byoa-providers.md) and [`005-tdlib-client-kernel.md`](005-tdlib-client-kernel.md).

## Context

Telo shipped as Electron with a React renderer, the AI SDK and `tdl` in the main process. Three things pulled against that stack:

- A Telegram client is open all day. A browser engine per window costs memory and battery that a native client does not.
- The trust boundary of [`001`](001-electron-ipc-boundary.md) existed because the renderer was a web page. A single Go process has no renderer to distrust.
- AstraFoundry's Arion is built with [MyGo](https://github.com/egoist/mygo), a native Go UI toolkit that draws its own controls on macOS and Windows. Sharing the toolkit lets Telo share Arion's coss anatomy (buttons, cards, selects, the onboarding layout) while keeping its own colors.

## Decision

Rewrite Telo in Go on MyGo, pinned in `go.mod`.

- **UI.** Immediate-mode MyGo views, organized by Feature-Sliced Design as Go packages under `frontend/`. The coss anatomy lives in `frontend/shared/kit`; Telo's palette in `frontend/shared/theme` (cool neutrals at hue 250 and five accents) is independent of Arion's.
- **Telegram.** TDLib through `purego` (`backend/infrastructure/tdlib`), with no cgo. `cmd/tdgen` generates typed bindings from the pinned `td_api.tl` for the functions and objects Telo uses. `backend/infrastructure/telegram/live` implements the unchanged `tg.Repository` port; the demo workspace stays its test double.
- **Agent.** The AI SDK is replaced by `backend/infrastructure/agent`: streaming HTTP clients for OpenAI-style chat completions, Anthropic messages and Gemini `generateContent`, with tool calls. Vendor OAuth, model catalogs, redaction, audit and automation keep their contracts from [`002`](002-byoa-providers.md) and [`003`](003-agent-automation-safety.md).
- **Secrets.** Database keys, the agent configuration, threads, rules and tasks are sealed with keys held in the system credential store (`mygo.Secrets`). Telo never writes a secret in the clear where no credential store exists.
- **No web views.** Telo draws everything natively. A surface that only exists as web content (Mini Apps, Instant View pages) needs its own decision before it ships.

## Consequences

- One Go binary per platform, built with `CGO_ENABLED=0`; `libtdjson` ships beside it as a resource.
- Every view is testable headless with `ui.Tester`, on the demo workspace, including snapshots for review (`TELO_UI_SNAPSHOTS`).
- MyGo decodes still images and GIFs but not video or Opus; videos and voice notes open in the system player. Its text system has no spelling, substitution or transformation services, so those Edit menu items are out of scope ([`007`](007-telegram-macos-parity-scope.md)).
- Existing Electron preferences are read as before: the Go preferences keep the JSON names the Electron build wrote.

## Alternatives considered

- **Keep Electron.** Rejected for the memory cost and the duplicated trust boundary above.
- **SwiftUI/AppKit.** A macOS-only client; Telo targets Windows too.
- **Wails or another web-view shell in Go.** Keeps a browser engine and gives up native controls.

## References

- [`docs/project/architecture.md`](../project/architecture.md)
- [`docs/frontend/design-system.md`](../frontend/design-system.md)
- [MyGo](https://github.com/egoist/mygo)
