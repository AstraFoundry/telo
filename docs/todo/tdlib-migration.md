# TDLib full refactor

Execution ledger for replacing Teleproto with TDLib as the Telegram client kernel. Architecture decision: [`../decisions/005-tdlib-client-kernel.md`](../decisions/005-tdlib-client-kernel.md). Product checkboxes: [`gaps.md`](gaps.md) (客户端内核). This file is task order and dependencies only.

Telo stays a DDD desktop app. The renderer never imports `tdl` or `td_api`. `TelegramRepository` remains the port. The demo adapter stays the Playwright double. Agent, automation, and FSD layers do not change except where a DTO grows (`ChatKind: "secret"`).

## Non-goals

- VoIP, group calls, screen share (`tgcalls` is a separate stack)
- Story browsing, forum topics, channel comments, Mini Apps, Stars, wallets
- Importing existing Teleproto `StringSession` files (users re-login)
- `tdweb` in the renderer
- Two live MTProto sessions on one account

## Target shape

```text
React renderer (FSD)
  | TeloDesktopApi (unchanged channels)
Electron interfaces
  | application use cases (unchanged imports)
TelegramRepository
  | TdlibTelegramRepository    DemoTelegramRepository
  | tdl + prebuilt-tdlib (main only)
  | tdlib/<accountId>/ SQLite (encrypted)
```

`TELO_TELEGRAM_BACKEND=teleproto|tdlib` exists only during dogfood, each with its own `userData`. Default becomes `tdlib` at cutover. Teleproto is then deleted.

## Stop gates

1. **Packaged `libtdjson` load fails** on any OS in the release matrix → stop, do not write mappers.
2. **Secret-chat round trip fails** against a second device after the adapter exists → secret UI does not ship; kernel still can ship without E2EE UI, but the product kernel checklist stays open.
3. **Demo Playwright red** on a contract change → that wave does not merge.

---

## Wave 0 — Package native TDLib (P0)

Depends on: nothing. Everything else depends on this.

Prove Telo’s toolchain can ship TDLib before touching mappers.

### Work

- Add `tdl` and `prebuilt-tdlib`. Keep both **external** to the electron-vite main bundle ([electron.vite.config.ts](../../electron.vite.config.ts) already uses `externalizeDepsPlugin()`; confirm they are not inlined).
- `tdl.configure({ tdjson })` before `createClient`. Packaged path uses `app.isPackaged` + unpacked `process.resourcesPath`, not `node_modules` inside asar.
- electron-builder ([package.json](../../package.json) `build`):
  - `asarUnpack`: `**/node_modules/tdl/**/*.node`, `**/node_modules/prebuilt-tdlib/**`
  - `extraResources` only if unpack is not enough; do not copy `node_modules` across OS
- `electron-rebuild` against Electron 44’s ABI, not host Node 22.
- Main-process probe: create a client, handle `authorizationStateWaitTdlibParameters`, log ready. No mapper yet.
- Release-matrix smoke: packaged app on macOS (arm64/x64 as the runner provides), Windows x64, Ubuntu x64. Win arm64 is unsupported by `prebuilt-tdlib` — document the hole.

### Wave 0 exit

`pnpm package` artifact launches and loads `tdjson` on those three OS. Size and cold-start numbers recorded in [`ablation.md`](../telegram/ablation.md) (create with this wave).

---

## Wave 1 — Freeze the port (P0)

Depends on: Wave 0 green.

Make IPC library-agnostic so the TDLib adapter is not forced through MTProto offsets. Renderer keeps compiling. Demo E2E stays green.

### Contracts ([contracts/src/ipc.ts](../../contracts/src/ipc.ts))

- `ChatPageCursorDto`: replace `{ chatId, topMessageId, updatedAt }` with an opaque `string` (adapter-owned encoding). Frontend already round-trips `chatCursor` without reading fields ([chat-store.ts](../../frontend/src/entities/chat/model/chat-store.ts) `loadMoreChats`). Update test fixtures only.
- `ChatKind`: add `"secret"`. Exhaustive `switch`es in the renderer must compile in this wave (lock visual can wait for Wave 6; a type-level default is enough).
- Sticker `accessHash`: stop sending it to the renderer. `getStickerSet` takes `{ kind: "id", id }` or `shortName`; main process holds hashes / TDLib set ids.
- Optional `ChatDto.listOrder: string` (TDLib `position.order`) so the store can splice without guessing. If added, Wave 3 uses it; today `relocateChat` in `chat-store.ts` approximates pin/new-message order.

### Domain

- Replace `TelegramSessionRepository` string with an account **directory** port (`databaseDirectory(): string` + encryption key). Teleproto coordinator keeps using the string file until Wave 8.
- Stop requiring `TelegramDialogSnapshotRepository` for the TDLib backend. Demo may keep an in-memory snapshot.

### Application

- [telegram-workspace.ts](../../backend/src/application/telegram/telegram-workspace.ts) must not validate cursor _shape_ beyond non-empty string.
- Sticker-set validation must not require `accessHash`.

### Wave 1 exit

`make check` green. No TDLib mapper yet.

---

## Wave 2 — Coordinator + auth on TDLib (P0)

Depends on: Wave 0, Wave 1.

### New files (infrastructure)

- `tdlib-client.ts` — configure, createClient, `invoke`, update loop, close
- `tdlib-telegram-repository.ts` — implements `TelegramRepository` incrementally (auth + `getCurrentUser` + `logout` first; other methods throw `not-implemented` only in tests, never in a flagged production default)
- Wire [container.ts](../../backend/src/interfaces/electron/container.ts) / [telegram-account-coordinator.ts](../../backend/src/infrastructure/telegram/telegram-account-coordinator.ts): `TELO_TELEGRAM_BACKEND=tdlib` constructs the TDLib coordinator; default remains Teleproto until Wave 8

### Auth mapping

TDLib drives login through `updateAuthorizationState`. Map onto existing `TelegramAuthState` (phone, code, password, ready, error). Do not invent a parallel onboarding UI.

- `setTdlibParameters` (`database_directory`, `use_message_database: true`, `use_secret_chats: true`, `api_id` / `api_hash` from existing build-time credentials)
- `setAuthenticationPhoneNumber` / `checkAuthenticationCode` / `checkAuthenticationPassword`
- `getMe` → `CurrentUserDto` + profile photo via TDLib files → existing `telo-media:` cache

### Multi-account

One `database_directory` per account: `userData/tdlib/<accountId>/`. Park = `close` the client, do not delete the directory. Logout deletes the directory. Matches current coordinator semantics (one connected account).

### Wave 2 exit

Flag-on process completes phone login against a throwaway account. Onboarding e2e (`login-error.spec.ts`) still uses the e2e build without Telegram credentials.

---

## Wave 3 — Chat list, SQLite, order, folders (P0)

Depends on: Wave 2.

This is the kernel the product asked for: local DB + authoritative order.

### Adapter

- `loadChats` / `getChats` for main, archive, folder lists
- Subscribe: `updateNewChat`, `updateChatPosition`, `updateChatLastMessage`, `updateChatReadInbox`, `updateChatDraftMessage`, `updateChatNotificationSettings`, `updateChatTitle`, `updateChatPhoto`
- Map to `ChatDto` (`kind` includes `"secret"` when `chat.type._ === "chatTypeSecret"`)
- Emit `chat-upsert` and, when TDLib replaces a list, `chats` with opaque `nextCursor`
- `listFolders` ← `chatFolder` / `updateChatFolders` (Archive remains folder id 1 in Telo’s DTO if that stays the product convention; otherwise map explicitly and update copy once)

### Frontend (small)

- Stop using `relocateChat` as the source of truth once `listOrder` (or adapter-ordered `chats` events) exists. Keep the 150ms opacity promote as motion only.
- No new pages.

### Persistence

TDLib SQLite is the snapshot. Do not write `dialogs-<id>.json` on the TDLib backend. First paint after restart: `getChats` from local DB, then live updates.

### Ablation A1 / A2

Record: sidebar time-to-paint after kill-9; chat-list top-N vs Telegram Desktop on the same account; missed/duplicate upserts after airplane mode.

### Wave 3 exit

Flag-on: restart shows the same ordered list without a full network walk. Demo e2e unchanged.

---

## Wave 4 — History and live messages (P0)

Depends on: Wave 3.

### Wave 4 port methods

| Port                                            | TDLib                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listMessagePage`                               | `getChatHistory` (`from_message_id` = cursor; drop the cursor row; `nextCursor` = oldest id if the page is non-empty)                                                                 |
| `sendMessage`                                   | `sendMessage` + `inputMessageText`; `clientId` stored as `sid:<sending_id>`, copied onto the temp id, reconciled on `updateMessageSendSucceeded`                                      |
| `editMessage`                                   | `editMessageText`                                                                                                                                                                     |
| `deleteMessage`                                 | `deleteMessages` (`revoke` from `scope`)                                                                                                                                              |
| `forwardMessage`                                | `forwardMessages` (`dropAuthor` = `hideSender`)                                                                                                                                       |
| `setTyping` / `saveDraft`                       | `sendChatAction` / `setChatDraftMessage`                                                                                                                                              |
| `setChatPinned` / `Muted` / `Read` / `Archived` | `toggleChatIsPinned`, `setChatNotificationSettings`, `toggleChatIsMarkedAsUnread` / `viewMessages`, `addChatToList` archive                                                           |
| subscribe                                       | `updateNewMessage`, `updateMessageSendSucceeded` / `Failed`, `updateMessageContent`, `updateDeleteMessages`, `updateChatReadInbox` / `Outbox`, `updateUserStatus`, `updateChatAction` |

Optimistic send: keep Telo `clientId` / `sending|sent|failed`. Map `updateMessageSendSucceeded` onto the same bubble.

Serial mapping queue stays (current Teleproto adapter already serializes expensive mapping). TDLib already orders updates; the queue is for Telo DTO conversion only.

### Wave 4 exit

Demo messaging e2e green. Live: send/edit/delete/reply/forward between two test accounts.

---

## Wave 5 — Media, stickers, search, reactions (P0)

Depends on: Wave 4.

### Wave 5 port methods

| Port                                                            | TDLib                                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `downloadMedia` / `cancel` / `resolveMediaFile`                 | `downloadFile` / `cancelDownloadFile`; serve completed path through `telo-media:`                                                                                         |
| `sendMedia` / `cancelMediaUpload`                               | `sendMessageAlbum` / `sendMessage` + `inputFileLocal`; progress from `updateFile`                                                                                         |
| sticker catalog / send / fave / reorder / search / custom emoji | `getInstalledStickerSets`, `getStickers`, `searchStickers`, `addFavoriteSticker`, `reorderInstalledStickerSets`, `getCustomEmojiReactionStickers` / `getCustomEmojiFiles` |
| `searchGlobal` / `searchMessages`                               | `searchMessages` / `searchChatMessages`                                                                                                                                   |
| `listSharedMedia` / `listPinnedMessages`                        | `searchChatMessages` with `searchMessagesFilter*` / `getChatPinnedMessage`                                                                                                |
| `listChatMembers` / `getPeerProfile`                            | `getSupergroupMembers` / `getUser` / `getUserFullInfo`                                                                                                                    |
| `setMessageReaction` / `listAvailableReactions`                 | `addMessageReaction` / `removeMessageReaction` / `getMessageAvailableReactions`                                                                                           |
| `answerBotCallback`                                             | `getCallbackQueryAnswer`                                                                                                                                                  |

Keep [media-cache.ts](../../backend/src/infrastructure/telegram/media-cache.ts) LRU as a serving layer in front of TDLib local files, or point `telo-media:` at TDLib’s local file path if it already lives under userData. Do not copy large buffers across IPC.

### Wave 5 exit

Existing Playwright: `media-send`, `media-viewer`, `stickers`, `search`, `message-interaction` (reactions). Live: photo album + sticker send.

---

## Wave 6 — Secret chats (P1)

Depends on: Wave 3 (list) and Wave 4 (history). Can start UI copy against demo fixtures before live E2EE works.

### Backend

- `createNewSecretChat` / `createSecretChat`; `updateSecretChat`
- History and send already go through Wave 4 if `chatId` is the secret chat id
- TTL / screenshot service messages: map to existing service-message rendering or a small `MessageDto` variant — do not invent HTML

### Frontend (this is the UI work)

- `ChatKind === "secret"`: lock on sidebar row and header; copy that history is device-local
- New feature slice `features/start-secret-chat`: pick a user, IPC `createSecretChat(userId)`
- Accept/pending states from `updateSecretChat`
- Demo fixtures: one secret chat so Playwright does not need two real devices

### Wave 6 exit

Demo: secret chat visible, send text, lock visible. Live: create secret chat to a second device running official Telegram, both sides see E2EE messages; kill Telo, secret history still on that machine only.

---

## Wave 7 — Verification pyramid (P0, starts at Wave 1)

Not a late bolt-on. Each product wave adds tests in the same change.

### L0 CI every PR

- Vitest fake `tdl.Client` (mirror [teleproto-telegram-repository.test.ts](../../backend/src/infrastructure/telegram/teleproto-telegram-repository.test.ts))
- Golden: checked-in `td_api` JSON updates → `MessageDto` / `ChatDto`
- Demo Playwright suite ([tests/e2e/](../../tests/e2e/), [docs/quality/testing.md](../quality/testing.md)) — backend flag ignored when `TELO_DEMO_WORKSPACE=1`
- Demo adapter gains a secret-chat fixture in Wave 6

### L1 Capability audit

Replace `pnpm teleproto:check` with `pnpm telegram:check` against a product matrix keyed by Telo workflows + TDLib methods, not 825 Teleproto classes. `covered` requires evidence path. Wave 7 product gaps stay `not-applicable`.

### L2 Packaged smoke (release matrix)

Launch artifact with `TELO_TDLIB_SMOKE=1`; assert TDLib parameters accepted. No phone login.

### L3 Live harness (secret-gated, not PR CI)

Two test accounts. Nightly or `make test-live`. Scenarios: ordered chat list vs Desktop; send/receive; reconnect; account switch; media cancel; secret chat (Wave 6).

### L4 Ablation ([docs/telegram/ablation.md](../telegram/ablation.md))

| Id  | Compare                            | Metric                                  |
| --- | ---------------------------------- | --------------------------------------- |
| A0  | packaged Teleproto vs TDLib        | artifact size, launch, `tdjson` load    |
| A1  | `use_message_database` on vs off   | restart paint, disk bytes               |
| A2  | Teleproto vs TDLib same port calls | missed upserts, list order, flood waits |
| A3  | file pipeline                      | download/upload fail/cancel             |
| A4  | three accounts park/restore        | no leaked live client                   |

Go/no-go after A0 (Wave 0) and A2 (Wave 3–4).

---

## Wave 8 — Cutover (P1)

Depends on: Waves 0–5 green on flag; Wave 6 can lag if secret UI is the only open kernel item, but `use_secret_chats` should already be on.

1. Settings copy: Telegram engine changed, sign in again.
2. Default `TELO_TELEGRAM_BACKEND=tdlib`.
3. Remove `teleproto` dependency, `TelegramClientCoordinator`, `teleproto-*.ts`, `pnpm teleproto:check`.
4. README: drop “pure TypeScript / no TDLib”; document native binaries and Win arm64 hole.
5. [architecture.md](../project/architecture.md) Telegram flow: TDLib updates, not Teleproto event builders.
6. [database.md](../backend/database.md): `tdlib/<id>/` is source of truth; delete Teleproto file bullets that no longer exist.

---

## Layer map (what moves)

### Must change (backend / contracts)

- [backend/src/infrastructure/telegram/](../../backend/src/infrastructure/telegram/) — new TDLib adapter; delete Teleproto after cutover
- [telegram-account-coordinator.ts](../../backend/src/infrastructure/telegram/telegram-account-coordinator.ts) — directory session, flag
- [container.ts](../../backend/src/interfaces/electron/container.ts)
- [telegram-ports.ts](../../backend/src/domain/telegram/telegram-ports.ts) — session directory
- [contracts/src/ipc.ts](../../contracts/src/ipc.ts) — opaque cursor, `ChatKind`, sticker ref
- [package.json](../../package.json) — deps, `asarUnpack`, scripts
- electron-vite / release workflow — native artifacts

### Must change (frontend, Wave 1 fixtures + Wave 3 order + Wave 6 secret)

- [chat-store.ts](../../frontend/src/entities/chat/model/chat-store.ts) — opaque cursor types; position-aware list; secret kind
- Sidebar / header / profile widgets — lock + copy
- New `features/start-secret-chat`
- [shared/config/copy.ts](../../frontend/src/shared/config/copy.ts) — all new strings

### Must not change

- Agent gateway, AG-UI, automation safety (ADR 003)
- FSD import direction
- Demo workspace flag and Playwright launch fixtures (except extra secret fixture)
- `telo-media:` path confinement idea (target path may change)

---

## Suggested PR slices (one mergeable change each)

1. Wave 0 packaging spike + ablation A0 + L2 smoke
2. Wave 1 contracts + demo e2e
3. Wave 2 auth flag-on
4. Wave 3 list/order/folders + A1/A2
5. Wave 4 messages + live L3 send
6. Wave 5 media/stickers/search/reactions
7. Wave 6 secret chats (backend + UI + demo e2e)
8. Wave 8 cutover + delete Teleproto

Do not combine 0 with 4. Do not ship secret UI before list+history exist.
