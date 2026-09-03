# IPC conventions

Telo's backend API is Electron IPC, not HTTP. Shared request and response DTOs live in `contracts/src/ipc.ts`; channel names are private to the interfaces adapter.

## Rules

- Preload exposes one method per supported capability rather than raw `ipcRenderer` access.
- Inputs are validated again in application or domain code.
- Errors crossing IPC contain concise user-safe messages and no secret values or stack traces.
- Long-running agent responses return lifecycle and text deltas as AG-UI events.
- Event subscriptions return an unsubscribe function.
- Adding a channel requires a contract, preload method, handler, and test.

The renderer must never receive an API key, OAuth token, Telegram session, filesystem path, Electron object, or arbitrary channel-send capability.
