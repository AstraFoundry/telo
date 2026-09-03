import path from "node:path";
import { pathToFileURL } from "node:url";

import { net, protocol } from "electron";

export const MEDIA_SCHEME = "telo-media";
let handled = false;

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // The renderer reads sticker bytes with fetch() so it can gunzip a
        // `.tgs` into Lottie JSON. That is a cross-origin read from the app's
        // own origin to this scheme, which needs CORS on both ends.
        corsEnabled: true,
      },
    },
  ]);
}

// The root is a resolver, not a fixed path: each account owns a media-cache
// subdirectory, and the active account — and with it the served root —
// changes when the switcher swaps accounts, so it is read per request.
export function handleMediaProtocol(cacheDirectory: () => string): void {
  handled = true;
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const root = cacheDirectory();
    const url = new URL(request.url);
    if (url.hostname !== "cache") return new Response(null, { status: 404 });
    const fileName = decodeURIComponent(url.pathname.slice(1));
    if (!fileName || path.basename(fileName) !== fileName) {
      return new Response(null, { status: 400 });
    }
    const filePath = path.join(root, fileName);
    if (path.dirname(filePath) !== path.resolve(root)) {
      return new Response(null, { status: 403 });
    }
    const response = await net.fetch(pathToFileURL(filePath).toString());
    // Only this app can reach the scheme — it is not a network protocol and
    // no remote page can name it — so the allowance costs nothing and lets
    // the renderer read its own cache.
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}

export function unhandleMediaProtocol(): void {
  if (!handled) return;
  protocol.unhandle(MEDIA_SCHEME);
  handled = false;
}
