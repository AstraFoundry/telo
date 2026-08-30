import type {
  AgentContextScope,
  AgentRedactionCounts,
} from "../../../../contracts/src/ipc";

/**
 * One Telegram message assembled into an agent run's context. By the time a
 * message appears here it has passed the redaction pass, so this shape is
 * both the preview model and the gateway payload.
 */
export interface AgentScopedMessage {
  readonly messageId: string;
  readonly chatId: string;
  readonly chatTitle: string;
  readonly senderName: string;
  readonly body: string;
  readonly sentAt: string;
}

/** The exact, redacted message set a scoped agent run sends to the model. */
export interface AgentScopedContext {
  readonly scope: AgentContextScope;
  readonly messages: ReadonlyArray<AgentScopedMessage>;
  readonly redactionCounts: AgentRedactionCounts;
}
