import { describe, expect, it, vi } from "vitest";

import { parseDeviceAuthorization, pollDeviceToken } from "./oauth-device-code";
import {
  AGENT_OAUTH_PROFILE,
  buildAuthorizationUrl,
  resolveOAuthClientId,
  type AuthorizationCodeProfile,
} from "./oauth-catalog";
import { createPkcePair } from "./oauth-pkce";
import { VendorOAuthClient } from "./vendor-oauth-client";

describe("resolveOAuthClientId", () => {
  it("uses a public native client when no override is set", () => {
    expect(resolveOAuthClientId("kimi")).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveOAuthClientId("google")).toBe("");
  });

  it("prefers an explicit override", () => {
    expect(resolveOAuthClientId("kimi", { kimi: "telo-kimi" })).toBe(
      "telo-kimi",
    );
  });
});

describe("buildAuthorizationUrl", () => {
  it("builds an OpenAI PKCE URL without a client secret", () => {
    const pkce = createPkcePair();
    const url = new URL(
      buildAuthorizationUrl({
        profile: AGENT_OAUTH_PROFILE.openai as AuthorizationCodeProfile,
        clientId: "app_test",
        redirectUri: "http://localhost:1455/auth/callback",
        challenge: pkce.challenge,
        state: pkce.state,
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://auth.openai.com/oauth/authorize",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("originator")).toBe("telo");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });
});

describe("parseDeviceAuthorization", () => {
  it("requires the fields a browser can open", () => {
    expect(() => parseDeviceAuthorization({})).toThrow(
      "The account was not connected.",
    );
    expect(
      parseDeviceAuthorization({
        device_code: "dev",
        user_code: "WDJB-MJHT",
        verification_uri_complete: "https://example.invalid/device",
        interval: 5,
        expires_in: 60,
      }),
    ).toMatchObject({
      deviceCode: "dev",
      intervalMs: 5_000,
      expiresInMs: 60_000,
    });
  });
});

describe("pollDeviceToken", () => {
  it("keeps polling through authorization_pending then returns tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "authorization_pending" }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access",
            refresh_token: "refresh",
            expires_in: 900,
          }),
          { status: 200 },
        ),
      );
    const sleep = vi.fn(async () => undefined);

    const tokens = await pollDeviceToken({
      tokenUrl: "https://auth.example/token",
      body: new URLSearchParams({ device_code: "dev" }),
      headers: {},
      intervalMs: 1,
      expiresInMs: 10_000,
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    });

    expect(tokens.accessToken).toBe("access");
    expect(tokens.refreshToken).toBe("refresh");
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe("VendorOAuthClient", () => {
  it("lists every OAuth vendor that has a client id", () => {
    const client = new VendorOAuthClient({
      clientIds: { google: "" },
      openExternal: async () => undefined,
    });
    expect(client.configuredProviders()).toEqual([
      "openai",
      "anthropic",
      "xai",
      "kimi",
    ]);
    expect(client.isConfigured("google")).toBe(false);
    expect(client.isConfigured("kimi")).toBe(true);
  });

  it("completes the Kimi device-code grant without a client secret", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      void init;
      const href = String(url);
      if (href.includes("device_authorization")) {
        return new Response(
          JSON.stringify({
            device_code: "dev",
            user_code: "WDJB-MJHT",
            verification_uri_complete:
              "https://kimi.com/code/authorize_device?user_code=WDJB-MJHT",
            interval: 1,
            expires_in: 60,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          access_token: "kimi-access",
          refresh_token: "kimi-refresh",
          expires_in: 900,
        }),
        { status: 200 },
      );
    });
    const openExternal = vi.fn(async () => undefined);
    const client = new VendorOAuthClient({
      openExternal,
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async () => undefined,
      kimiHeaders: { "X-Msh-Platform": "telo" },
    });

    const session = await client.authorize("kimi");

    expect(session).toMatchObject({
      accessToken: "kimi-access",
      refreshToken: "kimi-refresh",
    });
    expect(openExternal).toHaveBeenCalledWith(
      "https://kimi.com/code/authorize_device?user_code=WDJB-MJHT",
    );
    const authCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("device_authorization"),
    );
    expect(String(authCall?.[1]?.body)).toContain("client_id=");
    expect(String(authCall?.[1]?.body)).not.toContain("client_secret");
    expect(
      (authCall?.[1]?.headers as Record<string, string>)["X-Msh-Platform"],
    ).toBe("telo");
  });
});
