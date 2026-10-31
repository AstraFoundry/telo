# 001: Electron IPC boundary

## Status

Superseded by [`006-mygo-native-desktop.md`](006-mygo-native-desktop.md): Telo is one Go process with no renderer or IPC.

## Decision

Run Telegram, AI providers, secrets, and persistence in the Electron main process. Expose a narrow typed API through a sandboxed preload. Stream agent activity as AG-UI events.

## Consequences

The renderer can be treated as untrusted web content and cannot read stored secrets. New capabilities require an explicit contract and IPC handler. Cross-process tests remain necessary.
