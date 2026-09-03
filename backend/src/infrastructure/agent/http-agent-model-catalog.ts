import type { AgentProvider } from "../../../../contracts/src/ipc";
import type { AgentOAuthTokens } from "../../domain/agent/agent-configuration";
import type {
  AgentModelCatalog,
  AgentModelCatalogEntry,
} from "../../domain/agent/agent-ports";
import { ANTHROPIC_OAUTH_BETA, KIMI_CODING_BASE_URL } from "./oauth-catalog";
import { chatgptAccountId } from "./oauth-pkce";

export const AGENT_MODELS_UNAVAILABLE = "The model list could not be loaded.";

const ANTHROPIC_VERSION = "2023-06-01";
const MAX_PAGES = 8;
const PAGE_SIZE = 100;

const OPENAI_STYLE_MODELS_URL: Record<
  Exclude<AgentProvider, "anthropic" | "google" | "openai-compatible">,
  string
> = {
  openai: "https://api.openai.com/v1/models",
  groq: "https://api.groq.com/openai/v1/models",
  xai: "https://api.x.ai/v1/models",
  kimi: `${KIMI_CODING_BASE_URL}/models`,
  deepseek: "https://api.deepseek.com/models",
  mistral: "https://api.mistral.ai/v1/models",
};

const NON_CHAT_MODEL =
  /embedding|whisper|tts|dall-e|dalle|realtime|transcribe|moderation|gpt-image|sora/i;

export type AgentModelFetch = (
  url: string,
  init?: { headers?: HeadersInit },
) => Promise<Response>;

/**
 * GET the vendor's model list. Failures become a single user-safe message so
 * response bodies (which can embed keys or endpoint URLs) never leave here.
 */
export class HttpAgentModelCatalog implements AgentModelCatalog {
  constructor(private readonly fetchImpl: AgentModelFetch = fetch) {}

  async list(input: {
    readonly provider: AgentProvider;
    readonly baseUrl: string | null;
    readonly apiKey: string | null;
    readonly oauth: AgentOAuthTokens | null;
  }): Promise<ReadonlyArray<AgentModelCatalogEntry>> {
    try {
      switch (input.provider) {
        case "anthropic":
          return await this.listAnthropic(input);
        case "google":
          return await this.listGoogle(input);
        case "openai-compatible":
          return await this.listOpenAiStyle(
            joinModelsUrl(input.baseUrl ?? ""),
            bearerHeaders(tokenOf(input)),
          );
        default:
          return await this.listOpenAiStyle(
            OPENAI_STYLE_MODELS_URL[input.provider],
            openAiHeaders(input),
          );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === AGENT_MODELS_UNAVAILABLE
      ) {
        throw error;
      }
      throw new Error(AGENT_MODELS_UNAVAILABLE);
    }
  }

  private async listOpenAiStyle(
    url: string,
    headers: HeadersInit,
  ): Promise<AgentModelCatalogEntry[]> {
    const payload = await this.getJson(url, headers);
    return readOpenAiModels(payload).filter(
      (model) => !NON_CHAT_MODEL.test(model.id),
    );
  }

  private async listAnthropic(input: {
    readonly apiKey: string | null;
    readonly oauth: AgentOAuthTokens | null;
  }): Promise<AgentModelCatalogEntry[]> {
    const models: AgentModelCatalogEntry[] = [];
    let afterId: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL("https://api.anthropic.com/v1/models");
      url.searchParams.set("limit", String(PAGE_SIZE));
      if (afterId) url.searchParams.set("after_id", afterId);
      const payload = await this.getJson(url, anthropicHeaders(input));
      const {
        models: pageModels,
        lastId,
        hasMore,
      } = readAnthropicModels(payload);
      models.push(...pageModels);
      if (!hasMore || !lastId) break;
      afterId = lastId;
    }
    return models;
  }

  private async listGoogle(input: {
    readonly apiKey: string | null;
    readonly oauth: AgentOAuthTokens | null;
  }): Promise<AgentModelCatalogEntry[]> {
    const models: AgentModelCatalogEntry[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(
        "https://generativelanguage.googleapis.com/v1beta/models",
      );
      url.searchParams.set("pageSize", String(PAGE_SIZE));
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const accessToken = input.oauth?.accessToken;
      const headers: HeadersInit = accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : {};
      if (!accessToken && input.apiKey) {
        url.searchParams.set("key", input.apiKey);
      }
      const payload = await this.getJson(url, headers);
      const { models: pageModels, nextPageToken } = readGoogleModels(payload);
      models.push(...pageModels);
      if (!nextPageToken) break;
      pageToken = nextPageToken;
    }
    return models;
  }

  private async getJson(
    url: string | URL,
    headers: HeadersInit,
  ): Promise<unknown> {
    const response = await this.fetchImpl(url.toString(), { headers });
    if (response.status === 401 || response.status === 403) {
      throw new Error(AGENT_MODELS_UNAVAILABLE);
    }
    if (!response.ok) {
      throw new Error(AGENT_MODELS_UNAVAILABLE);
    }
    return response.json();
  }
}

function tokenOf(input: {
  readonly apiKey: string | null;
  readonly oauth: AgentOAuthTokens | null;
}): string {
  return input.oauth?.accessToken || input.apiKey || "";
}

function bearerHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function openAiHeaders(input: {
  readonly provider: AgentProvider;
  readonly apiKey: string | null;
  readonly oauth: AgentOAuthTokens | null;
}): HeadersInit {
  const token = tokenOf(input);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (input.provider === "openai" && input.oauth?.accessToken) {
    const accountId = chatgptAccountId(input.oauth.accessToken);
    if (accountId) headers["ChatGPT-Account-ID"] = accountId;
  }
  return headers;
}

function anthropicHeaders(input: {
  readonly apiKey: string | null;
  readonly oauth: AgentOAuthTokens | null;
}): HeadersInit {
  const headers: Record<string, string> = {
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (input.oauth?.accessToken) {
    headers.Authorization = `Bearer ${input.oauth.accessToken}`;
    headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA;
    return headers;
  }
  headers["x-api-key"] = input.apiKey ?? "";
  return headers;
}

function joinModelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/models`;
}

function readOpenAiModels(payload: unknown): AgentModelCatalogEntry[] {
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    throw new Error(AGENT_MODELS_UNAVAILABLE);
  }
  const data = (payload as { data: unknown }).data;
  if (!Array.isArray(data)) throw new Error(AGENT_MODELS_UNAVAILABLE);
  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || !("id" in entry)) return [];
    const id = (entry as { id: unknown }).id;
    return typeof id === "string" && id.trim() ? [{ id: id.trim() }] : [];
  });
}

function readAnthropicModels(payload: unknown): {
  models: AgentModelCatalogEntry[];
  lastId: string | undefined;
  hasMore: boolean;
} {
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    throw new Error(AGENT_MODELS_UNAVAILABLE);
  }
  const data = (payload as { data: unknown }).data;
  if (!Array.isArray(data)) throw new Error(AGENT_MODELS_UNAVAILABLE);
  const models = data.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || !("id" in entry)) return [];
    const id = (entry as { id: unknown }).id;
    if (typeof id !== "string" || !id.trim()) return [];
    const displayName = (entry as { display_name?: unknown }).display_name;
    const label =
      typeof displayName === "string" && displayName.trim()
        ? displayName.trim()
        : undefined;
    return label ? [{ id: id.trim(), label }] : [{ id: id.trim() }];
  });
  const lastId = (payload as { last_id?: unknown }).last_id;
  const hasMore = (payload as { has_more?: unknown }).has_more === true;
  return {
    models,
    lastId:
      typeof lastId === "string" && lastId.trim() ? lastId.trim() : undefined,
    hasMore,
  };
}

function readGoogleModels(payload: unknown): {
  models: AgentModelCatalogEntry[];
  nextPageToken: string | undefined;
} {
  if (!payload || typeof payload !== "object" || !("models" in payload)) {
    throw new Error(AGENT_MODELS_UNAVAILABLE);
  }
  const list = (payload as { models: unknown }).models;
  if (!Array.isArray(list)) throw new Error(AGENT_MODELS_UNAVAILABLE);
  const models = list.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const methods = (entry as { supportedGenerationMethods?: unknown })
      .supportedGenerationMethods;
    if (Array.isArray(methods) && !methods.includes("generateContent")) {
      return [];
    }
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== "string" || !name.trim()) return [];
    const id = name.trim().replace(/^models\//, "");
    const displayName = (entry as { displayName?: unknown }).displayName;
    const label =
      typeof displayName === "string" && displayName.trim()
        ? displayName.trim()
        : undefined;
    return label && label !== id ? [{ id, label }] : [{ id }];
  });
  const nextPageToken = (payload as { nextPageToken?: unknown }).nextPageToken;
  return {
    models,
    nextPageToken:
      typeof nextPageToken === "string" && nextPageToken.trim()
        ? nextPageToken.trim()
        : undefined,
  };
}
