import { OAUTH_CONNECT_FAILED } from "./oauth-pkce";

export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceAuthorization {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string;
  readonly intervalMs: number;
  readonly expiresInMs: number;
}

interface DeviceAuthorizationResponse {
  readonly device_code?: string;
  readonly user_code?: string;
  readonly verification_uri?: string;
  readonly verification_uri_complete?: string;
  readonly interval?: number;
  readonly expires_in?: number;
}

interface DeviceTokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly error?: string;
}

export function parseDeviceAuthorization(
  payload: DeviceAuthorizationResponse,
  fallbackIntervalSec = 5,
  fallbackExpirySec = 5 * 60,
): DeviceAuthorization {
  const deviceCode = payload.device_code?.trim() || "";
  const userCode = payload.user_code?.trim() || "";
  const verificationUriComplete =
    payload.verification_uri_complete?.trim() || "";
  const verificationUri = payload.verification_uri?.trim() || "";
  if (!deviceCode || !userCode || !verificationUriComplete) {
    throw new Error(OAUTH_CONNECT_FAILED);
  }
  const intervalSec =
    typeof payload.interval === "number" && payload.interval > 0
      ? payload.interval
      : fallbackIntervalSec;
  const expiresSec =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : fallbackExpirySec;
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    intervalMs: intervalSec * 1000,
    expiresInMs: expiresSec * 1000,
  };
}

export async function pollDeviceToken(input: {
  readonly tokenUrl: string;
  readonly body: URLSearchParams;
  readonly headers: Record<string, string>;
  readonly intervalMs: number;
  readonly expiresInMs: number;
  readonly fetch: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}> {
  const now = input.now ?? Date.now;
  const sleep =
    input.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + input.expiresInMs;
  let intervalMs = input.intervalMs;
  while (now() < deadline) {
    await sleep(intervalMs);
    const response = await input.fetch(input.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...input.headers,
      },
      body: input.body,
    });
    const payload = (await response.json()) as DeviceTokenResponse;
    if (payload.access_token?.trim()) {
      const expiresAt =
        typeof payload.expires_in === "number"
          ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
          : null;
      return {
        accessToken: payload.access_token.trim(),
        refreshToken: payload.refresh_token?.trim() || null,
        expiresAt,
      };
    }
    if (payload.error === "authorization_pending") {
      continue;
    }
    if (payload.error === "slow_down") {
      intervalMs += 5_000;
      continue;
    }
    throw new Error(OAUTH_CONNECT_FAILED);
  }
  throw new Error(OAUTH_CONNECT_FAILED);
}
