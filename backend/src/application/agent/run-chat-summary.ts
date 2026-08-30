import type { RunChatAgentInput } from "../../../../contracts/src/ipc";
import { AGENT_ACTION_SUMMARIZE } from "../../domain/agent/agent-actions";
import type { AgentOutput } from "../../domain/agent/agent-ports";
import type { RunAgentService } from "./run-agent";

/**
 * Summarizes a chat's unread messages into the agent thread. The scope is
 * assembled main-side (fresh, redacted, audited); this use case only marks
 * the run with the summarize action and its citation convention.
 */
export class RunChatSummaryService {
  constructor(private readonly runAgent: RunAgentService) {}

  execute(input: RunChatAgentInput): AsyncIterable<AgentOutput> {
    return this.runAgent.execute({
      threadId: input.threadId,
      prompt: [
        AGENT_ACTION_SUMMARIZE,
        `Summarize the unread messages of the chat "${input.chatTitle}".`,
      ].join("\n"),
      context: input.context,
      promptLabel: input.promptLabel,
      scope: { scope: "unread", chatId: input.chatId },
    });
  }
}
