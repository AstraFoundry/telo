export type AgentProvider = "openai" | "openai-compatible";

export interface AgentConfigurationSnapshot {
  readonly provider: AgentProvider;
  readonly model: string;
  readonly baseUrl: string | null;
  readonly instructions: string;
  readonly apiKey: string | null;
  readonly canInspectWorkspace: boolean;
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

    return new AgentConfiguration({
      provider: input.provider,
      model,
      baseUrl,
      instructions,
      apiKey,
      canInspectWorkspace: input.canInspectWorkspace,
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
    });
  }

  snapshot(): AgentConfigurationSnapshot {
    return { ...this.value };
  }
}
