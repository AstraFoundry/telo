import { describe, expect, it, vi } from "vitest";

import {
  authorizationCodeFromCallback,
  buildGoogleAuthorizationUrl,
  createPkcePair,
  GoogleOAuthClient,
} from "./google-oauth-client";

describe("Google OAuth helpers", () => {
  it("builds a PKCE public-client authorization URL", () => {
    const pkce = createPkcePair();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challenge).toHaveLength(43);
    const url = new URL(
      buildGoogleAuthorizationUrl({
        clientId: "telo-client.apps.googleusercontent.com",
        redirectUri: "http://127.0.0.1:4242/callback",
        challenge: pkce.challenge,
        state: pkce.state,
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(url.searchParams.get("state")).toBe(pkce.state);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  it("rejects a callback whose state does not match", () => {
    expect(() =>
      authorizationCodeFromCallback(
        new URL("http://127.0.0.1/callback?code=abc&state=other"),
        "expected",
      ),
    ).toThrow("OAuth state mismatch");
  });
});

describe("GoogleOAuthClient", () => {
  it("exchanges a loopback code for tokens without a client secret", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/token")) {
        return new Response(
          JSON.stringify({
            access_token: "ya29.access",
            refresh_token: "1//refresh",
            expires_in: 3600,
          }),
          { status: 200 },
        );
      }
      void init;
      return new Response(JSON.stringify({ email: "mina@example.com" }), {
        status: 200,
      });
    });
    const openExternal = vi.fn(async (authorizeUrl: string) => {
      const url = new URL(authorizeUrl);
      const redirect = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      if (!redirect || !state) throw new Error("missing redirect");
      await fetch(`${redirect}?code=auth-code&state=${state}`);
    });
    const client = new GoogleOAuthClient({
      clientId: "telo-client.apps.googleusercontent.com",
      openExternal,
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 5_000,
    });

    const session = await client.authorize("google");

    expect(session).toMatchObject({
      accessToken: "ya29.access",
      refreshToken: "1//refresh",
      accountLabel: "mina@example.com",
    });
    expect(session.expiresAt).toEqual(expect.any(String));
    const tokenCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/token"),
    );
    expect(String(tokenCall?.[1]?.body)).toContain("code_verifier=");
    expect(String(tokenCall?.[1]?.body)).not.toContain("client_secret");
  });

  it("is unconfigured for Google without a client id", () => {
    const client = new GoogleOAuthClient({
      clientId: "  ",
      openExternal: async () => undefined,
    });
    expect(client.isConfigured("google")).toBe(false);
    expect(client.isConfigured("openai")).toBe(true);
    expect(client.supports("openai")).toBe(true);
    expect(client.supports("google")).toBe(true);
  });
});
