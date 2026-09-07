# 005: TDLib is the Telegram client kernel

## Status

Accepted. Supersedes [`004-keep-teleproto.md`](004-keep-teleproto.md).

## Context

Telo is a third-party Telegram desktop client first. The workspace agent sits beside that client; it does not replace it. A daily-driver client needs three kernel properties Teleproto does not ship:

- A local message/chat database so restart and reconnect are not empty fetches.
- Authoritative chat-list order (including folder lists), not a projection over paged `GetDialogs`.
- Secret chats, which are device-local and end-to-end encrypted. `ChatKind` today is `"direct" | "group" | "channel" | "saved"`; there is no secret kind.

[`004-keep-teleproto.md`](004-keep-teleproto.md) rejected TDLib while those items were Wave 7 / out of scope. That premise is withdrawn. Teleproto remains a complete MTProto RPC surface; it is the wrong kernel for this product.

Node access is `tdl` + `prebuilt-tdlib` in the Electron **main** process (ADR [`001`](001-electron-ipc-boundary.md)). `tdweb` in the renderer is rejected: the account database would sit on the untrusted side.

## Decision

Replace the production Telegram adapter with TDLib. Keep `TelegramRepository` as the DDD port. Keep the demo adapter as the test double. Do not leak `td_api` or `libtdjson` into the renderer.

Packaging is a go/no-go in front of the adapter rewrite: electron-vite must externalize `tdl` / `prebuilt-tdlib`, electron-builder must asar-unpack the native addon and `libtdjson`, and a packaged smoke must load TDLib on the release OS matrix. If packaged load fails, stop; do not rewrite mappers on an unloadable binary.

Existing accounts re-authenticate. A GramJS/Teleproto string session cannot import into TDLib.

Wave 7 items that are **not** pulled in by this decision: VoIP and group calls (still need `tgcalls`), story browsing, forum topics, channel comments, bots / Mini Apps, Stars, wallets. A later product change added TDLib story posting and call-message history without adding call media or a story viewer.

## Consequences

### Backend (infrastructure + contracts)

The production adapter, session storage, dialog snapshot, and capability audit all change. TDLib owns `database_directory` per account under userData, encrypted with a `safeStorage`-derived key. `dialogs-<id>.json` and `telegram-<id>.session` are Teleproto-era files; the TDLib backend does not write them.

IPC stays the product contract. Two leaks must be closed in contracts (shared with the renderer, not UI work):

- `ChatPageCursorDto` is Telegram `GetDialogs` offsets. Make chat pagination cursors opaque.
- `StickerSetReferenceDto` carries `accessHash`. Keep hashes in main, or map to TDLib file/set ids.

Application use cases (`TelegramWorkspaceService`, chat/message actions, account coordinator) should keep calling the port. They must not import `tdl`.

### Frontend

Ordinary chat list, transcript, composer, search, and stickers stay on existing DTOs and events. They do not import TDLib.

They **do** change where the product surface is new or the DTO grows:

- `ChatKind` gains `"secret"`. Sidebar, header, and profile must mark secret chats (lock, device-only history). That is widgets/features work, not a kernel rewrite.
- Create/accept secret chat is a new user scenario (a feature slice), because nothing in the current onboarding or chat-list menus starts an E2EE chat.
- Chat-list order itself is not a frontend algorithm: the store already renders `chats` in array order. Correct order is an adapter + `chat-upsert` / position events problem. No sort rewrite in the renderer unless a bug shows the store reordering.

Agent UI is unchanged. Automation still talks to `TelegramRepository`.

### Persistence and operations

README can no longer claim “no C++ / no TDLib toolchain” after cutover. Release artifacts ship per-arch `libtdjson`. Win arm64 remains unsupported by `prebuilt-tdlib`. `make reset` still deletes userData, which now includes `tdlib/<accountId>/`.

## Alternatives considered

### Stay on Teleproto and build SQLite + secret chats in Telo

Rejected. That is a second TDLib: update state, chat positions, file references, and the secret-chat ratchet. The current adapter already pays part of that tax (`ignoreMigrated`, message-to-chat index, skipped `catchUp()` with no `pts` persistence). Building the rest in-process duplicates a maintained C++ kernel.

### `tdweb` in the renderer to avoid native packaging

Rejected. It contradicts ADR 001. Session and secret-chat keys would live where the renderer can read them.

### Dual-stack Teleproto + TDLib on one account

Rejected. Two MTProto sessions split updates and double flood risk. A temporary `TELO_TELEGRAM_BACKEND` flag is allowed only with separate userData during dogfood.

## References

- [`../todo/gaps.md`](../todo/gaps.md) — secret chats, call-message history, story posting, and client-kernel persistence are in scope; VoIP, story browsing, and Mini Apps stay Wave 7.
- [`../todo/tdlib-migration.md`](../todo/tdlib-migration.md) — packaging gate, adapter waves, verification pyramid, cutover.
- [`../project/architecture.md`](../project/architecture.md) — main-process Telegram; IPC DTOs.
- [`001-electron-ipc-boundary.md`](001-electron-ipc-boundary.md) — secrets stay in main.
- [tdlib/td](https://github.com/tdlib/td) / [TDLib getting started](https://core.telegram.org/tdlib/getting-started)
- [eilvelia/tdl](https://github.com/eilvelia/tdl)
