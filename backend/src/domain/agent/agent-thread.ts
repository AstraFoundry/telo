export type AgentThreadRole = "user" | "assistant";

export interface AgentThreadMessage {
  readonly id: string;
  readonly role: AgentThreadRole;
  readonly body: string;
  readonly sentAt: string;
  /** Set when the body reports a failed run rather than a model reply. */
  readonly error?: boolean;
}

export interface AgentThreadSnapshot {
  readonly threadId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: ReadonlyArray<AgentThreadMessage>;
}

export interface AgentThreadSummary {
  readonly threadId: string;
  readonly title: string;
  readonly updatedAt: string;
}

const TITLE_LENGTH = 60;

export class AgentThread {
  private constructor(private readonly value: AgentThreadSnapshot) {}

  static create(input: { threadId: string; now: string }): AgentThread {
    const threadId = input.threadId.trim();
    if (!threadId) throw new Error("Agent thread id is required");
    return new AgentThread({
      threadId,
      createdAt: input.now,
      updatedAt: input.now,
      messages: [],
    });
  }

  static restore(snapshot: AgentThreadSnapshot): AgentThread {
    return new AgentThread({
      ...snapshot,
      messages: snapshot.messages.map((message) => ({ ...message })),
    });
  }

  get threadId(): string {
    return this.value.threadId;
  }

  /** Appending returns a new thread; the entity stays immutable. */
  append(message: AgentThreadMessage): AgentThread {
    const body = message.body.trim();
    if (!body) throw new Error("Agent thread message body is required");
    return new AgentThread({
      ...this.value,
      updatedAt: message.sentAt,
      messages: [...this.value.messages, { ...message, body }],
    });
  }

  /** The title is the first user message; empty until the user speaks. */
  title(): string {
    const first = this.value.messages.find(
      (message) => message.role === "user",
    );
    if (!first) return "";
    return first.body.length > TITLE_LENGTH
      ? `${first.body.slice(0, TITLE_LENGTH)}…`
      : first.body;
  }

  summary(): AgentThreadSummary {
    return {
      threadId: this.value.threadId,
      title: this.title(),
      updatedAt: this.value.updatedAt,
    };
  }

  snapshot(): AgentThreadSnapshot {
    return {
      ...this.value,
      messages: this.value.messages.map((message) => ({ ...message })),
    };
  }
}
