import { agentProviderSupportsOAuth } from "../../../../contracts/src/ipc";
import type { AgentOAuthTokens } from "../../domain/agent/agent-configuration";
import type { AgentProvider } from "../../domain/agent/agent-configuration";
import type { AgentOAuthClient } from "../../domain/agent/agent-ports";

const FIXTURE: AgentOAuthTokens = {
  accessToken: "e2e-google-access",
  refreshToken: "e2e-google-refresh",
  expiresAt: "2099-01-01T00:00:00.000Z",
  accountLabel: "e2e@example.com",
};

/**
 * Completes Google Connect without a browser. Selected when `TELO_E2E=1` so
 * Playwright can exercise the account path that production uses.
 */
export class FixtureAgentOAuthClient implements AgentOAuthClient {
  isConfigured(): boolean {
    return true;
  }

  supports(provider: AgentProvider): boolean {
    return agentProviderSupportsOAuth(provider);
  }

  async authorize(provider: AgentProvider): Promise<AgentOAuthTokens> {
    if (!this.supports(provider)) {
      throw new Error("OAuth is not available for this provider");
    }
    return { ...FIXTURE };
  }

  async refresh(provider: AgentProvider): Promise<AgentOAuthTokens> {
    return this.authorize(provider);
  }
}
