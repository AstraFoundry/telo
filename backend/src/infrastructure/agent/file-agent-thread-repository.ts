import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentThreadRepository } from "../../domain/agent/agent-ports";
import {
  AgentThread,
  type AgentThreadSnapshot,
} from "../../domain/agent/agent-thread";

interface StoredAgentThreads {
  readonly activeThreadId: string | null;
  readonly threads: ReadonlyArray<AgentThreadSnapshot>;
}

const EMPTY_STORE: StoredAgentThreads = { activeThreadId: null, threads: [] };

/**
 * Persists agent threads and the active-thread pointer in a single JSON file.
 * Transcripts hold no secrets, so the file stays plain JSON like
 * `preferences.json`, with the same restrictive file mode.
 */
export class FileAgentThreadRepository implements AgentThreadRepository {
  constructor(private readonly filePath: string) {}

  async listThreads(): Promise<ReadonlyArray<AgentThread>> {
    return (await this.read()).threads.map((thread) =>
      AgentThread.restore(thread),
    );
  }

  async getThread(threadId: string): Promise<AgentThread | null> {
    const stored = (await this.read()).threads.find(
      (thread) => thread.threadId === threadId,
    );
    return stored ? AgentThread.restore(stored) : null;
  }

  async saveThread(thread: AgentThread): Promise<void> {
    const store = await this.read();
    const snapshot = thread.snapshot();
    const threads = store.threads.some(
      (stored) => stored.threadId === snapshot.threadId,
    )
      ? store.threads.map((stored) =>
          stored.threadId === snapshot.threadId ? snapshot : stored,
        )
      : [...store.threads, snapshot];
    await this.write({ ...store, threads });
  }

  async getActiveThreadId(): Promise<string | null> {
    return (await this.read()).activeThreadId;
  }

  async setActiveThreadId(threadId: string): Promise<void> {
    await this.write({ ...(await this.read()), activeThreadId: threadId });
  }

  private async read(): Promise<StoredAgentThreads> {
    try {
      return JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as StoredAgentThreads;
    } catch (error) {
      if (isMissingFile(error)) return EMPTY_STORE;
      throw error;
    }
  }

  private async write(store: StoredAgentThreads): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), {
      mode: 0o600,
    });
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
