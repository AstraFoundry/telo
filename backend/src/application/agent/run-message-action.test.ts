import { describe, expect, it } from "vitest";

import type { RunAgentInput } from "../../../../contracts/src/ipc";
import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type {
  AgentConfigurationRepository,
  AgentGateway,
} from "../../domain/agent/agent-ports";
import {
  buildMessageActionPrompt,
  RunMessageActionService,
} from "./run-message-action";

const baseInput: RunAgentInput = {
  threadId: "message-action",
  prompt: "Hola, ¿qué tal?",
  context: {
    activeChat: null,
    visibleChats: [],
    visibleMessages: [],
    components: [],
  },
  scope: { scope: "selected", chatId: "chat-1", messageIds: ["m1"] },
};

function configurationRepository(): AgentConfigurationRepository {
  return {
    get: async () => AgentConfiguration.default(),
    save: async () => undefined,
  };
}

function gatewayCapturing(
  outputs: Array<{ type: "text" | "error"; delta?: string; message?: string }>,
): AgentGateway & { seen?: { prompt: string; history: unknown } } {
  const gateway: AgentGateway & {
    seen?: { prompt: string; history: unknown };
  } = {
    suggest: async () => [],
    async *stream(input) {
      gateway.seen = { prompt: input.prompt, history: input.history };
      for (const output of outputs) yield output as never;
    },
  };
  return gateway;
}

describe("buildMessageActionPrompt", () => {
  it("wraps the body in input markers with the translate action marker", () => {
    expect(buildMessageActionPrompt({ kind: "translate" }, "Hola")).toBe(
      "Translate the message into English. Answer with the translated text only.\n" +
        "[[telo-action:translate]]\n" +
        "[[telo-input]]\n" +
        "Hola\n" +
        "[[/telo-input]]",
    );
  });

  it("embeds the tone marker and tone instruction for draft replies", () => {
    const prompt = buildMessageActionPrompt(
      { kind: "draft-reply", tone: "formal" },
      "See you at noon?",
    );
    expect(prompt).toContain("Draft a formal reply");
    expect(prompt).toContain("[[telo-action:draft-reply]]");
    expect(prompt).toContain("[[telo-tone:formal]]");
    expect(prompt).toContain(
      "[[telo-input]]\nSee you at noon?\n[[/telo-input]]",
    );
  });

  it("defaults the draft-reply tone to neutral", () => {
    const prompt = buildMessageActionPrompt({ kind: "draft-reply" }, "Thanks!");
    expect(prompt).toContain("Draft a neutral reply");
    expect(prompt).toContain("[[telo-tone:neutral]]");
  });

  it("marks the rewrite action without a tone", () => {
    const prompt = buildMessageActionPrompt({ kind: "rewrite" }, "rough text");
    expect(prompt).toContain("[[telo-action:rewrite]]");
    expect(prompt).not.toContain("[[telo-tone:");
  });
});

describe("RunMessageActionService", () => {
  it("streams the gateway output for the rebuilt prompt with empty history", async () => {
    const gateway = gatewayCapturing([
      { type: "text", delta: "Hello, how are you?" },
    ]);
    const service = new RunMessageActionService(
      configurationRepository(),
      gateway,
    );

    const output = [];
    for await (const event of service.execute({
      ...baseInput,
      action: { kind: "translate" },
    })) {
      output.push(event);
    }

    expect(output).toEqual([{ type: "text", delta: "Hello, how are you?" }]);
    expect(gateway.seen?.history).toEqual([]);
    expect(gateway.seen?.prompt).toContain("[[telo-action:translate]]");
    expect(gateway.seen?.prompt).toContain(
      "[[telo-input]]\nHola, ¿qué tal?\n[[/telo-input]]",
    );
  });

  it("passes gateway errors through untouched", async () => {
    const gateway = gatewayCapturing([
      { type: "error", message: "Add an API key in Agent settings." },
    ]);
    const service = new RunMessageActionService(
      configurationRepository(),
      gateway,
    );

    const output = [];
    for await (const event of service.execute({
      ...baseInput,
      action: { kind: "draft-reply", tone: "friendly" },
    })) {
      output.push(event);
    }

    expect(output).toEqual([
      { type: "error", message: "Add an API key in Agent settings." },
    ]);
    expect(gateway.seen?.prompt).toContain("[[telo-tone:friendly]]");
  });
});
