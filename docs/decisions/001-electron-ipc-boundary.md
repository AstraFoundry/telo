# 001: Electron IPC boundary

## Status

Accepted.

## Decision

Run Telegram, AI providers, secrets, and persistence in the Electron main process. Expose a narrow typed API through a sandboxed preload. Stream agent activity as AG-UI events.

## Consequences

The renderer can be treated as untrusted web content and cannot read stored secrets. New capabilities require an explicit contract and IPC handler. Cross-process tests remain necessary.
