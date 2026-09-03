import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";

import {
  agentConfigurationHasCredential,
  type AgentConfigurationSnapshot,
} from "../../domain/agent/agent-configuration";
import { ANTHROPIC_OAUTH_BETA, KIMI_CODING_BASE_URL } from "./oauth-catalog";
import { chatgptAccountId } from "./oauth-pkce";

/**
 * Builds the AI SDK language model for a BYOA snapshot. Named providers use
 * their official packages; Kimi uses the coding OpenAI-compatible endpoint;
 * the compatible fallback is the last resort. OAuth sessions send a Bearer
 * token and strip any API-key header the SDK would otherwise attach.
 */
export function createAgentLanguageModel(
  configuration: AgentConfigurationSnapshot,
): LanguageModel {
  if (!agentConfigurationHasCredential(configuration)) {
    throw new Error("Connect a provider in Agent settings.");
  }

  switch (configuration.provider) {
    case "openai":
      return createOpenAiLanguageModel(configuration);
    case "anthropic":
      return createAnthropicLanguageModel(configuration);
    case "google":
      return createGoogleLanguageModel(configuration);
    case "groq":
      return createGroq({ apiKey: configuration.apiKey! })(configuration.model);
    case "xai":
      return createXaiLanguageModel(configuration);
    case "kimi":
      return createKimiLanguageModel(configuration);
    case "deepseek":
      return createDeepSeek({ apiKey: configuration.apiKey! })(
        configuration.model,
      );
    case "mistral":
      return createMistral({ apiKey: configuration.apiKey! })(
        configuration.model,
      );
    case "openai-compatible": {
      const baseURL = configuration.baseUrl;
      if (!baseURL) {
        throw new Error(
          "A base URL is required for an OpenAI-compatible provider",
        );
      }
      return createOpenAICompatible({
        name: "openai-compatible",
        apiKey: configuration.apiKey!,
        baseURL,
      })(configuration.model);
    }
  }
}

function createOpenAiLanguageModel(
  configuration: AgentConfigurationSnapshot,
): LanguageModel {
  const accessToken = configuration.oauth?.accessToken;
  if (accessToken) {
    const accountId = chatgptAccountId(accessToken);
    return createOpenAI({
      apiKey: accessToken,
      headers: accountId ? { "ChatGPT-Account-ID": accountId } : undefined,
    })(configuration.model);
  }
  return createOpenAI({ apiKey: configuration.apiKey! })(configuration.model);
}

function createAnthropicLanguageModel(
  configuration: AgentConfigurationSnapshot,
): LanguageModel {
  const accessToken = configuration.oauth?.accessToken;
  if (accessToken) {
    return createAnthropic({
      apiKey: "oauth",
      fetch: anthropicOAuthFetch(accessToken),
    })(configuration.model);
  }
  return createAnthropic({ apiKey: configuration.apiKey! })(
    configuration.model,
  );
}

function createGoogleLanguageModel(
  configuration: AgentConfigurationSnapshot,
): LanguageModel {
  const accessToken = configuration.oauth?.accessToken;
  if (accessToken) {
    return createGoogleGenerativeAI({
      // Satisfies the SDK's required key slot; the custom fetch removes
      // `x-goog-api-key` and sends the OAuth Bearer token instead.
      apiKey: "oauth",
      fetch: googleOAuthFetch(accessToken),
    })(configuration.model);
  }
  return createGoogleGenerativeAI({ apiKey: configuration.apiKey! })(
    configuration.model,
  );
}

function createXaiLanguageModel(
  configuration: AgentConfigurationSnapshot,
): LanguageModel {
  const accessToken = configuration.oauth?.accessToken;
  if (accessToken) {
    return createXai({ apiKey: accessToken })(configuration.model);
  }
  return createXai({ apiKey: configuration.apiKey! })(configuration.model);
}

function createKimiLanguageModel(
  configuration: AgentConfigurationSnapshot,
): LanguageModel {
  const apiKey = configuration.oauth?.accessToken ?? configuration.apiKey!;
  return createOpenAICompatible({
    name: "kimi",
    apiKey,
    baseURL: KIMI_CODING_BASE_URL,
  })(configuration.model);
}

export function googleOAuthFetch(accessToken: string): typeof fetch {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("x-goog-api-key");
    headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(url, { ...init, headers });
  };
}

export function anthropicOAuthFetch(accessToken: string): typeof fetch {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("x-api-key");
    headers.set("Authorization", `Bearer ${accessToken}`);
    const existing = headers.get("anthropic-beta");
    const betas = new Set(
      (existing ? existing.split(",") : [])
        .map((value) => value.trim())
        .filter(Boolean),
    );
    betas.add(ANTHROPIC_OAUTH_BETA);
    headers.set("anthropic-beta", [...betas].join(","));
    return fetch(url, { ...init, headers });
  };
}
