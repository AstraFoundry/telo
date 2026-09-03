import {
  agentProviderSupportsOAuth,
  type AgentOAuthProvider,
} from "../../../../contracts/src/ipc";
import type { AgentOAuthTokens } from "../../domain/agent/agent-configuration";
import type { AgentProvider } from "../../domain/agent/agent-configuration";
import type { AgentOAuthClient } from "../../domain/agent/agent-ports";

import {
  AGENT_OAUTH_PROFILE,
  buildAuthorizationUrl,
  resolveOAuthClientId,
  type AuthorizationCodeProfile,
  type DeviceCodeProfile,
} from "./oauth-catalog";
import {
  DEVICE_CODE_GRANT,
  parseDeviceAuthorization,
  pollDeviceToken,
} from "./oauth-device-code";
import { listenForCallback } from "./oauth-loopback";
import {
  createPkcePair,
  emailFromJwt,
  OAUTH_CONNECT_FAILED,
} from "./oauth-pkce";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface VendorOAuthClientOptions {
  readonly clientIds?: Partial<Record<AgentOAuthProvider, string>>;
  openExternal(url: string): Promise<void>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly kimiHeaders?: Record<string, string>;
  readonly sleep?: (ms: number) => Promise<void>;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
}

interface UserInfoResponse {
  readonly email?: string;
}

export class VendorOAuthClient implements AgentOAuthClient {
  private abort: (() => void) | null = null;

  constructor(private readonly options: VendorOAuthClientOptions) {}

  configuredProviders(): ReadonlyArray<AgentOAuthProvider> {
    return (Object.keys(AGENT_OAUTH_PROFILE) as AgentOAuthProvider[]).filter(
      (provider) => this.clientId(provider),
    );
  }

  isConfigured(provider: AgentProvider): boolean {
    return (
      agentProviderSupportsOAuth(provider) && Boolean(this.clientId(provider))
    );
  }

  supports(provider: AgentProvider): boolean {
    return agentProviderSupportsOAuth(provider);
  }

  async authorize(provider: AgentProvider): Promise<AgentOAuthTokens> {
    if (!agentProviderSupportsOAuth(provider)) {
      throw new Error("OAuth is not available for this provider");
    }
    if (!this.isConfigured(provider)) {
      throw new Error(
        "This build is missing an OAuth client for this provider.",
      );
    }
    const profile = AGENT_OAUTH_PROFILE[provider];
    if (profile.grant === "device-code") {
      return this.authorizeDevice(provider, profile);
    }
    return this.authorizeCode(provider, profile);
  }

  async refresh(
    provider: AgentProvider,
    session: AgentOAuthTokens,
  ): Promise<AgentOAuthTokens> {
    if (!session.refreshToken) {
      throw new Error(OAUTH_CONNECT_FAILED);
    }
    if (!agentProviderSupportsOAuth(provider)) {
      throw new Error("OAuth is not available for this provider");
    }
    const profile = AGENT_OAUTH_PROFILE[provider];
    const tokens = await this.postToken(provider, profile.tokenUrl, {
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    });
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? session.refreshToken,
      expiresAt: tokens.expiresAt,
      accountLabel: session.accountLabel,
    };
  }

  private clientId(provider: AgentOAuthProvider): string {
    return resolveOAuthClientId(provider, this.options.clientIds);
  }

  private extraHeaders(provider: AgentOAuthProvider): Record<string, string> {
    const profile = AGENT_OAUTH_PROFILE[provider];
    const kimi =
      profile.grant === "device-code" && profile.includeKimiHeaders
        ? (this.options.kimiHeaders ?? {})
        : {};
    const tokenHeaders =
      profile.grant === "authorization-code"
        ? (profile.extraTokenHeaders ?? {})
        : {};
    return { ...kimi, ...tokenHeaders };
  }

  private async authorizeCode(
    provider: AgentOAuthProvider,
    profile: AuthorizationCodeProfile,
  ): Promise<AgentOAuthTokens> {
    this.abort?.();
    const pkce = createPkcePair();
    const { redirectUri, waitForCode, close } = await listenForCallback({
      expectedState: pkce.state,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      host: profile.host,
      path: profile.path,
      port: profile.port,
      redirectUri: profile.registeredRedirectUri,
    });
    this.abort = close;
    try {
      await this.options.openExternal(
        buildAuthorizationUrl({
          profile,
          clientId: this.clientId(provider),
          redirectUri,
          challenge: pkce.challenge,
          state: pkce.state,
        }),
      );
      const code = await waitForCode;
      const tokens = await this.postToken(provider, profile.tokenUrl, {
        grant_type: "authorization_code",
        code,
        code_verifier: pkce.verifier,
        redirect_uri: redirectUri,
        state: pkce.state,
      });
      return {
        ...tokens,
        accountLabel: await this.accountLabel(
          provider,
          tokens.accessToken,
          profile.userInfoUrl,
        ),
      };
    } finally {
      close();
      this.abort = null;
    }
  }

  private async authorizeDevice(
    provider: AgentOAuthProvider,
    profile: DeviceCodeProfile,
  ): Promise<AgentOAuthTokens> {
    const headers = this.extraHeaders(provider);
    const body = new URLSearchParams({
      client_id: this.clientId(provider),
    });
    if (profile.scopes) body.set("scope", profile.scopes);
    const response = await (this.options.fetch ?? fetch)(
      profile.deviceAuthorizationUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...headers,
        },
        body,
      },
    );
    if (!response.ok) {
      throw new Error(OAUTH_CONNECT_FAILED);
    }
    const authorization = parseDeviceAuthorization(
      (await response.json()) as Parameters<typeof parseDeviceAuthorization>[0],
    );
    await this.options.openExternal(authorization.verificationUriComplete);
    const tokens = await pollDeviceToken({
      tokenUrl: profile.tokenUrl,
      body: new URLSearchParams({
        client_id: this.clientId(provider),
        device_code: authorization.deviceCode,
        grant_type: DEVICE_CODE_GRANT,
      }),
      headers,
      intervalMs: authorization.intervalMs,
      expiresInMs: this.options.timeoutMs ?? authorization.expiresInMs,
      fetch: this.options.fetch ?? fetch,
      sleep: this.options.sleep,
    });
    return {
      ...tokens,
      accountLabel: await this.accountLabel(
        provider,
        tokens.accessToken,
        profile.userInfoUrl,
      ),
    };
  }

  private async postToken(
    provider: AgentOAuthProvider,
    tokenUrl: string,
    fields: Record<string, string>,
  ): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
  }> {
    const profile = AGENT_OAUTH_PROFILE[provider];
    const payload = {
      client_id: this.clientId(provider),
      ...fields,
      ...(profile.grant === "authorization-code"
        ? profile.extraTokenFields
        : {}),
    };
    const format =
      profile.grant === "authorization-code" ? profile.tokenFormat : "form";
    const headers: Record<string, string> = {
      "content-type":
        format === "json"
          ? "application/json"
          : "application/x-www-form-urlencoded",
      ...this.extraHeaders(provider),
    };
    const response = await (this.options.fetch ?? fetch)(tokenUrl, {
      method: "POST",
      headers,
      body:
        format === "json"
          ? JSON.stringify(payload)
          : new URLSearchParams(payload),
    });
    if (!response.ok) {
      throw new Error(OAUTH_CONNECT_FAILED);
    }
    const tokenPayload = (await response.json()) as TokenResponse;
    const accessToken = tokenPayload.access_token?.trim() || "";
    if (!accessToken) {
      throw new Error(OAUTH_CONNECT_FAILED);
    }
    const expiresAt =
      typeof tokenPayload.expires_in === "number"
        ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString()
        : null;
    return {
      accessToken,
      refreshToken: tokenPayload.refresh_token?.trim() || null,
      expiresAt,
    };
  }

  private async accountLabel(
    _provider: AgentOAuthProvider,
    accessToken: string,
    userInfoUrl: string | undefined,
  ): Promise<string | null> {
    if (userInfoUrl) {
      const response = await (this.options.fetch ?? fetch)(userInfoUrl, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (response.ok) {
        const payload = (await response.json()) as UserInfoResponse;
        const email = payload.email?.trim();
        if (email) return email;
      }
    }
    return emailFromJwt(accessToken);
  }
}
