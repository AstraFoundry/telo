import type {
  AgentAutomationEvent,
  MessageDto,
} from "../../../../contracts/src/ipc";
import type { AgentTriggerRuleRepository } from "../../domain/agent/agent-ports";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import type { AutomationRunExecutor } from "./agent-automation-runner";

/**
 * Watches the Telegram workspace event stream and runs matching trigger
 * rules. Chat mute state is tracked live from chat events so
 * `excludeMuted` rules evaluate against the latest state without an extra
 * dialog fetch. Matching rules run sequentially per message — several
 * rules on one chat must not race replies into it — and a rule already
 * running is not re-entered until its run finishes.
 */
export class AgentTriggerEngine {
  private readonly chatMuted = new Map<string, boolean>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly rules: AgentTriggerRuleRepository,
    private readonly telegram: TelegramRepository,
    private readonly runner: AutomationRunExecutor,
    private readonly notify: (event: AgentAutomationEvent) => void,
  ) {}

  /** Subscribes to workspace events; the returned function stops the engine. */
  start(): () => void {
    const unsubscribe = this.telegram.subscribe((event) => {
      if (event.type === "chat-upsert") {
        this.chatMuted.set(event.chat.id, event.chat.muted);
      } else if (event.type === "chats") {
        for (const chat of event.chats) this.chatMuted.set(chat.id, chat.muted);
      } else if (event.type === "chat-mute") {
        this.chatMuted.set(event.chatId, event.muted);
      } else if (event.type === "message-upsert") {
        // Edits never re-fire rules, and outgoing messages are the
        // anti-loop boundary (automation's own sends included).
        if (event.cause !== "new" || event.message.outgoing) return;
        void this.onMessage(event.message);
      }
    });
    return () => {
      unsubscribe();
      this.chatMuted.clear();
      this.inFlight.clear();
    };
  }

  private async onMessage(message: MessageDto): Promise<void> {
    const muted = this.chatMuted.get(message.chatId) ?? false;
    for (const rule of await this.rules.list()) {
      const matches = rule.matches({
        chatId: message.chatId,
        senderId: message.senderId,
        body: message.body ?? "",
        outgoing: false,
        chatMuted: muted,
      });
      if (!matches || this.inFlight.has(rule.ruleId)) continue;
      this.inFlight.add(rule.ruleId);
      try {
        let outcome;
        try {
          outcome = await this.runner.run({
            promptTemplate: rule.promptTemplate,
            delivery: rule.delivery,
            chatId: message.chatId,
            replyToId: message.id,
            scope: {
              scope: "selected",
              chatId: message.chatId,
              messageIds: [message.id],
            },
          });
        } catch (error) {
          // Runner rejections (invalid scope) surface as a failed run
          // rather than killing the subscription.
          outcome = {
            status: "error" as const,
            text: "",
            error: error instanceof Error ? error.message : String(error),
          };
        }
        this.notify({
          type: "automation-run",
          source: "trigger",
          sourceId: rule.ruleId,
          sourceName: rule.snapshot().name,
          chatId: message.chatId,
          delivery: rule.delivery,
          status: outcome.status,
          preview: outcome.text.slice(0, 200),
          ...(outcome.error ? { error: outcome.error } : {}),
        });
      } finally {
        this.inFlight.delete(rule.ruleId);
      }
    }
  }
}
