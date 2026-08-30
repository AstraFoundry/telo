import type {
  MessageAgentActionInput,
  RunAgentInput,
} from "../../../../contracts/src/ipc";
import {
  AGENT_ACTION_DRAFT_REPLY,
  AGENT_ACTION_REWRITE,
  AGENT_ACTION_TRANSLATE,
  AGENT_INPUT_CLOSE,
  AGENT_INPUT_OPEN,
} from "../../domain/agent/agent-actions";
import type {
  AgentConfigurationRepository,
  AgentGateway,
  AgentOutput,
} from "../../domain/agent/agent-ports";

// Instructions are English and output-only: the model answers with the
// transformed text alone so the renderer can stream it straight into the
// composer draft. The machine markers keep the demo gateway deterministic.
const ACTION_INSTRUCTIONS: Record<
  Exclude<MessageAgentActionInput["kind"], "draft-reply">,
  string
> = {
  translate:
    "Translate the message into English. Answer with the translated text only.",
  rewrite:
    "Polish the message: clearer and better written, same language and meaning. Answer with the rewritten text only.",
};

const ACTION_MARKERS: Record<
  Exclude<MessageAgentActionInput["kind"], "draft-reply">,
  string
> = {
  translate: AGENT_ACTION_TRANSLATE,
  rewrite: AGENT_ACTION_REWRITE,
};

const DEFAULT_TONE = "neutral";

/**
 * Structured prompt for a message action: an output-only instruction, the
 * machine action marker, an optional tone marker, and the target message
 * body wrapped in input markers. Gateways read the markers instead of
 * parsing free text (see domain/agent/agent-actions).
 */
export function buildMessageActionPrompt(
  action: MessageAgentActionInput,
  body: string,
): string {
  if (action.kind === "draft-reply") {
    const tone = action.tone ?? DEFAULT_TONE;
    return [
      `Draft a ${tone} reply to the message in its own language. Answer with the suggested reply only.`,
      AGENT_ACTION_DRAFT_REPLY,
      `[[telo-tone:${tone}]]`,
      AGENT_INPUT_OPEN,
      body,
      AGENT_INPUT_CLOSE,
    ].join("\n");
  }
  return [
    ACTION_INSTRUCTIONS[action.kind],
    ACTION_MARKERS[action.kind],
    AGENT_INPUT_OPEN,
    body,
    AGENT_INPUT_CLOSE,
  ].join("\n");
}

/**
 * Runs a message-level agent action (translate / rewrite / draft reply). The
 * result is streamed to the caller and never persisted: message actions are
 * ephemeral, their output lands in the composer draft rather than any agent
 * thread, so no thread history is read or written here.
 */
export class RunMessageActionService {
  constructor(
    private readonly configurations: AgentConfigurationRepository,
    private readonly gateway: AgentGateway,
  ) {}

  async *execute(
    input: RunAgentInput & { readonly action: MessageAgentActionInput },
  ): AsyncIterable<AgentOutput> {
    const configuration = await this.configurations.get();
    yield* this.gateway.stream({
      prompt: buildMessageActionPrompt(input.action, input.prompt),
      history: [],
      context: input.context,
      configuration,
    });
  }
}
