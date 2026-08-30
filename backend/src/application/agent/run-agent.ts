import type { RunAgentInput } from "../../../../contracts/src/ipc";
import { hashAgentPrompt } from "../../domain/agent/agent-audit";
import type {
  AgentAuditRepository,
  AgentConfigurationRepository,
  AgentGateway,
  AgentOutput,
  AgentThreadRepository,
} from "../../domain/agent/agent-ports";
import { AgentThread } from "../../domain/agent/agent-thread";
import { AgentContextService, buildScopedPrompt } from "./agent-context";

export class RunAgentService {
  constructor(
    private readonly configurations: AgentConfigurationRepository,
    private readonly gateway: AgentGateway,
    private readonly threads: AgentThreadRepository,
    private readonly context: AgentContextService,
    private readonly audits: AgentAuditRepository,
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
    // restart never loses it from the transcript. Action runs persist their
    // user-facing label: the raw prompt carries markers and message payloads.
    thread = thread.append({
      id: crypto.randomUUID(),
      role: "user",
      body: input.promptLabel ?? input.prompt,
      sentAt: new Date().toISOString(),
    });
    await this.threads.saveThread(thread);

    // The scoped context is assembled and redacted in the main process; an
    // invalid scope fails the run before anything leaves the device, so it
    // is surfaced like a gateway error but never reaches the audit log.
    let gatewayPrompt: string;
    let scoped: Awaited<ReturnType<AgentContextService["assemble"]>>;
    try {
      scoped = await this.context.assemble(input.scope);
      gatewayPrompt = buildScopedPrompt(input.prompt, scoped);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Agent context failed.";
      thread = thread.append({
        id: crypto.randomUUID(),
        role: "assistant",
        body: message,
        sentAt: new Date().toISOString(),
        error: true,
      });
      await this.threads.saveThread(thread);
      yield { type: "error", message };
      return;
    }

    let text = "";
    let error: string | null = null;
    for await (const output of this.gateway.stream({
      prompt: gatewayPrompt,
      history,
      context: input.context,
      configuration,
    })) {
      if (output.type === "text") text += output.delta;
      else if (output.type === "error") error = output.message;
      yield output;
    }

    // Every run that sent a payload is audited locally: what went out
    // (scope, message ids, redaction counts, model) and a hash of the exact
    // prompt — never the raw prompt or message bodies.
    await this.audits.append({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action: "run",
      threadId: input.threadId,
      scope: scoped.scope,
      messageIds: scoped.messages.map((message) => message.messageId),
      redactionCounts: scoped.redactionCounts,
      model: configuration.snapshot().model,
      promptHash: await hashAgentPrompt(gatewayPrompt),
    });

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
