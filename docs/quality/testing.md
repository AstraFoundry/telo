# Testing

## Quality gate

`make check` is the gate, locally and in CI on Ubuntu, macOS and Windows:

| Step | Target | Fails when |
| --- | --- | --- |
| Format | `make fmt` | a Go file is not gofmt'd |
| Vet | `make vet` | `go vet` reports a problem |
| Generated code | `make generated` | the copy keys or the TDLib bindings differ from what `cmd/copygen` and `cmd/tdgen` generate |
| Architecture | `make arch` | an import breaks the FSD or DDD rules ([`../frontend/import-rules.md`](../frontend/import-rules.md)) |
| TDLib capabilities | `make capabilities` | [`tdlib-capability-matrix.json`](../telegram/tdlib-capability-matrix.json) pins a TDLib other than the one `package.json` stages, a `covered` capability names a TDLib function or update the bindings do not generate, or its evidence file does not exist |
| telegram-macos parity | `make parity` | the ledger and the upstream inventory disagree ([`../telegram/parity.md`](../telegram/parity.md)) |
| Tests | `make test` | a Go test fails; runs against the staged libtdjson (`TELO_REQUIRE_TDLIB=1`) |
| Documentation | `make docs` | Markdown lint fails, a relative link points nowhere, or a document names a `make` target the Makefile does not define |

## Unit and integration tests

- **Domain**: rules, cron, redaction, Markdown, send permissions, preferences normalization and the passcode hash.
- **Application**: agent runs with audit and redaction, scopes, automation (triggers, schedule, delivery and draft conflicts), notification rules — over the demo workspace and fake gateways.
- **Infrastructure**: sealed and atomic storage, the HTTP gateways against local test servers (streaming, tool loops, errors), TDLib loading, the mapping from TDLib objects, and `TestSignInReachesPhoneStep`, which drives a real TDLib client to the phone step without a network login.
- **Checks**: `cmd/archcheck`, `cmd/capabilitycheck`, `cmd/paritycheck` and `internal/parity` test their own rules, including synthetic violations.

## UI tests

MyGo's headless `ui.Tester` renders the real views over `frontend/shared/testkit` (the demo workspace, a fixed clock, in-memory stores and a recording desktop) and drives them by text, role and keys: click, right-click, type, press, open menus. They cover:

- **Onboarding** — sign-in by phone and code, QR sign-in, the agent step, a build without credentials.
- **Workspace** — the chat list and conversation in light and dark, sending with formatting, search.
- **Interactions** — the message context menu, the chat context menu, composer formatting and the attach menu, and the keyboard shortcuts (reply stepping, chat stepping, edit last, Esc, info).
- **App** — settings search and panes, the passcode lock, the agent panel summarizing unread messages, the profile and account menu, the media viewer.
- **Onboarding figure** — `widgets/paperplane` folds the sheet through every stage in both themes, resting and halfway through each fold; its tests check that each step adds a fold and moves the camera, that every mark reads the model (W, L, 45°, 22.5°, the crease, K), and that Reduce motion lands a step at once.
- **Bootstrap** — the menu registry and its key bindings.

`make snapshots` writes each test's rendered frames to `.workspace/snapshots` for review; CI uploads them from Ubuntu.

Locate elements by visible text and role, never by layout position. Keep permutations in unit tests and use UI tests for journeys.

## Live Telegram

`make test-live` runs `TestLiveBaseline` against a real account, driving [`../telegram/baseline.md`](../telegram/baseline.md). It needs `TELO_LIVE_E2E=1`, `TELO_LIVE_DIR` (the `telegram` directory of a profile `make dev` signed in) and the API credentials. It is not part of `make check` or CI.

## Commands

```sh
make test
make snapshots
make test-live
make check
```
