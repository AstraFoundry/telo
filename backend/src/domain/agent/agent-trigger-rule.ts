import {
  AGENT_DELIVERY_DEFAULT,
  isAgentDeliveryMode,
  type AgentAutomationCreator,
  type AgentDeliveryMode,
} from "./agent-automation";

/**
 * Match dimensions of a trigger rule. Dimensions combine with AND; a rule
 * with several keywords fires when any one of them appears (OR within the
 * dimension). A rule must restrict at least one dimension so it cannot
 * match every message by accident.
 */
export interface AgentTriggerRuleMatch {
  readonly chatIds: ReadonlyArray<string>;
  readonly senderIds: ReadonlyArray<string>;
  readonly keywords: ReadonlyArray<string>;
  /** Regular expression tested against the message body. */
  readonly pattern: string | null;
  /** When true, muted chats never fire the rule. */
  readonly excludeMuted: boolean;
}

export interface AgentTriggerRuleSnapshot {
  readonly ruleId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly match: AgentTriggerRuleMatch;
  readonly delivery: AgentDeliveryMode;
  /**
   * The instruction of the agent run a match triggers; the matched message
   * is attached as the run's scoped payload.
   */
  readonly promptTemplate: string;
  readonly createdBy: AgentAutomationCreator;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One incoming message evaluated against a rule. */
export interface AgentTriggerMatchInput {
  readonly chatId: string;
  readonly senderId: string;
  readonly body: string;
  readonly outgoing: boolean;
  readonly chatMuted: boolean;
}

const DEFAULT_MATCH: AgentTriggerRuleMatch = {
  chatIds: [],
  senderIds: [],
  keywords: [],
  pattern: null,
  excludeMuted: true,
};

function cleanList(values: ReadonlyArray<string> | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function normalizeMatch(
  match: Partial<AgentTriggerRuleMatch> | undefined,
): AgentTriggerRuleMatch {
  const normalized: AgentTriggerRuleMatch = {
    chatIds: cleanList(match?.chatIds),
    senderIds: cleanList(match?.senderIds),
    keywords: cleanList(match?.keywords),
    pattern: match?.pattern?.trim() || null,
    excludeMuted: match?.excludeMuted ?? DEFAULT_MATCH.excludeMuted,
  };
  if (
    normalized.chatIds.length === 0 &&
    normalized.senderIds.length === 0 &&
    normalized.keywords.length === 0 &&
    !normalized.pattern
  ) {
    throw new Error(
      "Trigger rule needs at least one match dimension (chat, sender, keyword, or pattern)",
    );
  }
  if (normalized.pattern) {
    try {
      new RegExp(normalized.pattern, "i");
    } catch {
      throw new Error(
        `Trigger rule pattern is not a valid regular expression: ${normalized.pattern}`,
      );
    }
  }
  return normalized;
}

export class AgentTriggerRule {
  /** Compiled on first use; the entity itself stays immutable. */
  private compiledPattern: RegExp | null | undefined;

  private constructor(private readonly value: AgentTriggerRuleSnapshot) {
    this.compiledPattern = undefined;
  }

  static create(input: {
    ruleId: string;
    name: string;
    match?: Partial<AgentTriggerRuleMatch>;
    delivery?: AgentDeliveryMode;
    promptTemplate: string;
    createdBy: AgentAutomationCreator;
    now: string;
  }): AgentTriggerRule {
    const ruleId = input.ruleId.trim();
    if (!ruleId) throw new Error("Trigger rule id is required");
    const name = input.name.trim();
    if (!name) throw new Error("Trigger rule name is required");
    const promptTemplate = input.promptTemplate.trim();
    if (!promptTemplate) {
      throw new Error("Trigger rule prompt template is required");
    }
    const delivery = input.delivery ?? AGENT_DELIVERY_DEFAULT;
    if (!isAgentDeliveryMode(delivery)) {
      throw new Error(`Unknown delivery mode: ${String(input.delivery)}`);
    }
    return new AgentTriggerRule({
      ruleId,
      name,
      enabled: true,
      match: normalizeMatch(input.match),
      delivery,
      promptTemplate,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static restore(snapshot: AgentTriggerRuleSnapshot): AgentTriggerRule {
    return new AgentTriggerRule({
      ...snapshot,
      match: normalizeMatch(snapshot.match),
    });
  }

  get ruleId(): string {
    return this.value.ruleId;
  }

  get delivery(): AgentDeliveryMode {
    return this.value.delivery;
  }

  get enabled(): boolean {
    return this.value.enabled;
  }

  get promptTemplate(): string {
    return this.value.promptTemplate;
  }

  withEnabled(enabled: boolean, now: string): AgentTriggerRule {
    return new AgentTriggerRule({ ...this.value, enabled, updatedAt: now });
  }

  private pattern(): RegExp | null {
    if (this.compiledPattern === undefined) {
      this.compiledPattern = this.value.match.pattern
        ? new RegExp(this.value.match.pattern, "i")
        : null;
    }
    return this.compiledPattern;
  }

  /**
   * Whether the rule fires for one incoming message. Outgoing messages
   * never match: the account's own sends (including automation's) must not
   * re-trigger rules, which is the anti-loop guarantee.
   */
  matches(message: AgentTriggerMatchInput): boolean {
    if (!this.value.enabled) return false;
    if (message.outgoing) return false;
    const match = this.value.match;
    if (match.excludeMuted && message.chatMuted) return false;
    if (match.chatIds.length > 0 && !match.chatIds.includes(message.chatId)) {
      return false;
    }
    if (
      match.senderIds.length > 0 &&
      !match.senderIds.includes(message.senderId)
    ) {
      return false;
    }
    if (match.keywords.length > 0) {
      const body = message.body.toLowerCase();
      if (
        !match.keywords.some((keyword) => body.includes(keyword.toLowerCase()))
      ) {
        return false;
      }
    }
    const pattern = this.pattern();
    if (pattern && !pattern.test(message.body)) return false;
    return true;
  }

  snapshot(): AgentTriggerRuleSnapshot {
    return {
      ...this.value,
      match: {
        chatIds: [...this.value.match.chatIds],
        senderIds: [...this.value.match.senderIds],
        keywords: [...this.value.match.keywords],
        pattern: this.value.match.pattern,
        excludeMuted: this.value.match.excludeMuted,
      },
    };
  }
}
