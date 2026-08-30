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
      },
    },
  ]);
}

export function handleMediaProtocol(cacheDirectory: string): void {
  handled = true;
  protocol.handle(MEDIA_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "cache") return new Response(null, { status: 404 });
    const fileName = decodeURIComponent(url.pathname.slice(1));
    if (!fileName || path.basename(fileName) !== fileName) {
      return new Response(null, { status: 400 });
    }
    const filePath = path.join(cacheDirectory, fileName);
    if (path.dirname(filePath) !== path.resolve(cacheDirectory)) {
      return new Response(null, { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

export function unhandleMediaProtocol(): void {
  if (!handled) return;
  protocol.unhandle(MEDIA_SCHEME);
  handled = false;
}
