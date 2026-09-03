/**
 * Action markers embedded at the top of machine-assembled agent prompts.
 * They are the protocol between the application use cases that build a
 * prompt and the gateway that answers it (including the deterministic demo
 * gateway), so they live in the domain next to the AgentGateway port.
 */
export const AGENT_ACTION_TRANSLATE = "[[telo-action:translate]]";
export const AGENT_ACTION_REWRITE = "[[telo-action:rewrite]]";
export const AGENT_ACTION_DRAFT_REPLY = "[[telo-action:draft-reply]]";
export const AGENT_ACTION_SUMMARIZE = "[[telo-action:summarize]]";
export const AGENT_ACTION_EXTRACT = "[[telo-action:extract]]";

/** Delimiters wrapping the message payload of an action prompt. */
export const AGENT_INPUT_OPEN = "[[telo-input]]";
export const AGENT_INPUT_CLOSE = "[[/telo-input]]";

/**
 * Payload line of one scoped message. The `ref:` is the message's in-app
 * link (`teloMessageLink`), which the model pastes back to cite the message;
 * the renderer turns the link into a jump target, so a citation is
 * self-describing wherever the reply is shown, including reloaded threads.
 */
export const agentPayloadLine = (
  reference: string,
  senderName: string,
  body: string,
): string => `ref: ${reference} | ${senderName}: ${body}`;

/** Prompt-side contract for the citation and mention conventions. */
export const AGENT_REFERENCE_INSTRUCTION = [
  "Cite the source message of every point by pasting its ref link (telo://message/…) at the end of the sentence, as a bare link.",
  "Refer to people as @Name, spelled exactly as in the payload.",
].join(" ");
