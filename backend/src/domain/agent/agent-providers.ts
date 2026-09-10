/**
 * BYOA provider vocabulary: ids, OAuth capability, model defaults, and tuning bounds.
 */
/** Inclusive bounds the renderer clamps to and the domain re-validates. */
export const AGENT_TEMPERATURE_MIN = 0;

export const AGENT_TEMPERATURE_MAX = 2;

/** Tool-call rounds one run may take before the model must answer. */
export const AGENT_MAX_STEPS_MIN = 1;

export const AGENT_MAX_STEPS_MAX = 8;

/** Prior thread turns replayed to the model, newest kept. */
export const AGENT_HISTORY_LIMIT_MIN = 0;

export const AGENT_HISTORY_LIMIT_MAX = 50;

/**
 * First-class BYOA providers. OpenAI, Anthropic, Google, xAI, and Kimi
 * authenticate with desktop OAuth when a client is configured; Groq,
 * DeepSeek, and Mistral still use the account key the vendor issues.
 * OpenAI-compatible is the fallback for any other HTTPS endpoint and is
 * listed last.
 */
export const FIRST_CLASS_AGENT_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "groq",
  "xai",
  "kimi",
  "deepseek",
  "mistral",
] as const;

export const AGENT_COMPATIBLE_PROVIDER = "openai-compatible" as const;

export const AGENT_PROVIDERS = [
  ...FIRST_CLASS_AGENT_PROVIDERS,
  AGENT_COMPATIBLE_PROVIDER,
] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

/**
 * Vendors whose Connect-account path is desktop OAuth. Groq, DeepSeek, and
 * Mistral stay on API keys; they do not publish a native OAuth program Telo
 * can run.
 */
export const AGENT_OAUTH_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "kimi",
] as const;

export type AgentOAuthProvider = (typeof AGENT_OAUTH_PROVIDERS)[number];

export type AgentAuthKind = "oauth" | "api-key";

export function agentProviderSupportsOAuth(
  provider: AgentProvider,
): provider is AgentOAuthProvider {
  return (AGENT_OAUTH_PROVIDERS as readonly string[]).includes(provider);
}

/** True when this build can run Connect for `provider`. */
export function agentOAuthIsConfigured(
  configured: ReadonlyArray<AgentOAuthProvider>,
  provider: AgentProvider,
): boolean {
  return agentProviderSupportsOAuth(provider) && configured.includes(provider);
}

/** Model id filled in when the user picks this provider. */
export const AGENT_PROVIDER_DEFAULT_MODEL: Record<AgentProvider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  xai: "grok-3",
  kimi: "kimi-k2.5",
  deepseek: "deepseek-chat",
  mistral: "mistral-small-latest",
  "openai-compatible": "gpt-4.1-mini",
};

export function isAgentProvider(value: string): value is AgentProvider {
  return (AGENT_PROVIDERS as readonly string[]).includes(value);
}
