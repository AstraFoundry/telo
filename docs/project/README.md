# Project

Telo is a desktop Telegram workspace for people who want an assistant beside the conversation they are reading. It wraps a React renderer in Electron and keeps Telegram and AI credentials in the desktop process.

## Product boundaries

- Telo is an independent third-party client and is not affiliated with Telegram.
- The renderer never receives a stored API key, OAuth token, or Telegram session string.
- The agent can inspect only the context snapshot registered by the renderer.
- Telo does not execute agent-proposed actions or mutate Telegram data beyond an explicit user send.

See [architecture](architecture.md) and [agent integration](agent.md).
