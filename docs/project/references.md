# Official references

- [MyGo](https://github.com/egoist/mygo) — the native UI toolkit; its `docs/ui` describe views, lists, menus and the headless `ui.Tester`.
- [coss UI](https://coss.com/ui) — the component anatomy Telo's kit follows (`npx skills add cosscom/ui`).
- [Telegram for macOS](https://github.com/TelegramMessenger/telegram-macos) — the client Telo aligns with; see [`../telegram/parity.md`](../telegram/parity.md).
- [TDLib](https://github.com/tdlib/td) and its [JSON interface](https://core.telegram.org/tdlib/docs/td__json__client_8h.html) — the Telegram kernel; see [`../decisions/005-tdlib-client-kernel.md`](../decisions/005-tdlib-client-kernel.md).
- [purego](https://github.com/ebitengine/purego) — calling `libtdjson` without cgo.
- [prebuilt-tdlib](https://github.com/eilvelia/tdl/tree/main/packages/prebuilt-tdlib) — the pinned `libtdjson` builds `make tdlib` stages.
- [Telegram update synchronization](https://core.telegram.org/api/updates)
- [OpenAI chat completions streaming](https://platform.openai.com/docs/api-reference/chat-streaming)
- [Anthropic messages streaming](https://docs.anthropic.com/en/api/messages-streaming)
- [Gemini generateContent](https://ai.google.dev/api/generate-content)
- [Google OAuth 2.0 for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [RFC 7636 PKCE](https://datatracker.ietf.org/doc/html/rfc7636) and [RFC 8628 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
- [Phosphor Icons](https://phosphoricons.com/) — the vendored icon set (`frontend/shared/icons/svg`, MIT).

Research notes and source comparisons are kept in the untracked `.workspace/notes/research.md` file.
