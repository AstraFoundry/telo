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

/**
 * Builds the AI SDK language model for a BYOA snapshot. Named providers use
 * their official packages; the compatible fallback is the last resort.
 * Google OAuth sends a Bearer token and strips the SDK's API-key header.
 */
export function createAgentLanguageModel(
  configuration: AgentConfigurationSnapshot,
): LanguageModel {
  if (!agentConfigurationHasCredential(configuration)) {
    throw new Error("Connect a provider in Agent settings.");
  }

  switch (configuration.provider) {
    case "openai":
      return createOpenAI({ apiKey: configuration.apiKey! })(
        configuration.model,
      );
    case "anthropic":
      return createAnthropic({ apiKey: configuration.apiKey! })(
        configuration.model,
      );
    case "google":
      return createGoogleLanguageModel(configuration);
    case "groq":
      return createGroq({ apiKey: configuration.apiKey! })(configuration.model);
    case "xai":
      return createXai({ apiKey: configuration.apiKey! })(configuration.model);
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

export function googleOAuthFetch(accessToken: string): typeof fetch {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("x-goog-api-key");
    headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(url, { ...init, headers });
  };
}
