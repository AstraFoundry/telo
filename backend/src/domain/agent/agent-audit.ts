import type {
  AgentContextScope,
  AgentRedactionCounts,
} from "../../../../contracts/src/ipc";

/**
 * Local audit trail entry for one agent run. Deliberately carries no raw
 * prompt and no message bodies: the prompt hash is enough to correlate a
 * record with a run without persisting the payload.
 */
export interface AgentAuditRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly action: "run";
  readonly threadId: string;
  readonly scope: AgentContextScope;
  readonly messageIds: ReadonlyArray<string>;
  readonly redactionCounts: AgentRedactionCounts;
  readonly model: string;
  readonly promptHash: string;
}

/**
 * SHA-256 of the exact prompt text handed to the gateway (user prompt plus
 * the redacted context payload), hex-encoded. Correlation only — the raw
 * prompt is never written to the audit log.
 */
export async function hashAgentPrompt(prompt: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(prompt),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
