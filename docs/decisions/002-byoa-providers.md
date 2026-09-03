# 002: Bring-your-own-account providers

## Status

Accepted.

## Context

Telo's agent previously treated OpenAI (with an optional custom base URL) and a generic OpenAI-compatible endpoint as equals. Mainstream agent products (OpenCode, Cline, Continue) treat named vendor accounts as the primary path and keep OpenAI-compatible as a fallback for everything else.

A second question was whether to adopt a new multi-provider SDK. Telo already streams through the Vercel AI SDK (`ai`). That library is the shared language-model interface those products use: first-class `@ai-sdk/<vendor>` packages for named accounts, and `@ai-sdk/openai-compatible` for other HTTPS endpoints.

A third question was how the user authenticates. "Bring your own account" means signing into the vendor. Google publishes an installed-app OAuth program for the Gemini API. OpenAI, Anthropic, xAI, and Moonshot (Kimi) ship public native/CLI OAuth clients in their own desktop apps; those are the Connect paths those vendors actually run. Groq, DeepSeek, and Mistral issue API keys only.

## Decision

- **BYOA is the preferred configuration.** The user picks a named provider. When that vendor is on `AGENT_OAUTH_PROVIDERS` and this build has a client id, Connect account is the path and the renderer never sees a key field.
- **OAuth vendors** are OpenAI, Anthropic, Google, xAI, and Kimi. The main process runs the vendor's grant (authorization-code + PKCE loopback, or RFC 8628 device code), stores encrypted tokens in `agent.json`, refreshes them before a run, and sends `Authorization: Bearer`. The renderer sees `configuredOAuthProviders`, `accountLabel`, and `hasCredential`, never the tokens. Playwright uses a fixture client (`TELO_E2E=1`) so Connect does not open a browser.
- **Google** uses a Telo-registered Desktop client injected as `TELO_GOOGLE_OAUTH_CLIENT_ID`. A build without that id still offers Google through an API key.
- **OpenAI, Anthropic, xAI, and Kimi** use the public native client id each vendor ships in its own CLI, overridable with `TELO_<VENDOR>_OAUTH_CLIENT_ID`. Telo identifies itself as `telo` (originator, `X-Msh-Platform`) rather than impersonating the vendor CLI's user agent.
- **Groq, DeepSeek, and Mistral still use an API key.** That is the credential those vendors issue to third-party apps. The key stays in the main process; the renderer only ever sees `hasCredential`.
- **Named providers** are OpenAI, Anthropic, Google, Groq, xAI, Kimi, DeepSeek, and Mistral. Kimi talks to `https://api.kimi.com/coding/v1` through `@ai-sdk/openai-compatible`; the others use their official AI SDK packages.
- **OpenAI-compatible is the fallback.** It is listed after the named accounts, requires an HTTPS base URL, and uses `@ai-sdk/openai-compatible`.
- **No second SDK.** `streamText` stays the single streaming path. Provider construction is isolated in `createAgentLanguageModel`.
- **No session scraping.** Telo does not copy cookies or scrape ChatGPT / Claude / Gemini / Kimi web sessions.

## Consequences

Adding a vendor means a catalog entry, a copy label, a gateway test, and — when the vendor has desktop OAuth — a profile in `AGENT_OAUTH_PROFILE`. The Settings form hides the key field when `configuredOAuthProviders` includes the selected provider. Custom or self-hosted endpoints keep using the compatible fallback. Unknown stored provider ids are rejected rather than silently remapped.

Once a credential exists for the selected vendor, Settings lists models through `agent:list-models`. The main process GETs the vendor's `/models` (or Google `v1beta/models`) endpoint with the stored or typed secret and returns `{ id, label? }[]`. The renderer never sees the credential. A failed fetch leaves the current model id editable and does not substitute a hardcoded catalog. Playwright uses `FixtureAgentModelCatalog` (`TELO_E2E=1`) so the list path does not call a real vendor.

Google OAuth and Telegram credentials remain build-injected secrets. The other OAuth clients are public native ids, so Connect works in a local build without extra registration.

## Alternatives considered

- **Keep OpenAI plus a free-form base URL.** That hides Anthropic, Google, and the rest behind a compatible dialect they do not speak.
- **LiteLLM or OpenRouter as the only backend.** Extra network hop and a hosted account Telo does not need; users already have vendor accounts.
- **API keys for every named provider.** That ignores the vendors that actually run a desktop OAuth program.
- **Require a Telo-registered client for every vendor.** OpenAI, Anthropic, xAI, and Moonshot do not offer a third-party desktop registration portal that mints tokens for their coding APIs. Their public native clients are the working Connect path.

## References

- [AI SDK providers and models](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [AI SDK provider registry](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)
- [Google OAuth 2.0 for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Gemini API OAuth](https://ai.google.dev/gemini-api/docs/oauth)
- [RFC 8628 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
- [Kimi CLI OAuth](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/auth/oauth.py)
- [OpenCode providers](https://dev.opencode.ai/docs/providers/)
