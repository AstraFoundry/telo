import {
  AGENT_ACTION_DRAFT_REPLY,
  AGENT_ACTION_EXTRACT,
  AGENT_ACTION_REWRITE,
  AGENT_ACTION_SUMMARIZE,
  AGENT_ACTION_TRANSLATE,
  AGENT_INPUT_CLOSE,
  AGENT_INPUT_OPEN,
  agentCitationMarker,
} from "../../domain/agent/agent-actions";
import type { AgentGateway, AgentOutput } from "../../domain/agent/agent-ports";

const TONE_PATTERN = /\[\[telo-tone:([^\]]+)\]\]/;
// Message payload lines are `id: <id> | <sender>: <body>`; the id is cited.
const MESSAGE_ID_PATTERN = /^id: (\S+) \| /gm;

function payloadOf(prompt: string): string {
  const start = prompt.indexOf(AGENT_INPUT_OPEN);
  const end = prompt.indexOf(AGENT_INPUT_CLOSE);
  if (start === -1 || end === -1 || end <= start) return "";
  return prompt.slice(start + AGENT_INPUT_OPEN.length, end).trim();
}

function messageIdsOf(prompt: string): ReadonlyArray<string> {
  return [...prompt.matchAll(MESSAGE_ID_PATTERN)].map((match) => match[1]);
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
    const ids = messageIdsOf(prompt);
    return [
      `Demo summary of ${ids.length} messages.`,
      ...ids.map((id) => agentCitationMarker(id)),
    ].join("\n");
  }
  return `Demo agent response: ${prompt.slice(0, 80)}`;
}

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
}
