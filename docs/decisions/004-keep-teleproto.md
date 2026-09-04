# 004: Keep Teleproto; do not migrate the Telegram stack to TDLib

## Status

Accepted.

## Context

Telo is an Electron desktop Telegram client. The Telegram workspace is implemented as a DDD port (`TelegramRepository`) with two adapters: an in-memory demo workspace and a production adapter over [`teleproto`](https://github.com/sanyok12345/teleproto) (a maintained TypeScript fork of GramJS that speaks Telegram's MTProto TL API at layer 229).

The production adapter is not a thin client wrapper. It owns authentication, multi-account session lifecycle, live update mapping, dialog pagination (including a Teleproto 1.229 `ignoreMigrated` workaround), media upload/download, stickers, folders, search, reactions, and entity conversion into Telo DTOs. That surface is audited by `pnpm teleproto:check` against [`docs/telegram/teleproto-capability-matrix.json`](../telegram/teleproto-capability-matrix.json).

[`tdlib/td`](https://github.com/tdlib/td) is Telegram's official C++ client library. It exposes a high-level JSON API (`td_api.tl`), not the raw MTProto schema, and persists a local encrypted database. Node access is through a third-party binding (`tdl` + `prebuilt-tdlib`), not an official first-party npm package.

The product already chose Teleproto as a documented property of the stack: no C++ native binaries and no TDLib build toolchain. Remaining product gaps that still need protocol work (voice/video notes, transcription) are already present on the Teleproto TL surface. Wave 7 items that TDLib is uniquely strong at (secret chats, calls) are explicitly out of scope.

## Decision

Do **not** fully migrate the Telegram infrastructure from Teleproto to TDLib.

Keep Teleproto as the production adapter. Keep the demo adapter as the test and development double. Continue to evolve `TelegramRepository` and the capability matrix against the MTProto request surface.

Revisit only if one of these becomes true:

- Teleproto stops tracking Telegram TL layers or becomes unmaintained with no viable TypeScript successor.
- The product promotes secret chats or VoIP from Wave 7 into an in-scope requirement.
- Update synchronization or media reliability remains broken after persisting Teleproto `pts`/`qts`/`seq` (or an equivalent local update state) rather than relying on paged reads plus live `catchUp()`.

A revisit is a new ADR. It is not a silent adapter swap.

## Consequences

### What stays easy

- Install, typecheck, and package remain pure TypeScript: `pnpm install` plus Electron Builder, no `libtdjson` per architecture, no `electron-rebuild`, no asar unpack of native addons.
- The current `asar: true` / electron-vite `externalizeDepsPlugin()` main-process pipeline keeps working. Native TDLib bindings are a known failure mode with Vite-bundled Electron mains.
- Sessions remain an encrypted GramJS/Teleproto string (`telegram.session` via `safeStorage`). Existing accounts do not have to log in again.
- Persistence stays local files, not a Telegram database: dialog snapshot JSON, media cache, no on-disk message history. That matches [`docs/backend/database.md`](../backend/database.md) and the architecture rule that paged reads are the authoritative snapshot.
- The demo adapter, Vitest fakes, and Playwright e2e suite continue to share one DTO contract. Teleproto-shaped mapping tests (~8k lines in `backend/src/infrastructure/telegram/`) stay valid.
- `pnpm teleproto:check` remains a meaningful audit gate: every Teleproto request namespace has an explicit policy.

### What stays hard

- Telo, not the library, is responsible for update gap handling, entity/file-reference freshness, flood-wait retries, and TL quirks (the inverted `ignoreMigrated` predicate is the current example).
- Secret chats and VoIP are not inherited "for free" later. TDLib would still not ship call media by itself (that needs `tgcalls` / libtgvoip on top).
- Official-client behavioral parity (local SQLite, identical update ordering, secret chats) is not a goal of this stack.

### What a full TDLib migration would actually touch

This would not be an infrastructure-only rewrite. The domain port and IPC contracts are MTProto-shaped:

- Dialog cursors are Telegram's exclusive `(peer, top-message, date)` tuple, not TDLib's `chat_list` / `from_message_id` model.
- `TelegramSessionRepository` stores a string, not a database directory.
- Message entities, sticker hashes, access hashes, and media keys are mapped from TL objects.
- The capability matrix fingerprints Teleproto request classes (825 at the current pin), not `td_api` methods.

TDLib also inverts the persistence model: it wants a per-account encrypted SQLite tree under userData. That conflicts with "local files, no database" and with the choice not to persist `pts`/`qts`/`seq`. Session formats are incompatible; every signed-in account would have to authenticate again. Release packaging would need platform-specific `libtdjson` for macOS (x64/arm64), Windows (x64; arm64 is not in `prebuilt-tdlib`), and Linux (glibc/musl × x64/arm64), plus asar unpack and Vite externals for `tdl`.

The production Teleproto adapter plus its dedicated tests is on the order of 8k lines; the demo adapter and account coordinator are another several thousand. Replacing that with a TDLib adapter is a second full client mapping, not a find-and-replace.

## Alternatives considered

### Full migration to TDLib now

Rejected. The gains (official update engine, local DB, secret chats) do not match the current product scope, and the costs hit packaging, persistence, session continuity, contracts, tests, and CI together. TDLib does not unlock the next in-scope gap: voice notes are already on Teleproto's `sendFile` / `DocumentAttributeAudio` / `messages.TranscribeAudio` surface.

### Dual-stack (Teleproto and TDLib behind the same port)

Rejected. One Telegram account cannot usefully run two independent MTProto sessions without doubling flood risk and splitting updates. Two mappings of every DTO would freeze the port and double the audit surface.

### Swap only the transport, keep Telo DTOs

Rejected as a hidden full rewrite. TDLib's JSON API is a different schema (`td_api.tl` vs Telegram `api.tl`). There is no typed `Api.messages.GetDialogs` path. Every mapper (`teleproto-message-entities`, `teleproto-message-media`, `teleproto-folders`, `teleproto-message-reactions`, `teleproto-reply-markup`, and the 3k-line repository) would be rewritten against different types, then still forced through MTProto-shaped cursors.

### Stay on Teleproto; persist update state later

Accepted as the incremental path if live sync becomes the problem. Architecture already documents why startup skips `catchUp()`: there is no persisted `pts`/`qts`/`seq`. Fixing that is a Teleproto-adapter change, not a library migration.

## References

- [`../project/architecture.md`](../project/architecture.md) — Teleproto as the production Telegram adapter; paged reads as the authoritative snapshot.
- [`../telegram/README.md`](../telegram/README.md) — Teleproto capability baseline and `pnpm teleproto:check`.
- [`../todo/gaps.md`](../todo/gaps.md) — Wave 6 voice notes are Teleproto-ready; Wave 7 calls/secret chats/stories are out of scope.
- [`../backend/database.md`](../backend/database.md) — no application database.
- [teleproto](https://github.com/sanyok12345/teleproto) / [teleproto FAQ on TDLib](https://docs.teleproto.dev/faq)
- [tdlib/td](https://github.com/tdlib/td)
- [tdl](https://github.com/eilvelia/tdl) (community Node binding) and [prebuilt-tdlib](https://github.com/eilvelia/tdl/tree/main/packages/prebuilt-tdlib)
