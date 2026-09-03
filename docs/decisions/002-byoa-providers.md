# 002: Bring-your-own-account providers

## Status

Accepted.

## Context

Telo's agent previously treated OpenAI (with an optional custom base URL) and a generic OpenAI-compatible endpoint as equals. Mainstream agent products (OpenCode, Cline, Continue) treat named vendor accounts as the primary path and keep OpenAI-compatible as a fallback for everything else.

A second question was whether to adopt a new multi-provider SDK. Telo already streams through the Vercel AI SDK (`ai`). That library is the shared language-model interface those products use: first-class `@ai-sdk/<vendor>` packages for named accounts, and `@ai-sdk/openai-compatible` for other HTTPS endpoints.

A third question was how the user authenticates. "Bring your own account" means signing into the vendor, not pasting a password-shaped key, when the vendor actually offers a third-party desktop OAuth program. ChatGPT Plus / Claude Pro OAuth is licensed only to those vendors' own apps (Codex, Claude Code, claude.ai). Copying those client ids is a ToS violation. Google publishes an installed-app OAuth program for the Gemini API (PKCE, loopback `127.0.0.1`, public client). Groq, xAI, DeepSeek, Mistral, and OpenAI's platform API issue keys only.

## Decision

- **BYOA is the preferred configuration.** The user picks a named provider. When that vendor offers third-party desktop OAuth, Connect account is the path and the renderer never sees a key field.
- **Google authenticates with OAuth.** The main process runs authorization-code + PKCE on a loopback listener, stores encrypted tokens in `agent.json`, refreshes them before a run, and sends `Authorization: Bearer` to Gemini. The renderer sees `accountLabel` (the email) and `hasCredential`, never the tokens. A Google Cloud **Desktop** OAuth client id is injected at build time as `TELO_GOOGLE_OAUTH_CLIENT_ID`, the same way Telegram credentials are injected. Playwright uses a fixture client (`TELO_E2E=1`) so the journey does not open a browser.
- **Vendors without a third-party OAuth program still use an API key.** That is the credential those vendors issue to third-party apps. The key stays in the main process; the renderer only ever sees `hasCredential`.
- **Named providers** are OpenAI, Anthropic, Google, Groq, xAI, DeepSeek, and Mistral, each wired through its official AI SDK package.
- **OpenAI-compatible is the fallback.** It is listed after the named accounts, requires an HTTPS base URL, and uses `@ai-sdk/openai-compatible`.
- **No second SDK.** `streamText` stays the single streaming path. Provider construction is isolated in `createAgentLanguageModel`.
- **No unofficial subscription OAuth.** Telo does not embed Claude Code or Codex client ids, and does not scrape ChatGPT / Claude / Gemini web sessions.

## Consequences

Adding a vendor means an official `@ai-sdk/*` package, a catalog entry, a copy label, and a gateway test. A vendor that later publishes desktop OAuth joins `AGENT_OAUTH_PROVIDERS` and gets a main-process client; the Settings form already hides the key field when `oauthClientConfigured` is true. Custom or self-hosted endpoints keep using the compatible fallback. Unknown stored provider ids are rejected rather than silently remapped.

A build without `TELO_GOOGLE_OAUTH_CLIENT_ID` still offers Google through an API key, matching a build without Telegram credentials that cannot sign in to Telegram.

## Alternatives considered

- **Keep OpenAI plus a free-form base URL.** That hides Anthropic, Google, and the rest behind a compatible dialect they do not speak.
- **LiteLLM or OpenRouter as the only backend.** Extra network hop and a hosted account Telo does not need; users already have vendor accounts.
- **Unofficial ChatGPT / Claude subscription OAuth.** Unsupported and ToS-hostile. Anthropic has already required other products to unbundle that plugin.
- **API keys for every named provider, including Google.** That ignores the one mainstream vendor that documents desktop OAuth for third-party apps.

## References

- [AI SDK providers and models](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [AI SDK provider registry](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)
- [Google OAuth 2.0 for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Gemini API OAuth](https://ai.google.dev/gemini-api/docs/oauth)
- [OpenCode providers](https://dev.opencode.ai/docs/providers/)
