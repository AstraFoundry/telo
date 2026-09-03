import type { AgentOAuthTokens } from "../../domain/agent/agent-configuration";
import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type {
  AgentConfigurationRepository,
  AgentOAuthClient,
} from "../../domain/agent/agent-ports";

/** Refresh a minute early so a run does not start on a token that expires mid-stream. */
const REFRESH_SKEW_MS = 60_000;

export function oauthNeedsRefresh(oauth: AgentOAuthTokens, now: Date): boolean {
  if (!oauth.expiresAt) return false;
  const expires = Date.parse(oauth.expiresAt);
  if (!Number.isFinite(expires)) return false;
  return expires - REFRESH_SKEW_MS <= now.getTime();
}

export class RefreshingAgentConfigurationRepository implements AgentConfigurationRepository {
  constructor(
    private readonly inner: AgentConfigurationRepository,
    private readonly oauth: AgentOAuthClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(): Promise<AgentConfiguration> {
    const current = await this.inner.get();
    const snapshot = current.snapshot();
    if (!snapshot.oauth || !oauthNeedsRefresh(snapshot.oauth, this.now())) {
      return current;
    }
    if (
      !this.oauth.supports(snapshot.provider) ||
      !snapshot.oauth.refreshToken
    ) {
      return current;
    }
    try {
      const session = await this.oauth.refresh(
        snapshot.provider,
        snapshot.oauth,
      );
      const next = AgentConfiguration.create({ ...snapshot, oauth: session });
      await this.inner.save(next);
      return next;
    } catch {
      // Keep the stored session: the next provider call maps 401 onto the
      // same credential-rejected message as an expired key.
      return current;
    }
  }

  save(configuration: AgentConfiguration): Promise<void> {
    return this.inner.save(configuration);
  }
}
