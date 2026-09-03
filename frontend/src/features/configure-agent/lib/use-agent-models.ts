import { useEffect, useRef, useState } from "react";

import {
  AGENT_COMPATIBLE_PROVIDER,
  type AgentModelDto,
  type AgentProvider,
} from "../../../../../contracts/src/ipc";

/** Wait for the key/URL to settle so each keystroke does not hit the vendor. */
export const AGENT_MODELS_DEBOUNCE_MS = 400;

export function canListAgentModels(input: {
  readonly provider: AgentProvider;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly storedProvider: AgentProvider | undefined;
  readonly storedHasCredential: boolean;
  readonly storedAuthKind: "oauth" | "api-key" | null | undefined;
  readonly oauthPath: boolean;
}): boolean {
  const compatible = input.provider === AGENT_COMPATIBLE_PROVIDER;
  if (compatible && !input.baseUrl.trim()) return false;
  const storedForProvider =
    input.storedProvider === input.provider && input.storedHasCredential;
  if (input.oauthPath) {
    return storedForProvider && input.storedAuthKind === "oauth";
  }
  return Boolean(input.apiKey.trim()) || storedForProvider;
}

export function useAgentModels(input: {
  readonly provider: AgentProvider;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly canList: boolean;
}): {
  readonly models: ReadonlyArray<AgentModelDto>;
  readonly error: boolean;
} {
  const [models, setModels] = useState<ReadonlyArray<AgentModelDto>>([]);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const compatible = input.provider === AGENT_COMPATIBLE_PROVIDER;

  useEffect(() => {
    if (!input.canList) {
      setModels([]);
      setError(false);
      return;
    }
    const requestId = generation.current + 1;
    generation.current = requestId;
    const timer = window.setTimeout(() => {
      void window.telo.agent
        .listModels({
          provider: input.provider,
          baseUrl: compatible ? input.baseUrl : null,
          apiKey: input.apiKey.trim() || undefined,
        })
        .then((result) => {
          if (generation.current !== requestId) return;
          setModels(result.models);
          setError(false);
        })
        .catch(() => {
          if (generation.current !== requestId) return;
          setModels([]);
          setError(true);
        });
    }, AGENT_MODELS_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      generation.current += 1;
    };
  }, [compatible, input.apiKey, input.baseUrl, input.canList, input.provider]);

  return { models, error };
}
