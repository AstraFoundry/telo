import type {
  AgentOAuthProvider,
  UiContextSnapshot,
} from "../../../../contracts/src/ipc";
import type { AgentAuditRecord } from "./agent-audit";
import type {
  AgentConfiguration,
  AgentOAuthTokens,
  AgentProvider,
} from "./agent-configuration";
import type { AgentThread, AgentThreadRole } from "./agent-thread";
import type { AgentTriggerRule } from "./agent-trigger-rule";
import type { AgentScheduledTask } from "./agent-scheduled-task";

export interface AgentConfigurationRepository {
  get(): Promise<AgentConfiguration>;
  save(configuration: AgentConfiguration): Promise<void>;
}

/**
 * Vendor OAuth for a named BYOA provider. Tokens never leave the main
 * process; the renderer only sees `accountLabel`.
 */
export interface AgentOAuthClient {
  configuredProviders(): ReadonlyArray<AgentOAuthProvider>;
  isConfigured(provider: AgentProvider): boolean;
  supports(provider: AgentProvider): boolean;
  authorize(provider: AgentProvider): Promise<AgentOAuthTokens>;
  refresh(
    provider: AgentProvider,
    session: AgentOAuthTokens,
  ): Promise<AgentOAuthTokens>;
}

export interface AgentModelCatalogEntry {
  readonly id: string;
  readonly label?: string;
}

/**
 * Vendor `/models` (or equivalent) list. Implemented in infrastructure so
 * the use case never talks HTTP; tokens stay in the main process.
 */
export interface AgentModelCatalog {
  list(input: {
    readonly provider: AgentProvider;
    readonly baseUrl: string | null;
    readonly apiKey: string | null;
    readonly oauth: AgentOAuthTokens | null;
  }): Promise<ReadonlyArray<AgentModelCatalogEntry>>;
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
/** Trigger rules, user- and agent-authored, in creation order. */
export interface AgentTriggerRuleRepository {
  list(): Promise<ReadonlyArray<AgentTriggerRule>>;
  /** Insert or replace by ruleId. */
  save(rule: AgentTriggerRule): Promise<void>;
  remove(ruleId: string): Promise<void>;
}

/** Scheduled tasks, user- and agent-authored, in creation order. */
export interface AgentScheduledTaskRepository {
  list(): Promise<ReadonlyArray<AgentScheduledTask>>;
  /** Insert or replace by taskId. */
  save(task: AgentScheduledTask): Promise<void>;
  remove(taskId: string): Promise<void>;
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
  /**
   * Proposes up to `limit` short follow-up prompts for a finished exchange.
   * Decorative: a gateway that cannot suggest resolves to an empty list and
   * must never throw for a run that already succeeded.
   */
  suggest(input: {
    readonly prompt: string;
    readonly reply: string;
    readonly configuration: AgentConfiguration;
    readonly limit: number;
  }): Promise<ReadonlyArray<string>>;
}
