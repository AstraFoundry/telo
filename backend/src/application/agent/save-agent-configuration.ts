import type {
  AgentConfigurationDto,
  SaveAgentConfigurationInput,
} from "../../../../contracts/src/ipc";
import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type { AgentConfigurationRepository } from "../../domain/agent/agent-ports";

export class SaveAgentConfigurationService {
  constructor(private readonly repository: AgentConfigurationRepository) {}

  async get(): Promise<AgentConfigurationDto> {
    return toDto(await this.repository.get());
  }

  async execute(
    input: SaveAgentConfigurationInput,
  ): Promise<AgentConfigurationDto> {
    const current = await this.repository.get();
    const currentSnapshot = current.snapshot();
    const configuration = AgentConfiguration.create({
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl ?? null,
      instructions: input.instructions,
      apiKey: input.apiKey?.trim() || currentSnapshot.apiKey,
      canInspectWorkspace: input.canInspectWorkspace,
      temperature: input.temperature,
      maxSteps: input.maxSteps,
      historyLimit: input.historyLimit,
    });
    await this.repository.save(configuration);
    return toDto(configuration);
  }
}

function toDto(configuration: AgentConfiguration): AgentConfigurationDto {
  const value = configuration.snapshot();
  return {
    provider: value.provider,
    model: value.model,
    baseUrl: value.baseUrl,
    instructions: value.instructions,
    hasApiKey: Boolean(value.apiKey),
    canInspectWorkspace: value.canInspectWorkspace,
    temperature: value.temperature,
    maxSteps: value.maxSteps,
    historyLimit: value.historyLimit,
  };
}
