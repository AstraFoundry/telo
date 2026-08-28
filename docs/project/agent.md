# Agent and AG-UI

## Panel

The right-hand Agent panel is the beui `AnimatedSidebar` in right-side offcanvas mode, driven by `entities/agent` as the single source of truth for visibility. `Cmd/Ctrl+B` toggles the panel (a shortcut built into the beui sidebar provider). While closed, the panel is both `aria-hidden` and `inert`.

The panel width comes from a single `AGENT_PANEL_WIDTH` constant in the widget. The reveal runs entirely inside the vendored component: the outer column springs to zero width while the fixed-width inner surface cross-fades on the component's own transition, including the reduced-motion fallback.

While a run is active and the assistant has not streamed any text yet, the transcript shows the beui `AgentActivity` working row — a `ThinkingShimmer` status line with the `copy.activityDefault` label plus the latest `activity` event as an active step. Once response text streams, the response replaces the activity row; the placeholder label is never rendered as message content.

## Configuration

Agent settings live on the dedicated Settings surface. Telo supports OpenAI and HTTPS OpenAI-compatible endpoints. An empty API-key field preserves the stored key. The backend never returns the key; it returns only `hasApiKey`.

The panel resolves one of three states from the configuration loaded at startup: loading (configuration not yet read), not configured (no API key — the composer is replaced by a recovery action that opens the Settings surface), and ready (the conversation UI).

The default system instruction limits answers to the visible Telegram workspace. Turning off workspace inspection omits the inspection tool entirely.

## Frontend component context

The renderer registers these stable component IDs:

| ID                     | Role                 | State                         |
| ---------------------- | -------------------- | ----------------------------- |
| `conversation-sidebar` | `chat-navigation`    | Visible chat count            |
| `conversation-view`    | `message-transcript` | Active chat and message count |
| `global-agent-panel`   | `assistant`          | Visibility                    |

Adding a context-aware widget requires a stable ID, semantic role, JSON-safe state, contract coverage, and a test that verifies no secret enters the snapshot.

## AG-UI events

Each run emits `RUN_STARTED`, `STATE_SNAPSHOT`, then — only once response text actually streams — `TEXT_MESSAGE_START`, zero or more `TEXT_MESSAGE_CONTENT` events, and `TEXT_MESSAGE_END`, followed by `RUN_FINISHED`. Activity uses a `CUSTOM` event named `activity` and may precede the message sequence. Provider failures use `RUN_ERROR` instead of `RUN_FINISHED`; a run that fails (or ends) without text never emits a `TEXT_MESSAGE_*` sequence, so no empty assistant shell is minted.

Provider failures never surface raw provider payloads: the gateway classifies them into authentication (rejected API key), network (provider unreachable), or a generic failure, and emits a fixed friendly message with no key material or endpoint URLs. Error rows render as assistant messages without copy or feedback actions; the `error` flag is persisted on the transcript message (domain, `agent-threads.json`, and the IPC DTO), so reloaded threads keep the diagnostic rendering instead of regaining message actions. The renderer still skips an empty assistant shell defensively if one ever arrives.

## Desktop notifications

When a run settles (`RUN_FINISHED` or `RUN_ERROR`), the agent store sends a system notification through `shell.notify` (title `copy.agent`, body `copy.notifyRunCompleteBody`) — but only while the window is unfocused (`document.hidden`) and the `notificationsEnabled` preference is on. The preference is cached in the store when `loadPanelState()` reads preferences at startup; there is no renderer `Notification` API usage, the main process owns delivery.

## Threads

The panel header carries the session-level controls: a history menu (beui `MorphPopover`) listing stored conversations and a new-conversation button. Provider configuration stays on the Settings surface. Both controls are disabled while a run streams, so a thread switch cannot reroute live AG-UI events into another transcript.

Each conversation is a thread with a stable `threadId`. The main process persists transcripts in `agent-threads.json` under Electron's user-data directory, including an active-thread pointer, so the panel restores the last conversation after a restart. `RunAgentService` persists the user message before streaming and the assistant reply (or error) after; it passes the thread's stored history to the gateway, so history never leaks across threads.

`entities/agent` owns the thread list and the current `threadId`. It loads both on panel mount, creates a thread lazily on the first-ever run, and switches or starts threads through typed IPC — switching and creation are persisted by the main process, not just held in the renderer. A thread's title is its first user message (truncated); until then the history menu falls back to `copy.agentNewThread`.
