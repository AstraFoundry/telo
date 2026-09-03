import { createHash, randomBytes } from "node:crypto";

export const OAUTH_CONNECT_FAILED = "The account was not connected.";

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
    throw new Error(OAUTH_CONNECT_FAILED);
  }
  const code = callbackUrl.searchParams.get("code");
  if (!code) {
    throw new Error(OAUTH_CONNECT_FAILED);
  }
  return code;
}

export function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1] ?? "", "base64url").toString("utf8");
    const payload = JSON.parse(json) as unknown;
    if (!payload || typeof payload !== "object") return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function chatgptAccountId(accessToken: string): string | null {
  const auth = jwtPayload(accessToken)?.["https://api.openai.com/auth"];
  if (!auth || typeof auth !== "object") return null;
  const accountId = (auth as { chatgpt_account_id?: unknown })
    .chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim()
    ? accountId.trim()
    : null;
}

export function emailFromJwt(accessToken: string): string | null {
  const email = jwtPayload(accessToken)?.email;
  return typeof email === "string" && email.trim() ? email.trim() : null;
}
