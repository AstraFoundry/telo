import type {
  AgentThreadDto,
  AgentThreadListDto,
  AgentThreadSummaryDto,
} from "../../../../contracts/src/ipc";
import type { AgentThreadRepository } from "../../domain/agent/agent-ports";
import { AgentThread } from "../../domain/agent/agent-thread";

export class AgentThreadService {
  constructor(private readonly threads: AgentThreadRepository) {}

  async listThreads(): Promise<AgentThreadListDto> {
    const threads = (await this.threads.listThreads())
      .map((thread) => toSummaryDto(thread))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      threads,
      activeThreadId: await this.threads.getActiveThreadId(),
    };
  }

  async getThread(threadId: string): Promise<AgentThreadDto | null> {
    const thread = await this.threads.getThread(threadId);
    return thread ? toDto(thread) : null;
  }

  /** A new thread is persisted immediately so the selection survives restarts. */
  async createThread(): Promise<AgentThreadDto> {
    const thread = AgentThread.create({
      threadId: crypto.randomUUID(),
      now: new Date().toISOString(),
    });
    await this.threads.saveThread(thread);
    await this.threads.setActiveThreadId(thread.threadId);
    return toDto(thread);
  }

  async selectThread(threadId: string): Promise<AgentThreadDto> {
    const thread = await this.threads.getThread(threadId);
    if (!thread) throw new Error(`Unknown agent thread: ${threadId}`);
    await this.threads.setActiveThreadId(thread.threadId);
    return toDto(thread);
  }
}

function toSummaryDto(thread: AgentThread): AgentThreadSummaryDto {
  return thread.summary();
}

function toDto(thread: AgentThread): AgentThreadDto {
  const snapshot = thread.snapshot();
  return {
    ...thread.summary(),
    messages: snapshot.messages.map((message) => ({
      id: message.id,
      from: message.role,
      body: message.body,
      sentAt: message.sentAt,
      error: message.error,
    })),
  };
}
