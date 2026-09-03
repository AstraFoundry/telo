import {
  FIRST_CLASS_AGENT_PROVIDERS,
  type AgentProvider,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";

export const AGENT_PROVIDER_LABEL: Record<AgentProvider, string> = {
  openai: copy.openAi,
  anthropic: copy.anthropic,
  google: copy.google,
  groq: copy.groq,
  xai: copy.xai,
  deepseek: copy.deepseek,
  mistral: copy.mistral,
  "openai-compatible": copy.compatible,
};

/** Words a person types that the visible label does not contain. */
export const AGENT_PROVIDER_KEYWORDS: Record<
  AgentProvider,
  ReadonlyArray<string>
> = {
  openai: ["chatgpt", "gpt"],
  anthropic: ["claude"],
  google: ["gemini", "oauth"],
  groq: ["llama"],
  xai: ["grok"],
  deepseek: [],
  mistral: [],
  "openai-compatible": ["compatible", "custom", "endpoint", "ollama"],
};

export const NAMED_AGENT_PROVIDERS: ReadonlyArray<AgentProvider> = [
  ...FIRST_CLASS_AGENT_PROVIDERS,
];
