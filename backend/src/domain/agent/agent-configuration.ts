import {
  AGENT_HISTORY_LIMIT_MAX,
  AGENT_HISTORY_LIMIT_MIN,
  AGENT_MAX_STEPS_MAX,
  AGENT_MAX_STEPS_MIN,
  AGENT_TEMPERATURE_MAX,
  AGENT_TEMPERATURE_MIN,
} from "../../../../contracts/src/ipc";

export type AgentProvider = "openai" | "openai-compatible";

export interface AgentConfigurationSnapshot {
  readonly provider: AgentProvider;
  readonly model: string;
  readonly baseUrl: string | null;
  readonly instructions: string;
  readonly apiKey: string | null;
  readonly canInspectWorkspace: boolean;
  readonly temperature: number;
  readonly maxSteps: number;
  readonly historyLimit: number;
}

export class AgentConfiguration {
  private constructor(private readonly value: AgentConfigurationSnapshot) {}

  static create(input: AgentConfigurationSnapshot): AgentConfiguration {
    const model = input.model.trim();
    const instructions = input.instructions.trim();
    const apiKey = input.apiKey?.trim() || null;
    const baseUrl = input.baseUrl?.trim() || null;

    if (!model) throw new Error("Agent model is required");
    if (!instructions) throw new Error("Agent instructions are required");
    if (input.provider === "openai-compatible" && !baseUrl) {
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
      canInspectWorkspace: input.canInspectWorkspace,
      temperature: input.temperature,
      maxSteps: input.maxSteps,
      historyLimit: input.historyLimit,
    });
  }

  static default(): AgentConfiguration {
    return AgentConfiguration.create({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: null,
      instructions:
        "Answer from the visible Telegram workspace. Ask before acting outside it.",
      apiKey: null,
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
