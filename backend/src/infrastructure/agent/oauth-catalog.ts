import type { AgentOAuthProvider } from "../../../../contracts/src/ipc";

/**
 * Public native/CLI client ids these vendors ship in their own desktop apps.
 * Google has no public default: Telo registers its own Desktop client.
 * Env vars `TELO_<VENDOR>_OAUTH_CLIENT_ID` override any of these.
 */
export const PUBLIC_NATIVE_OAUTH_CLIENT_ID: Partial<
  Record<AgentOAuthProvider, string>
> = {
  openai: "app_EMoamEEZ73f0CkXaXp7hrann",
  anthropic: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  xai: "b1a00492-073a-47ea-816f-4c329264a828",
  kimi: "17e5f671-d194-4dfb-9706-5516cb48c098",
};

export const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding/v1";

export const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";

export type OAuthTokenFormat = "form" | "json";

export interface AuthorizationCodeProfile {
  readonly grant: "authorization-code";
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly tokenFormat: OAuthTokenFormat;
  readonly scopes: string;
  readonly host: string;
  readonly path: string;
  readonly port: number;
  readonly registeredRedirectUri?: string;
  readonly extraAuthorizeParams?: Record<string, string>;
  readonly extraTokenHeaders?: Record<string, string>;
  readonly extraTokenFields?: Record<string, string>;
  readonly userInfoUrl?: string;
}

export interface DeviceCodeProfile {
  readonly grant: "device-code";
  readonly deviceAuthorizationUrl: string;
  readonly tokenUrl: string;
  readonly scopes?: string;
  readonly userInfoUrl?: string;
  readonly includeKimiHeaders?: boolean;
}

export type OAuthProfile = AuthorizationCodeProfile | DeviceCodeProfile;

export const AGENT_OAUTH_PROFILE: Record<AgentOAuthProvider, OAuthProfile> = {
  openai: {
    grant: "authorization-code",
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    tokenFormat: "form",
    scopes: "openid profile email offline_access",
    host: "localhost",
    path: "/auth/callback",
    port: 1455,
    registeredRedirectUri: "http://localhost:1455/auth/callback",
    extraAuthorizeParams: {
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "telo",
    },
  },
  anthropic: {
    grant: "authorization-code",
    authorizeUrl: "https://claude.ai/oauth/authorize",
    tokenUrl: "https://console.anthropic.com/v1/oauth/token",
    tokenFormat: "json",
    scopes: "org:create_api_key user:profile user:inference",
    host: "localhost",
    path: "/callback",
    port: 54545,
    registeredRedirectUri: "http://localhost:54545/callback",
    extraAuthorizeParams: { code: "true" },
    extraTokenHeaders: { "anthropic-beta": ANTHROPIC_OAUTH_BETA },
  },
  google: {
    grant: "authorization-code",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    tokenFormat: "form",
    scopes: [
      "https://www.googleapis.com/auth/generative-language",
      "openid",
      "email",
    ].join(" "),
    host: "127.0.0.1",
    path: "/callback",
    port: 0,
    extraAuthorizeParams: {
      access_type: "offline",
      prompt: "consent",
    },
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
  },
  xai: {
    grant: "device-code",
    deviceAuthorizationUrl: "https://auth.x.ai/oauth/device/code",
    tokenUrl: "https://auth.x.ai/oauth/token",
    scopes: "openid profile email offline_access grok-cli:access api:access",
    userInfoUrl: "https://auth.x.ai/oidc/userinfo",
  },
  kimi: {
    grant: "device-code",
    deviceAuthorizationUrl:
      "https://auth.kimi.com/api/oauth/device_authorization",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    includeKimiHeaders: true,
  },
};

export function resolveOAuthClientId(
  provider: AgentOAuthProvider,
  overrides: Partial<Record<AgentOAuthProvider, string>> = {},
): string {
  const override = overrides[provider]?.trim() || "";
  if (override) return override;
  return PUBLIC_NATIVE_OAUTH_CLIENT_ID[provider] ?? "";
}

export function buildAuthorizationUrl(input: {
  readonly profile: AuthorizationCodeProfile;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
}): string {
  const url = new URL(input.profile.authorizeUrl);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.profile.scopes);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  for (const [key, value] of Object.entries(
    input.profile.extraAuthorizeParams ?? {},
  )) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
