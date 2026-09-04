# Architecture

## System

```text
React renderer (FSD)
  | narrow typed IPC through contextBridge
Electron interfaces
  | application use cases
DDD domain ports
  | adapters
TDLib · AI SDK (named providers + OpenAI-compatible) · encrypted local files · OS notifications
```

The renderer is unprivileged: `sandbox` and `contextIsolation` are enabled and Node integration is disabled. The preload exposes only `TeloDesktopApi`. Navigation is denied. Message links open through the operating system only after both the renderer and main process allowlist their protocol (`https`, `http`, `mailto`, or `tel`); script, data, file, and Telegram deep-link protocols remain blocked.

## Frontend

The dependency direction is `app → pages → widgets → features → entities → shared`. Each slice exports a root public API. `shared/ui` is the sole public component surface and re-exports installed BEUI components. Feature-specific compositions may provide layout and state but must not recreate design-system primitives. Icons come from `@phosphor-icons/react`; UI copy comes from `shared/config/copy.ts`.

The renderer's imports from `contracts/src` are an intentional exception to FSD. Contracts are a transport boundary shared with the Electron process and contain no domain behavior.

## Backend

- `domain`: agent configuration, thread, and automation (trigger rule, scheduled task, cron expression) invariants, user preferences, keyword folders, and Telegram/agent ports.
- `application`: save configuration, connect/disconnect a vendor OAuth account, list vendor models, run agent, manage agent threads, manage and execute agent automation (automation service, run runner, trigger engine, scheduler), update preferences, keyword-folder CRUD and projection, and Telegram workspace, chat-state, message-action, and logout use cases.
- `infrastructure`: AI SDK provider packages, vendor OAuth (PKCE loopback and device code), vendor model-list HTTP, Telegram (`tdl` + `prebuilt-tdlib` in main only; demo adapter for Playwright), encrypted JSON, and per-account TDLib directories.
- `interfaces`: Electron lifecycle, context bridge, IPC channels, and AG-UI event mapping.

Agent, preferences, and the account registry use local files. Telegram client data is a TDLib per-account database after cutover. Electron Builder produces macOS, Windows, and Linux artifacts.

## Data flows

### Agent

1. The renderer builds a snapshot of active chat metadata, visible messages, visible chats, and registered components.
2. IPC passes the prompt, snapshot, and current `threadId` to `RunAgentService`.
3. The service persists the user message to the thread, then streams; the thread's stored history is passed to the gateway so each conversation stays isolated.
4. AI SDK streams the selected provider (named `@ai-sdk/*` packages, or `@ai-sdk/openai-compatible` as fallback) and optionally exposes the `inspectWorkspace` tool.
5. The Electron adapter emits standard AG-UI lifecycle, state, text, custom activity, and error events.
6. The renderer reduces those events into the right-panel transcript.

Agent threads (transcripts plus the active-thread pointer) are persisted by the main process in `agent-threads.json` under Electron's user-data directory. The panel loads the thread list and the active transcript on mount; starting or switching a conversation goes through typed IPC so the selection survives restarts.

The renderer loads the agent configuration at startup. The panel renders a loading placeholder until it arrives, an unconfigured state with a Settings recovery action when no credential is stored, and the conversation UI once configured.

Agent automation runs without the panel. The trigger engine subscribes to the active account's workspace events and fires matching rules on new incoming messages; the scheduler fires cron and one-shot tasks on a single re-armed timer. Both execute through the automation runner (scoped payload, gateway stream, audit record) and deliver per the entry's mode — `auto-send` posts into the chat, `draft-only` parks a composer draft and never overwrites an occupied one. Every run pushes an `agent:automation-event` to the renderer; rules and tasks are managed from Settings → Agent or by the agent itself through its management tools, and persist in `agent-automation-rules.json` / `agent-automation-tasks.json`. Safety decisions are recorded in [`../decisions/003-agent-automation-safety.md`](../decisions/003-agent-automation-safety.md).

### Telegram

1. Telegram application credentials and the Google OAuth client id are injected at build time (main-process `define` from build secrets); the renderer submits only the phone number and login challenges over typed IPC, and Connect account never receives tokens. A build without Telegram credentials makes the connection flow render a configuration error instead of the form. OpenAI, Anthropic, xAI, and Kimi Connect use those vendors' public native OAuth clients (overridable with `TELO_<VENDOR>_OAUTH_CLIENT_ID`). A build without `TELO_GOOGLE_OAUTH_CLIENT_ID` offers Google through an API key instead of OAuth.
2. `TelegramAccountCoordinator` owns multi-account, tdesktop-style (`Main::Domain`, free-tier cap of 3 accounts): every signed-in account has its own `TdlibClientCoordinator` (which owns the TDLib client and `tdlib/<accountId>/` directory), profile, and media-cache directory; exactly one account is active and connected. Switching parks the current account (`close()` without deleting the directory) and restores the target; `accounts.json` is the switcher's registry.
3. First launch stays in onboarding until authentication succeeds. The demo workspace is not an onboarding choice: it opens only when the process is launched with `TELO_DEMO_WORKSPACE=1` (`make dev DEMO=1`).
4. Application credentials and phone metadata are encrypted in Electron's user-data directory. TDLib encrypts its SQLite tree with a `safeStorage`-derived key per account.
5. On later launches the main process reconnects by opening the saved `tdlib/<accountId>/` directory before the workspace is shown.
6. After authorization, the main process reads the current account with `getMe()` and downloads its profile photo. Typed IPC exposes only display metadata and an in-memory image data URL; TDLib files stay in the main process.
7. The active repository publishes typed workspace events. The TDLib adapter maps `updateNewMessage`, `updateMessageSendSucceeded`, `updateMessageContent`, `updateDeleteMessages`, `updateChatPosition`, `updateChatLastMessage`, `updateChatReadInbox`, and `updateConnectionState` onto the existing Telo event contract. Startup paints from TDLib's local message database (`use_message_database: true`), then live updates. Mapping runs through the adapter's in-memory chat/user maps so an update burst does not copy buffers across IPC. The demo adapter publishes the same event contract for deterministic development and tests. `TelegramWorkspaceService` carries the stream through `workspace:event`; the renderer subscribes only while the workspace is active, upserts messages idempotently, and updates previews and unread/read state. Synchronization failures are logged in the main process; they are not painted under the conversation header.
8. Initial and selected-chat reads use cursor-only request/response IPC. Chat list cursors are opaque strings (the last chat id). A restored session paints the sidebar from TDLib SQLite immediately. Chat DTOs carry optional `listOrder` (TDLib `position.order`); the renderer sorts by that value and keeps the 150ms row fade as motion only. Missing photos are downloaded in the main process and patched through a narrow `chat-avatar` event. The sidebar requests another page near its trailing edge. The transcript requests older pages only near its leading edge, prepends them without entry motion, and restores `scrollTop` by the exact content-height delta. Leaving the live edge reveals a BEUI page-down button above the composer; clicking it returns to the latest loaded message. Its unread divider uses Telegram's unread count and a loaded read id; it never pages backward solely to locate the boundary. The chat store clears the previous transcript as soon as selection changes and tags concurrent reads so a slow response from an older selection cannot overwrite the active conversation.
9. Chat state actions (pin, mute, mark read/unread) flow through `ChatActionsService` to the active `TelegramRepository`. The demo adapter mutates its in-memory dialogs; the TDLib adapter calls `toggleChatIsPinned`, `setChatNotificationSettings`, `viewMessages` / `toggleChatIsMarkedAsUnread`, and `addChatToList`. The renderer chat store applies the confirmed state; when `listOrder` is present it is the order source of truth.
10. Message actions flow through `MessageActionsService` to the active `TelegramRepository`: `sendMessage` accepts an optional `replyToId` and the resulting `MessageDto` carries a `replyTo` snapshot; `editMessage` rewrites the body and stamps `editedAt`; `deleteMessage` removes the message; `forwardMessage` appends a new outgoing message to the target chat. The demo adapter mutates its in-memory messages; the TDLib adapter calls `sendMessage`, `editMessageText`, `deleteMessages`, and `forwardMessages`. Optimistic sends keep Telo `clientId` and reconcile on `updateMessageSendSucceeded`. In the renderer, the message bubble context menu is the entry point: Reply and Edit (outgoing only) set the chat store's `composerTarget`, which the composer previews and `send` resolves — editing routes to `editMessage`, replying attaches `replyToId`; Delete and Forward open confirmation/picker dialogs in the conversation view and then call the store's `deleteMessage`/`forwardMessage`. A reply renders as a quote block (`replyTo` snapshot) above the bubble body, and an edit surfaces an `edited` marker next to the timestamp. The controlled composer clears only after the confirmed send/edit, preserving the draft when IPC fails.
11. Telegram message entities cross IPC as validated UTF-16 ranges. The TDLib adapter maps `textEntity` types onto `MessageEntityDto`; unknown or invalid ranges remain plain text. The BEUI `MessageRichText` primitive builds React nodes without raw HTML, preserves nested formatting, blocks unsafe link protocols, and reveals spoilers with an accessible static state rather than timeline motion. Reply snapshots preserve their entity ranges as well as text.
12. Telegram media is normalized as one media item per message; `groupedId` preserves native album membership. Downloads stay in the main process, publish byte progress/cancel/failure events, and expose completed cache files through the path-confined `telo-media:` protocol, so neither local paths nor large buffers cross IPC. Files staged in the composer never go through that protocol: the renderer holds the `File` objects and paints image thumbs from `blob:` object URLs, which the page CSP must allow (`img-src` / `media-src`) the way Telegram Web A does.
13. Sticker catalog state is account-scoped and server-backed. One typed catalog request combines lightweight installed-set metadata, recent stickers, and favorites; pack documents load only when the user selects that pack. A received sticker carries a TDLib set id (or `shortName`); hashes stay in the main process. Static WebP, animated TGS, video WebM, and inline custom emoji all continue through the shared media cache.
14. Log out flows through `TelegramLogoutService` to `TelegramAccountCoordinator.logout()`: the active account's TDLib client logs out and closes, its `tdlib/<accountId>/` directory, encryption key, profile, and media-cache directory are deleted, and its registry entry is dropped; the next most recent account then restores (`restoring` → `ready`), or the auth state returns to `idle` when none remain. In the demo workspace logout is a no-op; resetting the demo workspace is owned by the renderer clearing the `demoWorkspace` preference. The renderer telegram store calls the `telegram:logout` IPC channel and resets its auth state and current user to their initial values.

### Preferences

1. User preferences (agent panel visibility, demo workspace flag, interface theme, accent color, message text size, time format, send-with-Enter, notifications toggle) are persisted by the main process in `preferences.json` under Electron's user-data directory. Unrecognized or out-of-range persisted values and files that predate a field fall back to that field's default (system theme, blue accent, 14px message text, system time format, send-with-Enter and notifications enabled). On every process start the main process writes `demoWorkspace` from `TELO_DEMO_WORKSPACE=1`, so a leftover true cannot reopen demo after a launch without the flag.
2. The renderer loads preferences at startup; the agent panel's open state, the demo workspace flag, and the theme have no other source of truth (no `localStorage`; the pre-preferences `telo:theme` key is migrated once and removed). The renderer never sets `demoWorkspace` to true.
3. Toggling the agent panel updates the renderer optimistically and persists through the `preferences:update` IPC channel; a failed write resyncs from the stored value. Theme selection follows the same optimistic-write pattern.
4. The theme slice applies the system theme at module scope to avoid a startup flash, then re-applies the persisted theme once `preferences:get` resolves; users with a persisted non-system theme may see a brief flash of the system theme.
5. All preference consumers subscribe to the shared external stores in `entities/preferences` (`useTheme`, `useAccentColor`, `useMessageTextSize`, `useTimeFormat`, `useSendWithEnter`, `useNotificationsEnabled`), so a change in Settings takes effect immediately without a remount: the composer switches between Enter-submits and Enter-newline (Cmd/Ctrl+Enter submits, via `onKeyDown` interception — beui is untouched), sidebar row timestamps and conversation message times re-render in the new time format (`system` defers to the locale `hour12` default), and the conversation column's `--message-font-size` variable (read only by bubble body text, never the sidebar preview) updates live. The agent store reads `notificationsEnabled` through the same stores to gate the run-completion system notification (see `docs/project/agent.md`).

### Settings

1. The account menu opens a dedicated Settings surface in the center workspace column.
2. Appearance (theme), Telegram connection, and Agent provider configuration live on that surface. The Telegram section shows the connected account card and keeps the connection form collapsed behind a reconnect action; the full form renders directly only when no account is connected.
3. Opening Settings closes the global Agent panel; the panel contains only the Agent conversation, activity, prompt, and conversation-level controls.
4. Selecting a chat in the sidebar while Settings is open returns the center column to the conversation surface (the sidebar notifies the app layer through `onSelectChat`).

## Source facts

Implementation follows the official Electron security and notification guidance, AI SDK tool/streaming APIs, AG-UI event schema, TDLib / `tdl` APIs, Playwright Electron API, Tailwind CSS v4 setup, Phosphor React exports, and the BEUI registry. Links are maintained in [references](references.md).
