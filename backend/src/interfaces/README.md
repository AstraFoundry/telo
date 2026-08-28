# interfaces

This layer adapts the application layer to the outside world. In Telo the only adapter is **Electron IPC** — there is no HTTP server, CLI, or event-bus consumer.

## What goes here

`electron/` contains the whole adapter:

- `main.ts` — Electron main-process entry point. Builds the container, registers IPC handlers, creates the window, and pushes Telegram auth-state events to the renderer.
- `container.ts` — composition root. Wires infrastructure implementations into application services.
- `channels.ts` — IPC channel names. Private to this layer; the renderer never references raw channel strings.
- `register-ipc.ts` — one `ipcMain.handle` registration per capability, plus the AG-UI event stream for agent runs.
- `preload.ts` — the `contextBridge` surface exposed as `window.telo`, typed by `TeloDesktopApi` from `contracts/src/ipc.ts`.

## Rules

- Handlers are thin: receive the invoke payload, call an application service, return its DTO.
- No business logic, no direct persistence access.
- Do not pass Electron event objects into application services; extract the payload first.
- Everything crossing the bridge uses the DTOs defined in `contracts/src/ipc.ts`.
- Event subscriptions return an unsubscribe function.
- The preload exposes one method per capability — never raw `ipcRenderer` access.
- The renderer must never receive an API key, Telegram session, filesystem path, or Electron object.
- Adding a channel requires a contract entry, a preload method, a handler, and a test (see `register-ipc.test.ts`).

## Example

```ts
// interfaces/electron/register-ipc.ts
ipcMain.handle(channels.preferencesGet, () => container.preferences.get());
```
