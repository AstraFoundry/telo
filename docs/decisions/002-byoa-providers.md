# 002: Bring-your-own-account providers

## Status

Accepted.

## Context

Telo's agent previously treated OpenAI (with an optional custom base URL) and a generic OpenAI-compatible endpoint as equals. Mainstream agent products (OpenCode, Cline, Continue) treat named vendor accounts as the primary path and keep OpenAI-compatible as a fallback for everything else.

A second question was whether to adopt a new multi-provider SDK. Telo already streams through the Vercel AI SDK (`ai`). That library is the shared language-model interface those products use: first-class `@ai-sdk/<vendor>` packages for named accounts, and `@ai-sdk/openai-compatible` for other HTTPS endpoints.

Unofficial OAuth against ChatGPT, Claude, or Gemini subscriptions was rejected. Those flows are not a supported vendor API, they would put session tokens in the same class of secrets the renderer is forbidden to see, and they conflict with the existing encrypted API-key store.

## Decision

- **BYOA is the preferred configuration.** The user picks a named provider and pastes the API key from that account. The key stays in the main process; the renderer only ever sees `hasApiKey`.
- **Named providers** are OpenAI, Anthropic, Google, Groq, xAI, DeepSeek, and Mistral, each wired through its official AI SDK package.
- **OpenAI-compatible is the fallback.** It is listed after the named accounts, requires an HTTPS base URL, and uses `@ai-sdk/openai-compatible`.
- **No second SDK.** `streamText` stays the single streaming path. Provider construction is isolated in `createAgentLanguageModel`.

## Consequences

Adding a vendor means an official `@ai-sdk/*` package, a catalog entry, a copy label, and a gateway test. Custom or self-hosted endpoints keep using the compatible fallback instead of a one-off adapter. Unknown stored provider ids are rejected rather than silently remapped.

## Alternatives considered

- **Keep OpenAI plus a free-form base URL.** That hides Anthropic, Google, and the rest behind a compatible dialect they do not speak.
- **LiteLLM or OpenRouter as the only backend.** Extra network hop and a hosted account Telo does not need; users already have vendor accounts.
- **Unofficial subscription OAuth.** Unsupported, ToS-hostile, and a new secret class beside the encrypted API key.

## References

- [AI SDK providers and models](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [AI SDK provider registry](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)
- [OpenCode providers](https://dev.opencode.ai/docs/providers/)
