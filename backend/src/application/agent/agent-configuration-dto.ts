import type {
  AgentAuthKind,
  AgentConfigurationDto,
} from "../../../../contracts/src/ipc";
import {
  AgentConfiguration,
  agentConfigurationHasCredential,
} from "../../domain/agent/agent-configuration";

export function toAgentConfigurationDto(
  configuration: AgentConfiguration,
  oauthClientConfigured: boolean,
): AgentConfigurationDto {
  const value = configuration.snapshot();
  const hasCredential = agentConfigurationHasCredential(value);
  const authKind: AgentAuthKind | null = value.oauth?.accessToken
    ? "oauth"
    : value.apiKey
      ? "api-key"
      : null;
  return {
    provider: value.provider,
    model: value.model,
    baseUrl: value.baseUrl,
    instructions: value.instructions,
    hasCredential,
    authKind,
    accountLabel: value.oauth?.accountLabel ?? null,
    oauthClientConfigured,
    canInspectWorkspace: value.canInspectWorkspace,
    temperature: value.temperature,
    maxSteps: value.maxSteps,
    historyLimit: value.historyLimit,
  };
}
