import {
  AGENT_COMPATIBLE_PROVIDER,
  isAgentProvider,
  type ListAgentModelsInput,
  type AgentModelListDto,
} from "../../../../contracts/src/ipc";
import type {
  AgentConfigurationRepository,
  AgentModelCatalog,
  AgentModelCatalogEntry,
} from "../../domain/agent/agent-ports";

export const AGENT_MODELS_NEED_CREDENTIAL =
  "Connect a provider or enter an API key to list models.";

export class ListAgentModelsService {
  constructor(
    private readonly repository: AgentConfigurationRepository,
    private readonly catalog: AgentModelCatalog,
  ) {}

  async execute(input: ListAgentModelsInput): Promise<AgentModelListDto> {
    if (!isAgentProvider(input.provider)) {
      throw new Error("Unknown agent provider");
    }
    const stored = (await this.repository.get()).snapshot();
    const typedKey = input.apiKey?.trim() || "";
    const sameProvider = stored.provider === input.provider;
    const apiKey = typedKey || (sameProvider ? stored.apiKey : null);
    const oauth = typedKey || !sameProvider ? null : stored.oauth;
    const compatible = input.provider === AGENT_COMPATIBLE_PROVIDER;
    const baseUrl = compatible
      ? input.baseUrl?.trim() || (sameProvider ? stored.baseUrl : null)
      : null;

    if (compatible) {
      assertHttpsBaseUrl(baseUrl);
    }
    if (!apiKey && !oauth?.accessToken) {
      throw new Error(AGENT_MODELS_NEED_CREDENTIAL);
    }

    const models = await this.catalog.list({
      provider: input.provider,
      baseUrl,
      apiKey,
      oauth,
    });
    return { models: uniqueModels(models) };
  }
}

function assertHttpsBaseUrl(baseUrl: string | null): void {
  if (!baseUrl) {
    throw new Error("A base URL is required for an OpenAI-compatible provider");
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Agent base URL must use HTTPS");
  }
  if (url.protocol !== "https:") {
    throw new Error("Agent base URL must use HTTPS");
  }
}

function uniqueModels(
  models: ReadonlyArray<AgentModelCatalogEntry>,
): AgentModelCatalogEntry[] {
  const seen = new Set<string>();
  const unique: AgentModelCatalogEntry[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = model.label?.trim();
    unique.push(label && label !== id ? { id, label } : { id });
  }
  return unique;
}
