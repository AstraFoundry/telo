# Interfaces Layer

The interfaces layer adapts the application layer to the outside world. In Telo the only adapter is **Electron IPC** — there is no HTTP server, CLI, or event-bus consumer. Wire-level conventions live in [`api-conventions.md`](api-conventions.md).

## Layout

`interfaces/electron/` contains the whole adapter:

- **`main.ts`** — Electron main-process entry point. Builds the container, registers IPC handlers, creates the window, and pushes Telegram auth-state events to the renderer.
- **`container.ts`** — composition root. Wires infrastructure implementations into application services.
- **`channels.ts`** — IPC channel names. Private to this layer; the renderer never references raw channel strings.
- **`register-ipc.ts`** — one `ipcMain.handle` registration per capability, plus the AG-UI event stream for agent runs.
- **`preload.ts`** — the `contextBridge` surface exposed as `window.telo`, typed by `TeloDesktopApi` from `contracts/src/ipc.ts`.

## What belongs in `interfaces/`

- **IPC handlers** — receive the invoke payload, call an application service, return its DTO.
- **Preload bridge methods** — the renderer-facing surface of each capability.
- **Event push** — `webContents.send` streams for agent events (AG-UI), Telegram auth state, and typed Telegram workspace updates (new/edited/deleted/read messages plus synchronization failures).
- **Input validation** — validate the shape at the boundary; application and domain code re-validate.

## Rules

- Handlers must be thin. No business logic, no direct persistence access.
- The preload exposes one method per capability — never raw `ipcRenderer` access or arbitrary channel-send capability.
- Do not pass Electron event objects into application services; extract the payload first.
- Everything crossing the bridge uses the DTOs defined in `contracts/src/ipc.ts`.
- Collection reads expose cursor pages through `workspace:list-chat-page` and `workspace:list-message-page`; do not add fixed-limit list channels beside them.
- Event subscriptions return an unsubscribe function.
- Adding a channel requires a contract entry, a preload method, a handler, and a test (see `register-ipc.test.ts`).
- The renderer must never receive an API key, OAuth token, Telegram session, filesystem path, or Electron object.

## Example

```ts
// interfaces/electron/register-ipc.ts
ipcMain.handle(
  channels.messageSend,
  (_event, chatId: string, body: string, input?: SendMessageInput) =>
    container.workspace.sendMessage(chatId, body, input),
);

// interfaces/electron/preload.ts
sendMessage: (chatId, body, input) =>
  ipcRenderer.invoke(channels.messageSend, chatId, body, input),
```

## Error handling

- Expected application/domain errors cross IPC as concise, user-safe messages (see [`api-conventions.md`](api-conventions.md)).
- Unexpected errors are logged in the main process (see [`logging.md`](logging.md)) and reach the renderer as generic failures. Never leak stack traces, secrets, or filesystem paths.
