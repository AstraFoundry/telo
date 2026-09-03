import {
  AGENT_ACTION_DRAFT_REPLY,
  AGENT_ACTION_EXTRACT,
  AGENT_ACTION_REWRITE,
  AGENT_ACTION_SUMMARIZE,
  AGENT_ACTION_TRANSLATE,
  AGENT_INPUT_CLOSE,
  AGENT_INPUT_OPEN,
} from "../../domain/agent/agent-actions";
import type { AgentGateway, AgentOutput } from "../../domain/agent/agent-ports";

const TONE_PATTERN = /\[\[telo-tone:([^\]]+)\]\]/;
// Message payload lines are `ref: <link> | <sender>: <body>`; the link is
// what a reply pastes back to cite the message.
const MESSAGE_REF_PATTERN = /^ref: (\S+) \| ([^:]+): /gm;

function payloadOf(prompt: string): string {
  const start = prompt.indexOf(AGENT_INPUT_OPEN);
  const end = prompt.indexOf(AGENT_INPUT_CLOSE);
  if (start === -1 || end === -1 || end <= start) return "";
  return prompt.slice(start + AGENT_INPUT_OPEN.length, end).trim();
}

function messageRefsOf(
  prompt: string,
): ReadonlyArray<{ readonly link: string; readonly sender: string }> {
  return [...prompt.matchAll(MESSAGE_REF_PATTERN)].map((match) => ({
    link: match[1]!,
    sender: match[2]!,
  }));
}

function buildDemoReply(prompt: string): string {
  const payload = payloadOf(prompt);
  if (prompt.includes(AGENT_ACTION_TRANSLATE)) {
    return `Demo translation: ${payload}`;
  }
  if (prompt.includes(AGENT_ACTION_REWRITE)) {
    return `Demo rewrite: ${payload}`;
  }
  if (prompt.includes(AGENT_ACTION_DRAFT_REPLY)) {
    const tone = TONE_PATTERN.exec(prompt)?.[1] ?? "neutral";
    return `Demo ${tone} reply: ${payload}`;
  }
  if (
    prompt.includes(AGENT_ACTION_SUMMARIZE) ||
    prompt.includes(AGENT_ACTION_EXTRACT)
  ) {
    const refs = messageRefsOf(prompt);
    // One cited point per message, mentioning its author the way the
    // reference instruction asks, so the panel exercises links and mentions.
    return [
      `Demo summary of ${refs.length} messages.`,
      ...refs.map((ref) => `- @${ref.sender} weighed in. ${ref.link}`),
    ].join("\n");
  }
  return `Demo agent response: ${prompt.slice(0, 80)}`;
}

export const DEMO_SUGGESTIONS: ReadonlyArray<string> = [
  "What should I reply?",
  "Who is waiting on me?",
  "Turn this into a checklist",
];

/**
 * Deterministic, network-free gateway for the demo workspace (e2e and local
 * exploration): the reply is derived from the prompt alone, so specs can
 * assert exact output without a provider. Selected by TELO_DEMO_WORKSPACE=1.
 */
export class DemoAgentGateway implements AgentGateway {
  async *stream(
    input: Parameters<AgentGateway["stream"]>[0],
  ): AsyncIterable<AgentOutput> {
    const reply = buildDemoReply(input.prompt);
    // Longer replies stream in up to three chunks so the panel's progressive
    // rendering is exercised; short ones arrive whole.
    const parts = reply.length > 60 ? 3 : reply.length > 20 ? 2 : 1;
    const size = Math.ceil(reply.length / parts);
    for (let index = 0; index < reply.length; index += size) {
      yield { type: "text", delta: reply.slice(index, index + size) };
    }
  }

  async suggest(
    input: Parameters<AgentGateway["suggest"]>[0],
  ): Promise<ReadonlyArray<string>> {
    return DEMO_SUGGESTIONS.slice(0, input.limit);
  }
}
