import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";

import type { AgentConfigurationSnapshot } from "../../domain/agent/agent-configuration";

/**
 * Builds the AI SDK language model for a BYOA snapshot. Named providers use
 * their official packages; the compatible fallback is the last resort.
 */
export function createAgentLanguageModel(
  configuration: AgentConfigurationSnapshot,
): LanguageModel {
  const apiKey = configuration.apiKey;
  if (!apiKey) {
    throw new Error("Add an API key in Agent settings.");
  }

  switch (configuration.provider) {
    case "openai":
      return createOpenAI({ apiKey })(configuration.model);
    case "anthropic":
      return createAnthropic({ apiKey })(configuration.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(configuration.model);
    case "groq":
      return createGroq({ apiKey })(configuration.model);
    case "xai":
      return createXai({ apiKey })(configuration.model);
    case "deepseek":
      return createDeepSeek({ apiKey })(configuration.model);
    case "mistral":
      return createMistral({ apiKey })(configuration.model);
    case "openai-compatible": {
      const baseURL = configuration.baseUrl;
      if (!baseURL) {
        throw new Error(
          "A base URL is required for an OpenAI-compatible provider",
        );
      }
      return createOpenAICompatible({
        name: "openai-compatible",
        apiKey,
        baseURL,
      })(configuration.model);
    }
  }
}
