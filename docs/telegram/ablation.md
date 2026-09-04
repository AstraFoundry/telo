# TDLib ablation

Recorded comparisons for the Teleproto → TDLib cutover. Same Telo `TelegramRepository` port. After cutover the production adapter is TDLib only.

Go/no-go after **A0** (packaging). Numbers below were taken on the Linux x64 cloud agent host unless noted.

## A0 — packaged Teleproto vs TDLib (Wave 0)

| Metric                        | Teleproto (prior artifact) | TDLib (`tdl` + `prebuilt-tdlib` 1.8.67)                                 |
| ----------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| Native payload                | none                       | `tdl` node addon asar-unpacked; `libtdjson` in `resources/tdlib-native` |
| Host Node load                | n/a                        | `authorizationStateWaitPhoneNumber` in ~170ms                           |
| Packaged `TELO_TDLIB_SMOKE=1` | n/a                        | run `pnpm package && pnpm tdlib:smoke` on each release OS               |
| Win arm64                     | ships                      | **unsupported** (`prebuilt-tdlib` has no win-arm64)                     |

**Go/no-go:** go on Linux x64 host load (`authorizationStateWaitPhoneNumber` in ~170ms). Packaged smoke is `pnpm tdlib:smoke` after `pnpm package` on macOS, Windows x64, and Ubuntu x64. Win arm64 is unsupported.

## A1 — `use_message_database` on vs off (Wave 3)

|                 | On (production)               | Off                             |
| --------------- | ----------------------------- | ------------------------------- |
| Restart sidebar | `getChats` from local SQLite  | empty until `loadChats` network |
| Disk            | `userData/tdlib/<accountId>/` | metadata-only                   |

Production keeps `use_message_database: true`.

## A2 — Teleproto vs TDLib on the same port (Wave 3–4)

| Call               | What to compare                                                |
| ------------------ | -------------------------------------------------------------- |
| `listChatPage`     | list order vs Telegram Desktop; missed/duplicate `chat-upsert` |
| `listMessagePage`  | older-page cursor; no dup ids                                  |
| `sendMessage`      | `clientId` reconcile via `updateMessageSendSucceeded`          |
| airplane reconnect | `offline` → `synchronizing` → `connected`; no missed upserts   |

Live numbers belong in a nightly `make test-live` run, not PR CI.

## A3 — file pipeline (Wave 5)

Photo/document download, upload, and cancel through `downloadFile` / `updateFile` / `cancelDownloadFile`. Completed files are copied into the account `media-cache/` directory and served on `telo-media:`.

## A4 — three accounts park/restore

Park = `close` the TDLib client without deleting `tdlib/<accountId>/`. Restore = `createClient` on that directory. A parked client must not keep receiving updates.
