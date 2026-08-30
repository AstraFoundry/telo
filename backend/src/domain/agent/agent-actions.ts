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

/** Citation marker referencing a real message id in the agent's reply. */
export const agentCitationMarker = (messageId: string): string =>
  `[[telo-cite:${messageId}]]`;
