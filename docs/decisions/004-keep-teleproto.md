# 004: Keep Teleproto; do not migrate the Telegram stack to TDLib

## Status

Superseded by [`005-tdlib-client-kernel.md`](005-tdlib-client-kernel.md).

The product now requires a complete Telegram client kernel (local message database, authoritative chat-list order, secret chats). Those are TDLib runtime features, not Teleproto protocol features. Keep this record for the evaluation that held while Wave 7 treated them as out of scope.

## Context

Telo is an Electron desktop Telegram client. The Telegram workspace is implemented as a DDD port (`TelegramRepository`) with two adapters: an in-memory demo workspace and a production adapter over [`teleproto`](https://github.com/sanyok12345/teleproto) (a maintained TypeScript fork of GramJS that speaks Telegram's MTProto TL API at layer 229).

The production adapter is not a thin client wrapper. It owns authentication, multi-account session lifecycle, live update mapping, dialog pagination (including a Teleproto 1.229 `ignoreMigrated` workaround), media upload/download, stickers, folders, search, reactions, and entity conversion into Telo DTOs. That surface is audited by `pnpm teleproto:check` against [`docs/telegram/teleproto-capability-matrix.json`](../telegram/teleproto-capability-matrix.json).

[`tdlib/td`](https://github.com/tdlib/td) is Telegram's official C++ client library. It exposes a high-level JSON API (`td_api.tl`), not the raw MTProto schema, and persists a local encrypted database. Node access is through a third-party binding (`tdl` + `prebuilt-tdlib`), not an official first-party npm package.

Teleproto's own documentation is explicit about audience: it is the Node.js Telethon analogue, the FAQ's default example is a userbot, and it tells readers to pick TDLib when they need official-client behavior parity. Telo is the opposite audience — a daily-driver desktop client. That orientation mismatch is real. It does not by itself decide the library: "more complete" splits into protocol surface versus client runtime, and Telo has already built a substantial runtime on top of the protocol.

The product already chose Teleproto as a documented property of the stack: no C++ native binaries and no TDLib build toolchain. Remaining product gaps that still need protocol work (voice/video notes, transcription) are already present on the Teleproto TL surface. Wave 7 items that TDLib's runtime uniquely owns (secret chats, ordered chat lists backed by a message database) are explicitly out of scope. VoIP still needs `tgcalls` even on TDLib.

## Decision

Do **not** fully migrate the Telegram infrastructure from Teleproto to TDLib.

Keep Teleproto as the production adapter. Keep the demo adapter as the test and development double. Continue to evolve `TelegramRepository` and the capability matrix against the MTProto request surface.

Treat Teleproto as the **wire protocol**, not as a substitute for a client kernel. Telo already owns that kernel: DTO mapping, dialog snapshots, media cache, serial update mapping, flood-wait retries, and the `ignoreMigrated` pagination fix. New Telegram work should keep landing in that adapter, not in raw Teleproto types leaking past the port.

Revisit only if one of these becomes true:

- Teleproto stops tracking Telegram TL layers or becomes unmaintained with no viable TypeScript successor.
- The product promotes secret chats or VoIP from Wave 7 into an in-scope requirement.
- Update synchronization or media reliability remains broken after persisting Teleproto `pts`/`qts`/`seq` (or an equivalent local update state) rather than relying on paged reads plus live `catchUp()`.
- The client-kernel tax dominates: chat-list ordering, file-reference refresh, entity cache, and update-gap recovery keep costing more than product features, which is the signal that Telo is re-implementing TDLib poorly.

A revisit is a new ADR. It is not a silent adapter swap.

## Consequences

### Protocol surface versus client runtime

Teleproto is not missing Telegram methods. The capability matrix fingerprints 825 request classes — the same MTProto surface official apps speak. TDLib is not a larger RPC catalog; it is a **client runtime** that hides that catalog behind `td_api`: local SQLite, guaranteed update order, chat-list positions, file objects with local/remote state, authorization as a state machine, and secret chats.

Teleproto's FAQ states the split in those words: pick the TypeScript library for Node automation; pick TDLib for official-client behavior parity. Telo is closer to the second job. Official Telegram Web A still proves the first path can ship a client: it speaks MTProto through a **custom GramJS fork** and then implements its own cache, workers, and UI kernel. Telegram Desktop likewise keeps its own MTProto stack rather than embedding TDLib. The library orientation is therefore a tax, not a hard veto.

Telo is already paying that tax. Startup skips `catchUp()` because there is no persisted `pts`/`qts`/`seq`. Dialog pages work around an inverted `ignoreMigrated` predicate. Private-chat deletions need a message-to-chat index because Telegram omits the peer. File downloads refresh expired file references by passing the whole message into `downloadMedia`. None of those are automation features; they are the client kernel Teleproto does not ship.

### What stays easy

- Install, typecheck, and package remain pure TypeScript: `pnpm install` plus Electron Builder, no `libtdjson` per architecture, no `electron-rebuild`, no asar unpack of native addons.
- The current `asar: true` / electron-vite `externalizeDepsPlugin()` main-process pipeline keeps working. Native TDLib bindings are a known failure mode with Vite-bundled Electron mains.
- Sessions remain an encrypted GramJS/Teleproto string (`telegram.session` via `safeStorage`). Existing accounts do not have to log in again.
- Persistence stays local files, not a Telegram database: dialog snapshot JSON, media cache, no on-disk message history. That matches [`docs/backend/database.md`](../backend/database.md) and the architecture rule that paged reads are the authoritative snapshot.
- The demo adapter, Vitest fakes, and Playwright e2e suite continue to share one DTO contract. Teleproto-shaped mapping tests (~8k lines in `backend/src/infrastructure/telegram/`) stay valid.
- `pnpm teleproto:check` remains a meaningful audit gate: every Teleproto request namespace has an explicit policy.
- Agent automation stays a Telo application concern (`AgentAutomationService`, draft-only default). It does not require the transport library to be "for userbots."

### What stays hard

- Telo, not the library, is responsible for update gap handling, entity/file-reference freshness, flood-wait retries, and TL quirks.
- Chat-list order, unread badges, and folder membership will never be as automatic as TDLib's `chat.positions` updates. The sidebar is a Telo projection over paged `GetDialogs` plus live events.
- Secret chats and VoIP are not inherited later. TDLib would still not ship call media by itself.
- Official-client behavioral parity is not a goal of this stack. If that goal changes, the library choice changes with it.

### What a full TDLib migration would actually touch

This would not be an infrastructure-only rewrite. The domain port and IPC contracts are MTProto-shaped:

- Dialog cursors are Telegram's exclusive `(peer, top-message, date)` tuple, not TDLib's `chat_list` / `from_message_id` model.
- `TelegramSessionRepository` stores a string, not a database directory.
- Message entities, sticker hashes, access hashes, and media keys are mapped from TL objects.
- The capability matrix fingerprints Teleproto request classes, not `td_api` methods.

TDLib also inverts the persistence model: it wants a per-account encrypted SQLite tree under userData. That conflicts with "local files, no database" and with the choice not to persist `pts`/`qts`/`seq`. Session formats are incompatible; every signed-in account would have to authenticate again. Release packaging would need platform-specific `libtdjson` for macOS (x64/arm64), Windows (x64; arm64 is not in `prebuilt-tdlib`), and Linux (glibc/musl × x64/arm64), plus asar unpack and Vite externals for `tdl`.

The production Teleproto adapter plus its dedicated tests is on the order of 8k lines; the demo adapter and account coordinator are another several thousand. Replacing that with a TDLib adapter is a second full client mapping, not a find-and-replace. The mapping would get _easier_ in places (files, chat order, auth states) and _harder_ in others (losing typed TL, fighting MTProto-shaped cursors, shipping native binaries).

## Alternatives considered

### Full migration to TDLib now

Rejected. The runtime gains (official update engine, local DB, secret chats, chat positions) are exactly what Teleproto does not pretend to be, and they still do not match the current product scope. The costs hit packaging, persistence, session continuity, contracts, tests, and CI together. TDLib does not unlock the next in-scope gap: voice notes are already on Teleproto's `sendFile` / `DocumentAttributeAudio` / `messages.TranscribeAudio` surface.

### Dual-stack (Teleproto and TDLib behind the same port)

Rejected. One Telegram account cannot usefully run two independent MTProto sessions without doubling flood risk and splitting updates. Two mappings of every DTO would freeze the port and double the audit surface.

### Swap only the transport, keep Telo DTOs

Rejected as a hidden full rewrite. TDLib's JSON API is a different schema (`td_api.tl` vs Telegram `api.tl`). There is no typed `Api.messages.GetDialogs` path. Every mapper (`teleproto-message-entities`, `teleproto-message-media`, `teleproto-folders`, `teleproto-message-reactions`, `teleproto-reply-markup`, and the 3k-line repository) would be rewritten against different types, then still forced through MTProto-shaped cursors.

### Stay on Teleproto; persist update state later

Accepted as the incremental path if live sync becomes the problem. Architecture already documents why startup skips `catchUp()`: there is no persisted `pts`/`qts`/`seq`. Fixing that is a Teleproto-adapter change, not a library migration. It is also the cheapest way to buy the one client-runtime piece Telo currently leaves on the table.

## References

- [`../project/architecture.md`](../project/architecture.md) — Teleproto as the production Telegram adapter; paged reads as the authoritative snapshot.
- [`../telegram/README.md`](../telegram/README.md) — Teleproto capability baseline and `pnpm teleproto:check`.
- [`../todo/gaps.md`](../todo/gaps.md) — Wave 6 voice notes are Teleproto-ready; Wave 7 calls/secret chats/stories are out of scope.
- [`../backend/database.md`](../backend/database.md) — no application database.
- [teleproto](https://github.com/sanyok12345/teleproto) / [teleproto FAQ on TDLib](https://docs.teleproto.dev/faq)
- [tdlib/td](https://github.com/tdlib/td) / [TDLib getting started](https://core.telegram.org/tdlib/getting-started)
- [tdl](https://github.com/eilvelia/tdl) (community Node binding) and [prebuilt-tdlib](https://github.com/eilvelia/tdl/tree/main/packages/prebuilt-tdlib)
- [Telegram Web A](https://github.com/Ajaxy/telegram-tt) — official web client on a custom GramJS fork, not TDLib.
