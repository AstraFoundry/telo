# Architecture

## System

```text
React renderer (FSD)
  | narrow typed IPC through contextBridge
Electron interfaces
  | application use cases
DDD domain ports
  | adapters
Teleproto · AI SDK · encrypted local files · OS notifications
```

The renderer is unprivileged: `sandbox` and `contextIsolation` are enabled and Node integration is disabled. The preload exposes only `TeloDesktopApi`. Navigation is denied. Message links open through the operating system only after both the renderer and main process allowlist their protocol (`https`, `http`, `mailto`, or `tel`); script, data, file, and Telegram deep-link protocols remain blocked.

## Frontend

The dependency direction is `app → pages → widgets → features → entities → shared`. Each slice exports a root public API. `shared/ui` is the sole public component surface and re-exports installed BEUI components. Feature-specific compositions may provide layout and state but must not recreate design-system primitives. Icons come from `@phosphor-icons/react`; UI copy comes from `shared/config/copy.ts`.

The renderer's imports from `contracts/src` are an intentional exception to FSD. Contracts are a transport boundary shared with the Electron process and contain no domain behavior.

## Backend

- `domain`: agent configuration and thread invariants, user preferences, keyword folders, and Telegram/agent ports.
- `application`: save configuration, run agent, manage agent threads, update preferences, keyword-folder CRUD and projection, and Telegram workspace, chat-state, message-action, and logout use cases.
- `infrastructure`: AI SDK, Teleproto, encrypted JSON, session storage, and demo adapters.
- `interfaces`: Electron lifecycle, context bridge, IPC channels, and AG-UI event mapping.

The app uses local files rather than a database, cache, or message broker. Electron Builder produces macOS, Windows, and Linux artifacts.

## Data flows

### Agent

1. The renderer builds a snapshot of active chat metadata, visible messages, visible chats, and registered components.
2. IPC passes the prompt, snapshot, and current `threadId` to `RunAgentService`.
3. The service persists the user message to the thread, then streams; the thread's stored history is passed to the gateway so each conversation stays isolated.
4. AI SDK streams provider output and optionally exposes the `inspectWorkspace` tool.
5. The Electron adapter emits standard AG-UI lifecycle, state, text, custom activity, and error events.
6. The renderer reduces those events into the right-panel transcript.

Agent threads (transcripts plus the active-thread pointer) are persisted by the main process in `agent-threads.json` under Electron's user-data directory. The panel loads the thread list and the active transcript on mount; starting or switching a conversation goes through typed IPC so the selection survives restarts.

The renderer loads the agent configuration at startup. The panel renders a loading placeholder until it arrives, an unconfigured state with a Settings recovery action when no API key is stored, and the conversation UI once configured.

### Telegram

1. Telegram application credentials are injected at build time (main-process `define` from build secrets); the renderer submits only the phone number and login challenges over typed IPC. A build without credentials makes the connection flow render a configuration error instead of the form.
2. `TelegramClientCoordinator` owns the Teleproto client and session lifecycle.
3. First launch stays in onboarding until authentication succeeds. The demo workspace is not an onboarding choice: it opens only when the process is launched with `TELO_DEMO_WORKSPACE=1` (`make dev DEMO=1`).
4. Application credentials, phone metadata, and the session string are encrypted in Electron's user-data directory.
5. On later launches the main process reconnects the saved session before the workspace is shown.
6. After authorization, the main process reads the current account with `getMe()` and downloads its profile photo. Typed IPC exposes only display metadata and an in-memory image data URL; the session remains in the main process.
7. The active repository publishes typed workspace events. The Teleproto adapter registers `NewMessage`, `EditedMessage`, `DeletedMessage`, and inbox/outbox `MessageRead` builders after authorization, removes them before disconnecting, and keeps a message-to-chat index so private-chat deletion updates can be routed even when Telegram omits the peer. Startup does not block on `catchUp()`: Telo does not persist Teleproto's `pts`/`qts`/`seq` update state, so paged dialog and message reads are the authoritative current snapshot and historical events emitted before the renderer subscribes would be wasted work. After a real runtime reconnect, the adapter runs one coalesced `catchUp()` and publishes explicit offline, synchronizing, and connected states; Teleproto continues to detect live update gaps internally. Potentially expensive update mapping (sender and reply resolution) runs through a serial queue, preserving Telegram event order and preventing an update burst from creating unbounded concurrent RPC and conversion work. The demo adapter publishes the same event contract for deterministic development and tests. `TelegramWorkspaceService` carries the stream through `workspace:event`; the renderer subscribes only while the workspace is active, upserts messages idempotently, updates previews and unread/read state, and surfaces synchronization failures rather than silently swallowing handler errors.
8. Initial and selected-chat reads use cursor-only request/response IPC; there is no fixed-limit compatibility path. Dialog cursors carry the exclusive peer/top-message/date tuple expected by Telegram and ignore pinned dialogs after the first page. Message cursors are exclusive message IDs. Chat DTOs return immediately with cached avatars or initials; missing photos are downloaded by a three-worker background queue, retained in a bounded in-memory LRU, and patched through a narrow `chat-avatar` event so stale list snapshots cannot overwrite newer previews or unread counts. The sidebar requests another page near its trailing edge. The transcript requests older pages near its leading edge or from its BEUI history button, prepends them without entry motion, and restores `scrollTop` by the exact content-height delta. The chat store clears the previous transcript as soon as selection changes and tags concurrent reads so a slow response from an older selection cannot overwrite the active conversation.
9. Chat state actions (pin, mute, mark read/unread) flow through `ChatActionsService` to the active `TelegramRepository`. The demo adapter mutates its in-memory dialogs (mark read clears the unread counter, mark unread flags one); the Teleproto adapter calls `messages.toggleDialogPin`, `account.updateNotifySettings`, and `messages.markDialogUnread`/`markAsRead`. The renderer chat store applies the confirmed state to its chat list. Dialog mapping derives mute state from Telegram notify settings and identifies Saved Messages from the self user instead of substituting display defaults.
10. Message actions flow through `MessageActionsService` to the active `TelegramRepository`: `sendMessage` accepts an optional `replyToId` and the resulting `MessageDto` carries a `replyTo` snapshot; `editMessage` rewrites the body and stamps `editedAt` (Telegram only allows editing one's own messages — the demo adapter rejects non-outgoing targets, the Teleproto adapter is constrained by the API); `deleteMessage` removes the message; `forwardMessage` appends a new outgoing message to the target chat without a `replyTo` snapshot. The demo adapter mutates its in-memory messages and refreshes the target dialog preview on forward; the Teleproto adapter calls `sendMessage` with `replyTo`, `editMessage`, `deleteMessages`, and `forwardMessages`. Sender labels are resolved from Telegram entities rather than a generic placeholder. In the renderer, the message bubble context menu is the entry point: Reply and Edit (outgoing only) set the chat store's `composerTarget`, which the composer previews and `send` resolves — editing routes to `editMessage`, replying attaches `replyToId`; Delete and Forward open confirmation/picker dialogs in the conversation view and then call the store's `deleteMessage`/`forwardMessage`. A reply renders as a quote block (`replyTo` snapshot) above the bubble body, and an edit surfaces an `edited` marker next to the timestamp. The controlled composer clears only after the confirmed send/edit, preserving the draft when IPC fails.
11. Telegram message entities cross IPC as validated UTF-16 ranges. The Teleproto adapter explicitly maps styling, links, mentions, code/preformatted text, spoilers, blockquotes, custom emoji metadata, formatted dates, and diff entities; unknown or invalid ranges remain plain text. Literal composer sends and edits set `parseMode: false`, preventing punctuation from being interpreted as formatting without a formatting control. The BEUI `MessageRichText` primitive builds React nodes without raw HTML, preserves nested formatting, blocks unsafe link protocols, and reveals spoilers with an accessible static state rather than timeline motion. Reply snapshots preserve their entity ranges as well as text.
12. Telegram media is normalized as one media item per message; `groupedId` preserves native album membership. Downloads stay in the main process, publish byte progress/cancel/failure events, and expose completed cache files through the path-confined `telo-media:` protocol, so neither local paths nor large buffers cross IPC.
13. Log out flows through `TelegramLogoutService` to `TelegramClientCoordinator.logout()`: the Teleproto event handlers are removed, the client disconnects, the stored session file is deleted, the workspace falls back to the demo adapter, and the auth state returns to `idle`. In the demo workspace logout is a no-op; resetting the demo workspace is owned by the renderer clearing the `demoWorkspace` preference. The renderer telegram store calls the `telegram:logout` IPC channel and resets its auth state and current user to their initial values.

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

Implementation follows the official Electron security and notification guidance, AI SDK tool/streaming APIs, AG-UI event schema, Teleproto API, Playwright Electron API, Tailwind CSS v4 setup, Phosphor React exports, and the BEUI registry. Links are maintained in [references](references.md).
