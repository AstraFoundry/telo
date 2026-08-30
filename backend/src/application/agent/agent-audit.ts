import type { AgentAuditRecordDto } from "../../../../contracts/src/ipc";
import type { AgentAuditRepository } from "../../domain/agent/agent-ports";

/** The recent-runs list is a compact inspection surface, not a full log. */
const RECENT_RUNS_LIMIT = 50;

export class AgentAuditService {
  constructor(private readonly audits: AgentAuditRepository) {}

  async listRecent(): Promise<ReadonlyArray<AgentAuditRecordDto>> {
    return (await this.audits.listRecent(RECENT_RUNS_LIMIT)).map((record) => ({
      ...record,
      messageIds: [...record.messageIds],
    }));
  }
}
