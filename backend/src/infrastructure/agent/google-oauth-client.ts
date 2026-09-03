export { authorizationCodeFromCallback, createPkcePair } from "./oauth-pkce";

import type { AuthorizationCodeProfile } from "./oauth-catalog";
import { AGENT_OAUTH_PROFILE, buildAuthorizationUrl } from "./oauth-catalog";
import { VendorOAuthClient } from "./vendor-oauth-client";

export interface GoogleOAuthClientOptions {
  readonly clientId: string;
  openExternal(url: string): Promise<void>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** @deprecated Use VendorOAuthClient. Kept so Google PKCE tests stay focused. */
export class GoogleOAuthClient extends VendorOAuthClient {
  constructor(options: GoogleOAuthClientOptions) {
    super({
      clientIds: { google: options.clientId },
      openExternal: options.openExternal,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
    });
  }
}

export function buildGoogleAuthorizationUrl(input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
}): string {
  return buildAuthorizationUrl({
    profile: AGENT_OAUTH_PROFILE.google as AuthorizationCodeProfile,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    challenge: input.challenge,
    state: input.state,
  });
}
