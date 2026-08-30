import type { RunChatAgentInput } from "../../../../contracts/src/ipc";
import { AGENT_ACTION_EXTRACT } from "../../domain/agent/agent-actions";
import type { AgentOutput } from "../../domain/agent/agent-ports";
import type { RunAgentService } from "./run-agent";

/**
 * Extracts decisions, open questions, and action items from a chat's unread
 * messages into the agent thread, sharing the summary's scope and citation
 * convention so the panel can jump to each source message.
 */
export class RunChatExtractionService {
  constructor(private readonly runAgent: RunAgentService) {}

  execute(input: RunChatAgentInput): AsyncIterable<AgentOutput> {
    return this.runAgent.execute({
      threadId: input.threadId,
      prompt: [
        AGENT_ACTION_EXTRACT,
        `Extract the decisions, open questions, and action items from the unread messages of the chat "${input.chatTitle}". Group them under "Decisions", "Open questions", and "Action items".`,
      ].join("\n"),
      context: input.context,
      promptLabel: input.promptLabel,
      scope: { scope: "unread", chatId: input.chatId },
    });
  }
}
