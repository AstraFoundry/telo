import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  authorizationCodeFromCallback,
  OAUTH_CONNECT_FAILED,
} from "./oauth-pkce";

const CALLBACK_PAGE =
  "<!doctype html><title>Telo</title><p>You can close this window.</p>";

export interface LoopbackListener {
  readonly redirectUri: string;
  readonly waitForCode: Promise<string>;
  close(): void;
}

export function listenForCallback(input: {
  readonly expectedState: string;
  readonly timeoutMs: number;
  readonly host: string;
  readonly path: string;
  readonly port: number;
  readonly redirectUri?: string;
}): Promise<LoopbackListener> {
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
        reject(new Error(OAUTH_CONNECT_FAILED));
      }, input.timeoutMs);
      server.on(
        "request",
        (request: IncomingMessage, response: ServerResponse) => {
          try {
            const host = request.headers.host ?? input.host;
            const url = new URL(request.url ?? "/", `http://${host}`);
            if (url.pathname !== input.path) {
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
    server.listen(input.port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        rejectListen(new Error(OAUTH_CONNECT_FAILED));
        return;
      }
      resolveListen({
        redirectUri:
          input.redirectUri ??
          `http://${input.host}:${address.port}${input.path}`,
        waitForCode,
        close,
      });
    });
    server.on("error", rejectListen);
  });
}
