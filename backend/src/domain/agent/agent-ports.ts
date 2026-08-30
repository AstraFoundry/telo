import type { UiContextSnapshot } from "../../../../contracts/src/ipc";
import type { AgentAuditRecord } from "./agent-audit";
import type { AgentConfiguration } from "./agent-configuration";
import type { AgentThread, AgentThreadRole } from "./agent-thread";

export interface AgentConfigurationRepository {
  get(): Promise<AgentConfiguration>;
  save(configuration: AgentConfiguration): Promise<void>;
}

export interface AgentThreadRepository {
  listThreads(): Promise<ReadonlyArray<AgentThread>>;
  getThread(threadId: string): Promise<AgentThread | null>;
  saveThread(thread: AgentThread): Promise<void>;
  getActiveThreadId(): Promise<string | null>;
  setActiveThreadId(threadId: string): Promise<void>;
}

/** Append-only local audit trail of what agent runs sent off-device. */
export interface AgentAuditRepository {
  append(record: AgentAuditRecord): Promise<void>;
  /** Newest first, capped at `limit` records. */
  listRecent(limit: number): Promise<ReadonlyArray<AgentAuditRecord>>;
}

export interface AgentHistoryMessage {
  readonly role: AgentThreadRole;
  readonly body: string;
}

export type AgentOutput =
  | { readonly type: "text"; readonly delta: string }
  | { readonly type: "activity"; readonly label: string }
  | { readonly type: "error"; readonly message: string };

export interface AgentGateway {
  stream(input: {
    readonly prompt: string;
    readonly history: ReadonlyArray<AgentHistoryMessage>;
    readonly context: UiContextSnapshot;
    readonly configuration: AgentConfiguration;
  }): AsyncIterable<AgentOutput>;
}
