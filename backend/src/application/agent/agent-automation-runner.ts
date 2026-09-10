import type {
  AgentContextScopeInput,
  AgentDeliveryMode,
  AgentRedactionCounts,
  ChatDto,
  ChatPageCursorDto,
  UiContextSnapshot,
} from "../../../../contracts/src/ipc";
import { hashAgentPrompt } from "../../domain/agent/agent-audit";
import type {
  AgentAuditRepository,
  AgentConfigurationRepository,
  AgentGateway,
} from "../../domain/agent/agent-ports";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { assertCanSendContent } from "../../domain/telegram/can-send-content";
import { AgentContextService, buildScopedPrompt } from "./agent-context";

/**
 * Automation runs have no renderer behind them, so the UI snapshot the
 * gateway normally receives from the panel is deliberately empty.
 */
const EMPTY_SNAPSHOT: UiContextSnapshot = {
  activeChat: null,
  visibleChats: [],
  visibleMessages: [],
  components: [],
};

const EMPTY_REDACTION: AgentRedactionCounts = {
  emails: 0,
  phones: 0,
  tokens: 0,
};

const PAGE_LIMIT = 100;

export interface AgentAutomationRunInput {
  readonly promptTemplate: string;
  readonly delivery: AgentDeliveryMode;
  readonly chatId: string;
  readonly replyToId?: string;
  readonly scope: AgentContextScopeInput | null;
}

export interface AgentAutomationRunResult {
  readonly status: "sent" | "draft" | "draft-conflict" | "empty" | "error";
  readonly text: string;
  readonly error?: string;
}

/**
 * Structural view of the runner the engine and scheduler depend on, so
 * tests substitute a stub without faking the whole class.
 */
export interface AutomationRunExecutor {
  run(input: AgentAutomationRunInput): Promise<AgentAutomationRunResult>;
}

/**
 * Executes one automation run end to end: assemble the optional scoped
 * payload, stream the gateway, audit the payload hash, then deliver the
 * reply into Telegram. An invalid scope throws before anything leaves the
 * device (same contract as the panel run); gateway failures arrive as error
 * outputs and become an `"error"` result instead.
 */
export class AgentAutomationRunner {
  constructor(
    private readonly configurations: AgentConfigurationRepository,
    private readonly gateway: AgentGateway,
    private readonly context: AgentContextService,
    private readonly telegram: TelegramRepository,
    private readonly audits: AgentAuditRepository,
  ) {}

  async run(input: AgentAutomationRunInput): Promise<AgentAutomationRunResult> {
    const configuration = await this.configurations.get();

    let prompt = input.promptTemplate;
    let messageIds: ReadonlyArray<string> = [];
    let redactionCounts = EMPTY_REDACTION;
    if (input.scope) {
      const assembled = await this.context.assemble(input.scope);
      prompt = buildScopedPrompt(input.promptTemplate, assembled);
      messageIds = assembled.messages.map((message) => message.messageId);
      redactionCounts = assembled.redactionCounts;
    }

    let text = "";
    let error: string | null = null;
    for await (const output of this.gateway.stream({
      prompt,
      history: [],
      context: EMPTY_SNAPSHOT,
      configuration,
    })) {
      if (output.type === "text") text += output.delta;
      else if (output.type === "error") error = output.message;
    }

    // Same audit contract as panel runs: scope, message ids, redaction
    // counts, and a hash of the exact prompt — never the prompt itself.
    await this.audits.append({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action: "run",
      threadId: "automation",
      scope: input.scope?.scope ?? "selected",
      messageIds,
      redactionCounts,
      model: configuration.snapshot().model,
      promptHash: await hashAgentPrompt(prompt),
    });

    if (error) return { status: "error", text, error };
    if (!text) return { status: "empty", text };

    if (input.delivery === "auto-send") {
      const target = await this.telegram.getChat(input.chatId);
      if (target) assertCanSendContent(target, "text");
      await this.telegram.sendMessage(input.chatId, text, input.replyToId);
      return { status: "sent", text };
    }
    const chat = await this.findChat(input.chatId);
    // An occupied composer is a human's half-written message; automation
    // must never overwrite it, so the run parks as a conflict instead.
    if (chat.draftPreview) return { status: "draft-conflict", text };
    assertCanSendContent(chat, "text");
    await this.telegram.saveDraft(input.chatId, text);
    return { status: "draft", text };
  }

  /**
   * Page-until-found, mirroring AgentContextService.findChat: the delivery
   * chat is almost always on the first page.
   */
  private async findChat(chatId: string): Promise<ChatDto> {
    let cursor: ChatPageCursorDto | null = null;
    do {
      const page = await this.telegram.listChatPage({
        limit: PAGE_LIMIT,
        cursor,
      });
      const chat = page.items.find((item) => item.id === chatId);
      if (chat) return chat;
      cursor = page.nextCursor;
    } while (cursor);
    throw new Error(`Unknown chat: ${chatId}`);
  }
}
