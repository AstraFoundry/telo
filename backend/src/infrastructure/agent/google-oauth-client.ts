import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { agentProviderSupportsOAuth } from "../../../../contracts/src/ipc";
import type { AgentOAuthTokens } from "../../domain/agent/agent-configuration";
import type { AgentProvider } from "../../domain/agent/agent-configuration";
import type { AgentOAuthClient } from "../../domain/agent/agent-ports";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const SCOPES = [
  "https://www.googleapis.com/auth/generative-language",
  "openid",
  "email",
].join(" ");
const CALLBACK_PATH = "/callback";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const CALLBACK_PAGE =
  "<!doctype html><title>Telo</title><p>You can close this window.</p>";

export interface GoogleOAuthClientOptions {
  readonly clientId: string;
  openExternal(url: string): Promise<void>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
}

interface UserInfoResponse {
  readonly email?: string;
}

export function createPkcePair(): {
  readonly verifier: string;
  readonly challenge: string;
  readonly state: string;
} {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

export function buildGoogleAuthorizationUrl(input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export function authorizationCodeFromCallback(
  callbackUrl: URL,
  expectedState: string,
): string {
  const state = callbackUrl.searchParams.get("state");
  if (state !== expectedState) {
    throw new Error("OAuth state mismatch");
  }
  const error = callbackUrl.searchParams.get("error");
  if (error) {
    throw new Error("The Google account was not connected.");
  }
  const code = callbackUrl.searchParams.get("code");
  if (!code) {
    throw new Error("The Google account was not connected.");
  }
  return code;
}

export class GoogleOAuthClient implements AgentOAuthClient {
  private abort: (() => void) | null = null;

  constructor(private readonly options: GoogleOAuthClientOptions) {}

  isConfigured(): boolean {
    return Boolean(this.options.clientId.trim());
  }

  supports(provider: AgentProvider): boolean {
    return agentProviderSupportsOAuth(provider);
  }

  async authorize(provider: AgentProvider): Promise<AgentOAuthTokens> {
    if (!this.supports(provider)) {
      throw new Error("OAuth is not available for this provider");
    }
    if (!this.isConfigured()) {
      throw new Error("This build is missing a Google OAuth client.");
    }
    this.abort?.();
    const pkce = createPkcePair();
    const { redirectUri, waitForCode, close } = await listenForCallback({
      expectedState: pkce.state,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    this.abort = close;
    try {
      await this.options.openExternal(
        buildGoogleAuthorizationUrl({
          clientId: this.options.clientId,
          redirectUri,
          challenge: pkce.challenge,
          state: pkce.state,
        }),
      );
      const code = await waitForCode;
      return await this.exchange(code, redirectUri, pkce.verifier);
    } finally {
      close();
      this.abort = null;
    }
  }

  async refresh(
    _provider: AgentProvider,
    session: AgentOAuthTokens,
  ): Promise<AgentOAuthTokens> {
    if (!session.refreshToken) {
      throw new Error("The Google account was not connected.");
    }
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    });
    const tokens = await this.postToken(body);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? session.refreshToken,
      expiresAt: tokens.expiresAt,
      accountLabel: session.accountLabel,
    };
  }

  private async exchange(
    code: string,
    redirectUri: string,
    verifier: string,
  ): Promise<AgentOAuthTokens> {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    const tokens = await this.postToken(body);
    return {
      ...tokens,
      accountLabel: await this.accountLabel(tokens.accessToken),
    };
  }

  private async postToken(body: URLSearchParams): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
  }> {
    const response = await (this.options.fetch ?? fetch)(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new Error("The Google account was not connected.");
    }
    const payload = (await response.json()) as TokenResponse;
    const accessToken = payload.access_token?.trim() || "";
    if (!accessToken) {
      throw new Error("The Google account was not connected.");
    }
    const expiresAt =
      typeof payload.expires_in === "number"
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : null;
    return {
      accessToken,
      refreshToken: payload.refresh_token?.trim() || null,
      expiresAt,
    };
  }

  private async accountLabel(accessToken: string): Promise<string | null> {
    const response = await (this.options.fetch ?? fetch)(USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as UserInfoResponse;
    return payload.email?.trim() || null;
  }
}

function listenForCallback(input: {
  readonly expectedState: string;
  readonly timeoutMs: number;
}): Promise<{
  readonly redirectUri: string;
  readonly waitForCode: Promise<string>;
  close(): void;
}> {
  return new Promise((resolveListen, rejectListen) => {
    const server = createServer();
    let settled = false;
    const close = () => {
      server.close();
    };
    const waitForCode = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        close();
        reject(new Error("The Google account was not connected."));
      }, input.timeoutMs);
      server.on(
        "request",
        (request: IncomingMessage, response: ServerResponse) => {
          try {
            const host = request.headers.host ?? "127.0.0.1";
            const url = new URL(request.url ?? "/", `http://${host}`);
            if (url.pathname !== CALLBACK_PATH) {
              response.writeHead(404).end();
              return;
            }
            const code = authorizationCodeFromCallback(
              url,
              input.expectedState,
            );
            response
              .writeHead(200, { "content-type": "text/html; charset=utf-8" })
              .end(CALLBACK_PAGE);
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(code);
          } catch (error) {
            response.writeHead(400).end();
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        },
      );
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        rejectListen(new Error("The Google account was not connected."));
        return;
      }
      resolveListen({
        redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
        waitForCode,
        close,
      });
    });
    server.on("error", rejectListen);
  });
}
