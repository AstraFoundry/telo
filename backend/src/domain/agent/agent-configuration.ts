import {
  AGENT_COMPATIBLE_PROVIDER,
  AGENT_HISTORY_LIMIT_MAX,
  AGENT_HISTORY_LIMIT_MIN,
  AGENT_MAX_STEPS_MAX,
  AGENT_MAX_STEPS_MIN,
  AGENT_PROVIDER_DEFAULT_MODEL,
  AGENT_TEMPERATURE_MAX,
  AGENT_TEMPERATURE_MIN,
  agentProviderSupportsOAuth,
  isAgentProvider,
  type AgentProvider,
} from "../../../../contracts/src/ipc";

export type { AgentProvider };

export interface AgentOAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string | null;
  readonly accountLabel: string | null;
}

export interface AgentConfigurationSnapshot {
  readonly provider: AgentProvider;
  readonly model: string;
  readonly baseUrl: string | null;
  readonly instructions: string;
  readonly apiKey: string | null;
  readonly oauth: AgentOAuthTokens | null;
  readonly canInspectWorkspace: boolean;
  readonly temperature: number;
  readonly maxSteps: number;
  readonly historyLimit: number;
}

export class AgentConfiguration {
  private constructor(private readonly value: AgentConfigurationSnapshot) {}

  static create(input: AgentConfigurationSnapshot): AgentConfiguration {
    if (!isAgentProvider(input.provider)) {
      throw new Error("Unknown agent provider");
    }

    const model = input.model.trim();
    const instructions = input.instructions.trim();
    const apiKey = input.apiKey?.trim() || null;
    const compatible = input.provider === AGENT_COMPATIBLE_PROVIDER;
    // Named providers talk to the vendor endpoint. A leftover compatible URL
    // must not ride along after the user switches accounts.
    const baseUrl = compatible ? input.baseUrl?.trim() || null : null;
    // OAuth tokens are vendor-specific. A leftover session must not
    // authenticate a different vendor after the user switches.
    const oauth = agentProviderSupportsOAuth(input.provider)
      ? normalizeOAuth(input.oauth)
      : null;

    if (!model) throw new Error("Agent model is required");
    if (!instructions) throw new Error("Agent instructions are required");
    if (compatible && !baseUrl) {
      throw new Error(
        "A base URL is required for an OpenAI-compatible provider",
      );
    }
    if (baseUrl && new URL(baseUrl).protocol !== "https:") {
      throw new Error("Agent base URL must use HTTPS");
    }
    assertInRange(
      "temperature",
      input.temperature,
      AGENT_TEMPERATURE_MIN,
      AGENT_TEMPERATURE_MAX,
      false,
    );
    assertInRange(
      "max steps",
      input.maxSteps,
      AGENT_MAX_STEPS_MIN,
      AGENT_MAX_STEPS_MAX,
      true,
    );
    assertInRange(
      "history limit",
      input.historyLimit,
      AGENT_HISTORY_LIMIT_MIN,
      AGENT_HISTORY_LIMIT_MAX,
      true,
    );

    return new AgentConfiguration({
      provider: input.provider,
      model,
      baseUrl,
      instructions,
      apiKey,
      oauth,
      canInspectWorkspace: input.canInspectWorkspace,
      temperature: input.temperature,
      maxSteps: input.maxSteps,
      historyLimit: input.historyLimit,
    });
  }

  static default(): AgentConfiguration {
    return AgentConfiguration.create({
      provider: "openai",
      model: AGENT_PROVIDER_DEFAULT_MODEL.openai,
      baseUrl: null,
      instructions:
        "Answer from the visible Telegram workspace. Ask before acting outside it.",
      apiKey: null,
      oauth: null,
      canInspectWorkspace: true,
      temperature: 0.7,
      maxSteps: 4,
      historyLimit: 20,
    });
  }

  snapshot(): AgentConfigurationSnapshot {
    return { ...this.value };
  }
}

export function agentConfigurationHasCredential(
  snapshot: AgentConfigurationSnapshot,
): boolean {
  return Boolean(snapshot.apiKey || snapshot.oauth?.accessToken);
}

function normalizeOAuth(
  oauth: AgentOAuthTokens | null | undefined,
): AgentOAuthTokens | null {
  const accessToken = oauth?.accessToken.trim() || "";
  if (!accessToken || !oauth) return null;
  const refreshToken = oauth.refreshToken?.trim() || null;
  const accountLabel = oauth.accountLabel?.trim() || null;
  const expiresAt = normalizeExpiry(oauth.expiresAt);
  return { accessToken, refreshToken, expiresAt, accountLabel };
}

function normalizeExpiry(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;
  if (!Number.isFinite(Date.parse(trimmed))) {
    throw new Error("Agent OAuth expiry is invalid");
  }
  return trimmed;
}

function assertInRange(
  field: string,
  value: number,
  min: number,
  max: number,
  whole: boolean,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Agent ${field} must be between ${min} and ${max}`);
  }
  if (whole && !Number.isInteger(value)) {
    throw new Error(`Agent ${field} must be a whole number`);
  }
}
