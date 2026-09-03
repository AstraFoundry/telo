/**
 * Shared vocabulary of the agent automation subsystem (trigger rules and
 * scheduled tasks). Delivery mode is declared per rule/task; the global
 * default is draft-only so nothing leaves the account unless a rule
 * explicitly opts into auto-send.
 */
export type AgentDeliveryMode = "auto-send" | "draft-only";

export const AGENT_DELIVERY_DEFAULT: AgentDeliveryMode = "draft-only";

/** Who authored the rule or task; agent-created entries take effect immediately. */
export type AgentAutomationCreator = "user" | "agent";

export function isAgentDeliveryMode(value: string): value is AgentDeliveryMode {
  return value === "auto-send" || value === "draft-only";
}
