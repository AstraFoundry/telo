import { AGENT_PROVIDER_DEFAULT_MODEL } from "../../../../contracts/src/ipc";
import type {
  AgentModelCatalog,
  AgentModelCatalogEntry,
} from "../../domain/agent/agent-ports";

/**
 * Returns the provider's default model id without calling a vendor.
 * Selected when `TELO_E2E=1` so Playwright can exercise the list path
 * with the fixture OAuth client, which has no real upstream token.
 */
export class FixtureAgentModelCatalog implements AgentModelCatalog {
  async list(input: {
    readonly provider: keyof typeof AGENT_PROVIDER_DEFAULT_MODEL;
  }): Promise<ReadonlyArray<AgentModelCatalogEntry>> {
    return [{ id: AGENT_PROVIDER_DEFAULT_MODEL[input.provider] }];
  }
}
