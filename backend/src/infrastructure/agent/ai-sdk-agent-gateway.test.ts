import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UiContextSnapshot } from "../../../../contracts/src/ipc";
import {
  AgentConfiguration,
  type AgentConfigurationSnapshot,
} from "../../domain/agent/agent-configuration";
import type { AgentOutput } from "../../domain/agent/agent-ports";
import { AiSdkAgentGateway } from "./ai-sdk-agent-gateway";

const ai = vi.hoisted(() => {
  const languageModel = (provider: string) => () => (model: string) => ({
    provider,
    model,
  });
  return {
    streamText: vi.fn(),
    createOpenAI: vi.fn(languageModel("openai")),
    createAnthropic: vi.fn(languageModel("anthropic")),
    createGoogleGenerativeAI: vi.fn(languageModel("google")),
    createGroq: vi.fn(languageModel("groq")),
    createXai: vi.fn(languageModel("xai")),
    createDeepSeek: vi.fn(languageModel("deepseek")),
    createMistral: vi.fn(languageModel("mistral")),
    createOpenAICompatible: vi.fn(languageModel("openai-compatible")),
    isStepCount: vi.fn(() => () => true),
  };
});

vi.mock("ai", () => ({
  streamText: ai.streamText,
  tool: (config: unknown): unknown => config,
  isStepCount: ai.isStepCount,
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: ai.createOpenAI }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: ai.createAnthropic }));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: ai.createGoogleGenerativeAI,
}));
vi.mock("@ai-sdk/groq", () => ({ createGroq: ai.createGroq }));
vi.mock("@ai-sdk/xai", () => ({ createXai: ai.createXai }));
vi.mock("@ai-sdk/deepseek", () => ({ createDeepSeek: ai.createDeepSeek }));
vi.mock("@ai-sdk/mistral", () => ({ createMistral: ai.createMistral }));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: ai.createOpenAICompatible,
}));

interface InspectWorkspaceTool {
  execute: (input: { section: string }) => Promise<unknown>;
}

interface StreamTextArgs {
  messages: Array<{ role: string; content: string }>;
  instructions: string;
  temperature: number;
  tools?: Record<string, InspectWorkspaceTool>;
}

const context: UiContextSnapshot = {
  activeChat: { id: "chat", title: "Telo Design", kind: "group" },
  visibleChats: [{ id: "chat", title: "Telo Design", unreadCount: 3 }],
  visibleMessages: [
    {
      senderName: "Mina",
      body: "Ship it",
      sentAt: "2026-08-27T14:12:00.000Z",
      outgoing: false,
    },
  ],
  components: [{ id: "composer", role: "input", state: { focused: true } }],
};

function configuration(
  overrides: Partial<AgentConfigurationSnapshot> = {},
): AgentConfiguration {
  return AgentConfiguration.create({
    provider: "openai",
    model: "gpt-4.1-mini",
    baseUrl: null,
    instructions: "Be brief.",
    apiKey: "sk-test",
    oauth: null,
    canInspectWorkspace: true,
    temperature: 0.7,
    maxSteps: 4,
    historyLimit: 20,
    ...overrides,
  });
}

interface StreamPart {
  type: string;
  id?: string;
  text?: string;
  error?: unknown;
}

function emptyStream(): { fullStream: AsyncGenerator<StreamPart> } {
  return {
    fullStream: (async function* (): AsyncGenerator<StreamPart> {
      // No parts.
    })(),
  };
}

async function collect(
  config: AgentConfiguration,
  history: Array<{ role: "user" | "assistant"; body: string }> = [],
): Promise<AgentOutput[]> {
  const gateway = new AiSdkAgentGateway();
  const outputs: AgentOutput[] = [];
  for await (const output of gateway.stream({
    prompt: "Summarize",
    history,
    context,
    configuration: config,
  })) {
    outputs.push(output);
  }
  return outputs;
}

describe("AiSdkAgentGateway", () => {
  beforeEach(() => {
    ai.streamText.mockReset();
    ai.createOpenAI.mockClear();
    ai.createAnthropic.mockClear();
    ai.createGoogleGenerativeAI.mockClear();
    ai.createGroq.mockClear();
    ai.createXai.mockClear();
    ai.createDeepSeek.mockClear();
    ai.createMistral.mockClear();
    ai.createOpenAICompatible.mockClear();
    ai.isStepCount.mockClear();
  });

  it("requires a stored credential before contacting the provider", async () => {
    const outputs = await collect(configuration({ apiKey: null }));

    expect(outputs).toEqual([
      { type: "error", message: "Connect a provider in Agent settings." },
    ]);
    expect(ai.createOpenAI).not.toHaveBeenCalled();
    expect(ai.streamText).not.toHaveBeenCalled();
  });

  it("streams provider text deltas after announcing the activity", async () => {
    ai.streamText.mockReturnValue({
      fullStream: (async function* (): AsyncGenerator<StreamPart> {
        yield { type: "text-delta", id: "1", text: "Hel" };
        yield { type: "text-delta", id: "1", text: "lo" };
      })(),
    });

    const outputs = await collect(configuration());

    expect(outputs).toEqual([
      { type: "activity", label: "Reading workspace" },
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
    ]);
    expect(ai.createOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-test",
    });
    const args = ai.streamText.mock.calls[0]?.[0] as StreamTextArgs;
    expect(args.messages).toEqual([{ role: "user", content: "Summarize" }]);
    expect(args.instructions).toBe("Be brief.");
    expect(args.tools).toBeDefined();
  });

  it("prepends the thread history ahead of the new prompt", async () => {
    ai.streamText.mockReturnValue(emptyStream());

    await collect(configuration(), [
      { role: "user", body: "Earlier question" },
      { role: "assistant", body: "Earlier answer" },
    ]);

    const args = ai.streamText.mock.calls[0]?.[0] as StreamTextArgs;
    expect(args.messages).toEqual([
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Summarize" },
    ]);
  });

  it("passes the configured temperature and step count to the provider", async () => {
    ai.streamText.mockReturnValue(emptyStream());

    await collect(configuration({ temperature: 1.4, maxSteps: 7 }));

    const args = ai.streamText.mock.calls[0]?.[0] as StreamTextArgs;
    expect(args.temperature).toBe(1.4);
    expect(ai.isStepCount).toHaveBeenCalledWith(7);
  });

  it("replays only the newest history entries within the limit", async () => {
    ai.streamText.mockReturnValue(emptyStream());

    await collect(configuration({ historyLimit: 2 }), [
      { role: "user", body: "Oldest" },
      { role: "assistant", body: "Middle" },
      { role: "user", body: "Newest" },
    ]);

    const args = ai.streamText.mock.calls[0]?.[0] as StreamTextArgs;
    expect(args.messages).toEqual([
      { role: "assistant", content: "Middle" },
      { role: "user", content: "Newest" },
      { role: "user", content: "Summarize" },
    ]);
  });

  it("replays no prior turns when the history limit is zero", async () => {
    ai.streamText.mockReturnValue(emptyStream());

    await collect(configuration({ historyLimit: 0 }), [
      { role: "user", body: "Earlier question" },
      { role: "assistant", body: "Earlier answer" },
    ]);

    const args = ai.streamText.mock.calls[0]?.[0] as StreamTextArgs;
    expect(args.messages).toEqual([{ role: "user", content: "Summarize" }]);
  });

  it("uses Google OAuth Bearer tokens instead of an API key", async () => {
    ai.streamText.mockReturnValue(emptyStream());

    await collect(
      configuration({
        provider: "google",
        model: "gemini-2.5-flash",
        apiKey: null,
        oauth: {
          accessToken: "ya29.access",
          refreshToken: "1//refresh",
          expiresAt: "2026-09-03T12:00:00.000Z",
          accountLabel: "mina@example.com",
        },
      }),
    );

    expect(ai.createGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: "oauth",
      fetch: expect.any(Function),
    });
    expect(ai.createOpenAI).not.toHaveBeenCalled();
  });

  it("uses the Anthropic SDK for an Anthropic account", async () => {
    ai.streamText.mockReturnValue(emptyStream());

    await collect(
      configuration({ provider: "anthropic", model: "claude-sonnet-4-5" }),
    );

    expect(ai.createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-test" });
    expect(ai.createOpenAI).not.toHaveBeenCalled();
    expect(ai.createOpenAICompatible).not.toHaveBeenCalled();
  });

  it.each([
    ["google", "gemini-2.5-flash", () => ai.createGoogleGenerativeAI],
    ["groq", "llama-3.3-70b-versatile", () => ai.createGroq],
    ["xai", "grok-3", () => ai.createXai],
    ["deepseek", "deepseek-chat", () => ai.createDeepSeek],
    ["mistral", "mistral-small-latest", () => ai.createMistral],
  ] as const)(
    "uses the %s SDK for that account",
    async (provider, model, factory) => {
      ai.streamText.mockReturnValue(emptyStream());

      await collect(configuration({ provider, model }));

      expect(factory()).toHaveBeenCalledWith({ apiKey: "sk-test" });
      expect(ai.createOpenAI).not.toHaveBeenCalled();
      expect(ai.createOpenAICompatible).not.toHaveBeenCalled();
    },
  );

  it("uses the OpenAI-compatible SDK when a custom endpoint is configured", async () => {
    ai.streamText.mockReturnValue(emptyStream());

    await collect(
      configuration({
        provider: "openai-compatible",
        model: "local-model",
        baseUrl: "https://example.invalid/v1",
      }),
    );

    expect(ai.createOpenAICompatible).toHaveBeenCalledWith({
      name: "openai-compatible",
      apiKey: "sk-test",
      baseURL: "https://example.invalid/v1",
    });
    expect(ai.createOpenAI).not.toHaveBeenCalled();
  });

  it("omits tools when workspace inspection is disabled", async () => {
    ai.streamText.mockReturnValue(emptyStream());

    await collect(configuration({ canInspectWorkspace: false }));

    const args = ai.streamText.mock.calls[0]?.[0] as StreamTextArgs;
    expect(args.tools).toBeUndefined();
  });

  it.each<[string, () => unknown]>([
    ["active-chat", () => context.activeChat],
    ["messages", () => context.visibleMessages],
    ["chats", () => context.visibleChats],
    ["components", () => context.components],
    ["all", () => context],
  ])("returns the %s workspace section", async (section, pick) => {
    ai.streamText.mockReturnValue(emptyStream());

    await collect(configuration());

    const args = ai.streamText.mock.calls[0]?.[0] as StreamTextArgs;
    const tool = args.tools?.["inspectWorkspace"];
    expect(tool).toBeDefined();
    await expect(tool?.execute({ section })).resolves.toEqual(pick());
  });

  it("maps an authentication failure to a sanitized message", async () => {
    ai.streamText.mockReturnValue({
      fullStream: (async function* (): AsyncGenerator<StreamPart> {
        yield { type: "text-delta", id: "1", text: "partial" };
        yield {
          type: "error",
          error: new Error(
            "Incorrect API key provided: sk-test. See https://platform.openai.com/account/api-keys.",
          ),
        };
      })(),
    });

    const outputs = await collect(configuration());

    expect(outputs).toEqual([
      { type: "activity", label: "Reading workspace" },
      { type: "text", delta: "partial" },
      {
        type: "error",
        message: "The provider rejected the credentials. Check Agent settings.",
      },
    ]);
    // The sanitized message carries no key material or provider URLs.
    expect(JSON.stringify(outputs.at(-1))).not.toMatch(/sk-test|https?:/);
  });

  it("maps a 401 status code to the authentication message", async () => {
    ai.streamText.mockImplementation((): never => {
      throw Object.assign(new Error("request failed"), { statusCode: 401 });
    });

    const outputs = await collect(configuration());

    expect(outputs.at(-1)).toEqual({
      type: "error",
      message: "The provider rejected the credentials. Check Agent settings.",
    });
  });

  it("maps a network failure to a sanitized message", async () => {
    ai.streamText.mockImplementation((): never => {
      throw new TypeError("fetch failed");
    });

    const outputs = await collect(configuration());

    expect(outputs.at(-1)).toEqual({
      type: "error",
      message:
        "The provider could not be reached. Check the network connection.",
    });
  });

  it.each<[string, unknown]>([
    ["an unrecognized provider error", new Error("quota exceeded")],
    ["a blank error message", new Error("  ")],
    ["a non-error failure", "provider down"],
  ])("falls back to a generic message for %s", async (_label, failure) => {
    ai.streamText.mockImplementation((): never => {
      throw failure;
    });

    const outputs = await collect(configuration());

    expect(outputs.at(-1)).toEqual({
      type: "error",
      message: "The agent request failed.",
    });
  });
});
