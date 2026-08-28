import type { RunAgentInput } from "../../../../contracts/src/ipc";
import type {
  AgentConfigurationRepository,
  AgentGateway,
  AgentOutput,
  AgentThreadRepository,
} from "../../domain/agent/agent-ports";
import { AgentThread } from "../../domain/agent/agent-thread";

export class RunAgentService {
  constructor(
    private readonly configurations: AgentConfigurationRepository,
    private readonly gateway: AgentGateway,
    private readonly threads: AgentThreadRepository,
  ) {}

  async *execute(input: RunAgentInput): AsyncIterable<AgentOutput> {
    const configuration = await this.configurations.get();
    // A threadId the store has never seen is adopted: the renderer mints ids
    // for new threads, so the first run is also the thread's first write.
    const existing = await this.threads.getThread(input.threadId);
    let thread =
      existing ??
      AgentThread.create({
        threadId: input.threadId,
        now: new Date().toISOString(),
      });
    const history = thread
      .snapshot()
      .messages.map(({ role, body }) => ({ role, body }));

    // The user message is persisted before streaming so a mid-run crash or
    // restart never loses it from the transcript.
    thread = thread.append({
      id: crypto.randomUUID(),
      role: "user",
      body: input.prompt,
      sentAt: new Date().toISOString(),
    });
    await this.threads.saveThread(thread);

    let text = "";
    let error: string | null = null;
    for await (const output of this.gateway.stream({
      prompt: input.prompt,
      history,
      context: input.context,
      configuration,
    })) {
      if (output.type === "text") text += output.delta;
      else if (output.type === "error") error = output.message;
      yield output;
    }

    if (text) {
      thread = thread.append({
        id: crypto.randomUUID(),
        role: "assistant",
        body: text,
        sentAt: new Date().toISOString(),
      });
    }
    if (error) {
      thread = thread.append({
        id: crypto.randomUUID(),
        role: "assistant",
        body: error,
        sentAt: new Date().toISOString(),
        error: true,
      });
    }
    if (text || error) await this.threads.saveThread(thread);
  }
}
