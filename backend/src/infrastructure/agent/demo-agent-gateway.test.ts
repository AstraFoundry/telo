import { describe, expect, it } from "vitest";

import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type { AgentGateway, AgentOutput } from "../../domain/agent/agent-ports";
import { DemoAgentGateway } from "./demo-agent-gateway";

function streamInput(prompt: string): Parameters<AgentGateway["stream"]>[0] {
  return {
    prompt,
    history: [],
    context: {
      activeChat: null,
      visibleChats: [],
      visibleMessages: [],
      components: [],
    },
    configuration: AgentConfiguration.default(),
  };
}

async function collect(prompt: string): Promise<string> {
  const gateway = new DemoAgentGateway();
  let text = "";
  const outputs: AgentOutput[] = [];
  for await (const output of gateway.stream(streamInput(prompt))) {
    outputs.push(output);
    if (output.type === "text") text += output.delta;
  }
  // The demo gateway streams text only, in 1-3 chunks.
  expect(outputs.length).toBeGreaterThanOrEqual(1);
  expect(outputs.length).toBeLessThanOrEqual(3);
  expect(outputs.every((output) => output.type === "text")).toBe(true);
  return text;
}

describe("DemoAgentGateway", () => {
  it("translates the input payload", async () => {
    expect(
      await collect(
        "[[telo-action:translate]]\n[[telo-input]]\nHola\n[[/telo-input]]",
      ),
    ).toBe("Demo translation: Hola");
  });

  it("rewrites the input payload", async () => {
    expect(
      await collect(
        "[[telo-action:rewrite]]\n[[telo-input]]\nhi there\n[[/telo-input]]",
      ),
    ).toBe("Demo rewrite: hi there");
  });

  it("drafts a reply with the requested tone", async () => {
    expect(
      await collect(
        "[[telo-action:draft-reply]]\n[[telo-tone:warm]]\n[[telo-input]]\nsee you Friday\n[[/telo-input]]",
      ),
    ).toBe("Demo warm reply: see you Friday");
  });

  it("summarizes with one citation per message id in the prompt", async () => {
    expect(
      await collect(
        [
          "[[telo-action:summarize]]",
          "Summarize these messages.",
          "[[telo-input]]",
          "id: design-4 | Lev: Ship the retry flow.",
          "id: design-5 | Priya: Wait for the divider.",
          "[[/telo-input]]",
        ].join("\n"),
      ),
    ).toBe(
      [
        "Demo summary of 2 messages.",
        "[[telo-cite:design-4]]",
        "[[telo-cite:design-5]]",
      ].join("\n"),
    );
  });

  it("extracts with the same citation convention as the summary", async () => {
    expect(
      await collect(
        [
          "[[telo-action:extract]]",
          "[[telo-input]]",
          "id: offsite-1 | Priya: Book the venue.",
          "[[/telo-input]]",
        ].join("\n"),
      ),
    ).toBe("Demo summary of 1 messages.\n[[telo-cite:offsite-1]]");
  });

  it("answers anything else with the generic response", async () => {
    expect(await collect("What is on screen?".padEnd(120, "x"))).toBe(
      `Demo agent response: ${"What is on screen?".padEnd(120, "x").slice(0, 80)}`,
    );
  });
});
