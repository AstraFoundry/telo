import type {
  ConnectAgentAccountInput,
  SaveAgentConfigurationInput,
} from "../../../../contracts/src/ipc";
import { AGENT_PROVIDER_DEFAULT_MODEL } from "../../../../contracts/src/ipc";
import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type {
  AgentConfigurationRepository,
  AgentOAuthClient,
} from "../../domain/agent/agent-ports";

import { toAgentConfigurationDto } from "./agent-configuration-dto";

export class SaveAgentConfigurationService {
  constructor(
    private readonly repository: AgentConfigurationRepository,
    private readonly oauth: AgentOAuthClient,
  ) {}

  async get() {
    return toAgentConfigurationDto(
      await this.repository.get(),
      this.oauth.configuredProviders(),
    );
  }

  async execute(input: SaveAgentConfigurationInput) {
    const current = (await this.repository.get()).snapshot();
    const providerChanged = input.provider !== current.provider;
    const nextKey = input.apiKey?.trim() || "";
    const configuration = AgentConfiguration.create({
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl ?? null,
      instructions: input.instructions,
      apiKey: nextKey || (providerChanged ? null : current.apiKey),
      // A newly typed key replaces OAuth. Switching providers drops the
      // previous vendor's session rather than reusing it.
      oauth: nextKey || providerChanged ? null : current.oauth,
      canInspectWorkspace: input.canInspectWorkspace,
      temperature: input.temperature,
      maxSteps: input.maxSteps,
      historyLimit: input.historyLimit,
    });
    await this.repository.save(configuration);
    return toAgentConfigurationDto(
      configuration,
      this.oauth.configuredProviders(),
    );
  }

  async connect(input: ConnectAgentAccountInput) {
    if (!this.oauth.supports(input.provider)) {
      throw new Error("OAuth is not available for this provider");
    }
    if (!this.oauth.isConfigured(input.provider)) {
      throw new Error(
        "This build is missing an OAuth client for this provider.",
      );
    }
    const session = await this.oauth.authorize(input.provider);
    const configuration = AgentConfiguration.create({
      provider: input.provider,
      model: input.model.trim() || AGENT_PROVIDER_DEFAULT_MODEL[input.provider],
      baseUrl: input.baseUrl ?? null,
      instructions: input.instructions,
      apiKey: null,
      oauth: session,
      canInspectWorkspace: input.canInspectWorkspace,
      temperature: input.temperature,
      maxSteps: input.maxSteps,
      historyLimit: input.historyLimit,
    });
    await this.repository.save(configuration);
    return toAgentConfigurationDto(
      configuration,
      this.oauth.configuredProviders(),
    );
  }

  async disconnect(input: ConnectAgentAccountInput) {
    const configuration = AgentConfiguration.create({
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl ?? null,
      instructions: input.instructions,
      apiKey: null,
      oauth: null,
      canInspectWorkspace: input.canInspectWorkspace,
      temperature: input.temperature,
      maxSteps: input.maxSteps,
      historyLimit: input.historyLimit,
    });
    await this.repository.save(configuration);
    return toAgentConfigurationDto(
      configuration,
      this.oauth.configuredProviders(),
    );
  }
}
