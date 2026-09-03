# Agent and AG-UI

## Panel

The right-hand Agent panel is the beui `AnimatedSidebar` in right-side offcanvas mode, driven by `entities/agent` as the single source of truth for visibility. `Cmd/Ctrl+B` toggles the panel (a shortcut built into the beui sidebar provider). While closed, the panel is both `aria-hidden` and `inert`.

The panel width comes from a single `AGENT_PANEL_WIDTH` constant in the widget. The reveal runs entirely inside the vendored component: the outer column springs to zero width while the fixed-width inner surface cross-fades on the component's own transition, including the reduced-motion fallback.

While a run is active and the assistant has not streamed any text yet, the transcript shows the beui `AgentActivity` working row — a `ThinkingShimmer` status line with the `copy.activityDefault` label plus the latest `activity` event as an active step. Once response text streams, the response replaces the activity row; the placeholder label is never rendered as message content.

## Configuration

Agent settings live on the dedicated Settings surface. Bring-your-own-account is the preferred path: the user picks a named provider (OpenAI, Anthropic, Google, Groq, xAI, Kimi, DeepSeek, or Mistral). OpenAI, Anthropic, Google, xAI, and Kimi connect through desktop OAuth in the main process when this build has a client for that vendor; the renderer shows Connect account and the account label, never a key. Groq, DeepSeek, and Mistral still store an API key in the main process. OpenAI-compatible HTTPS endpoints are the fallback and are the only case that asks for a base URL. An empty API-key field preserves the stored key. The backend never returns secrets; it returns `hasCredential`, `authKind`, `accountLabel`, and `configuredOAuthProviders`.

The panel resolves one of three states from the configuration loaded at startup: loading (configuration not yet read), not configured (no stored credential — the composer is replaced by a recovery action that opens the Settings surface), and ready (the conversation UI).

The default system instruction limits answers to the visible Telegram workspace. Turning off workspace inspection omits the inspection tool entirely.

Three tuning fields ride the same configuration: `temperature` (0–2, default 0.7) is handed to the provider, `maxSteps` (1–8, default 4) caps the tool-call rounds one run may take, and `historyLimit` (0–50, default 20) bounds how many prior thread turns are replayed — the newest are kept, and 0 replays none. The domain re-validates every bound and rejects out-of-range values by name; a configuration file written before these fields existed reads back with the defaults.

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

Provider failures never surface raw provider payloads: the gateway classifies them into authentication (rejected credentials), network (provider unreachable), or a generic failure, and emits a fixed friendly message with no key material or endpoint URLs. Error rows render as assistant messages without copy or feedback actions; the `error` flag is persisted on the transcript message (domain, `agent-threads.json`, and the IPC DTO), so reloaded threads keep the diagnostic rendering instead of regaining message actions. The renderer still skips an empty assistant shell defensively if one ever arrives.

## Message actions

The bubble context menu offers Translate, Rewrite, and Draft reply (Neutral / Friendly / Formal tone) on any server-persisted message with text. These ride the regular `agent.run` channel with `RunAgentInput.action` set; the backend `RunMessageActionService` rebuilds the prompt from the action and the message body, embedding machine markers (`[[telo-action:*]]`, `[[telo-tone:*]]`, `[[telo-input]]…[[/telo-input]]`, defined in `domain/agent/agent-actions.ts`) and streams without touching any thread. Instead of the transcript event sequence, the main process emits CUSTOM AG-UI events named `message-action`; the chat store's `runMessageAction` listens for the run's duration and writes the text into the composer draft (translate/rewrite replace it, draft reply appends below typed text), so the result never appears in the panel. Every action run ends with a terminal `done` event, and the renderer settles on it rather than on the invoke resolving — the response can overtake queued event messages and would cut the listener off mid-stream. Draft persistence keeps its 500ms debounce, and failures surface inline above the composer. While an action streams, the menu entries are disabled and the running one shows a spinner.

With `TELO_DEMO_WORKSPACE=1` the container swaps `AiSdkAgentGateway` for `DemoAgentGateway`, a deterministic network-free gateway that answers from the markers alone (demo translation/rewrite/reply text, citation lines for summary/extraction, a generic echo otherwise), so e2e and the demo workspace need no API key or provider.

## Chat actions (summary and extraction)

The panel's action row above the composer offers Summarize unread and Extract decisions & todos. Their scope is the open chat's unread tail (everything after `lastReadMessageId` when the boundary is loaded, otherwise the loaded page; media-only messages are dropped), collected renderer-side only to gate the buttons — an empty scope disables them. The runs use dedicated `agent:run-chat-summary` / `agent:run-chat-extraction` IPC channels; the `RunChatSummaryService` / `RunChatExtractionService` use cases delegate to `RunAgentService` with the `[[telo-action:summarize]]` / `[[telo-action:extract]]` marker and an `unread` context scope, so the payload is assembled, redacted, and audited main-side like any scoped run. The transcript shows the action label (`RunAgentInput.promptLabel`), never the machine prompt.

Replies cite source messages with `[[telo-cite:<message id>]]` markers. `entities/agent`'s `parseCitations` strips them from the rendered text into numbered chips; clicking a chip selects the chat when needed and scrolls the message into view via the chat store's `requestJumpToMessage` page-until-found loader. The in-flight run tags its assistant message with the scoped chat id; reloaded threads have no chat, so their chips render disabled with an explanatory tooltip instead of failing silently.

## Context scopes, preview, redaction, and audit

Every `agent.run` carries an explicit `AgentContextScopeInput` (contract): `unread` (the open chat's most recent `unreadCount` incoming messages), `folder` (unread across the active folder's chats, `folderId` null meaning the non-archived main list), or `selected` (explicit message ids — currently the composer's reply target, until multi-select arrives). The main-process `AgentContextService` assembles the payload from the `TelegramRepository` port, page-until-found where needed, so the renderer never decides what the model sees. The panel composer offers the scope picker (Unread by default; Selected disabled with an explanatory tooltip when no reply target exists).

The same service backs the `agent:context-preview` IPC: the panel's Payload preview disclosure lists the exact redacted messages (sender, body, message id) a run would send, and refetches as the workspace changes while the panel is open. Unread scope with no open chat is an empty preview in the renderer — it does not invoke IPC, so the main process never logs `Agent scope "unread" requires a chatId`. Redaction (`domain/agent/agent-redaction.ts`) masks email addresses, phone numbers, and API-key-like tokens in sender names and bodies with per-kind counters — phone candidates need ten digits, or seven with a `+` prefix, so dates and ids survive. The redacted text is both the preview and the payload (WYSIWYS), and `buildScopedPrompt` embeds it ahead of the user prompt using the same `[[telo-input]]` block and `id: <id> | <sender>: <body>` lines as the chat actions, so the demo gateway and citation convention work unchanged. An empty scope sends th…

Each run that sent a payload appends one record to `agent-audit.jsonl` (`FileAgentAuditRepository`, mode 0600): timestamp, action, scope, message ids, redaction counts, model, and the SHA-256 of the exact gateway prompt — never the raw prompt or bodies. The panel's Recent runs disclosure lists the latest records through the `agent:audit-list` IPC.

## Desktop notifications

When a run settles (`RUN_FINISHED` or `RUN_ERROR`), the agent store sends a system notification through `shell.notify` (title `copy.agent`, body `copy.notifyRunCompleteBody`) — but only while the window is unfocused (`document.hidden`) and the `notificationsEnabled` preference is on. The preference is cached in the store when `loadPanelState()` reads preferences at startup; there is no renderer `Notification` API usage, the main process owns delivery.

## Threads

The panel header carries the session-level controls: a history menu (beui `MorphPopover`) listing stored conversations and a new-conversation button. Provider configuration stays on the Settings surface. Both controls are disabled while a run streams, so a thread switch cannot reroute live AG-UI events into another transcript.

Each conversation is a thread with a stable `threadId`. The main process persists transcripts in `agent-threads.json` under Electron's user-data directory, including an active-thread pointer, so the panel restores the last conversation after a restart. `RunAgentService` persists the user message before streaming and the assistant reply (or error) after; it passes the thread's stored history to the gateway, so history never leaks across threads.

`entities/agent` owns the thread list and the current `threadId`. It loads both on panel mount, creates a thread lazily on the first-ever run, and switches or starts threads through typed IPC — switching and creation are persisted by the main process, not just held in the renderer. A thread's title is its first user message (truncated); until then the history menu falls back to `copy.agentNewThread`.
