import * as tdl from "tdl";
import type { Client, ClientOptions } from "tdl";
import type * as Td from "tdlib-types";

import {
  resolveTdjsonPath,
  type TdjsonResolveOptions,
} from "./tdlib-json-path";

let configuredTdjson: string | null = null;

export interface TdlibClientOptions {
  readonly apiId: number;
  readonly apiHash: string;
  readonly databaseDirectory: string;
  readonly filesDirectory: string;
  readonly databaseEncryptionKey?: string;
  readonly useMessageDatabase?: boolean;
  readonly useSecretChats?: boolean;
}

export interface TdlibBridge {
  invoke<T>(request: object): Promise<T>;
  onUpdate(listener: (update: Td.Update) => void): () => void;
  close(): Promise<void>;
  isClosed(): boolean;
}

/**
 * Loads libtdjson once per process. Safe to call from tests with a fake
 * packaged layout; production passes Electron's `app.isPackaged`.
 */
export function configureTdlib(options: TdjsonResolveOptions): string {
  const tdjson = resolveTdjsonPath(options);
  if (configuredTdjson === tdjson) return tdjson;
  tdl.configure({ tdjson });
  configuredTdjson = tdjson;
  return tdjson;
}

export function createTdlibBridge(options: TdlibClientOptions): TdlibBridge {
  const client = tdl.createClient(toClientOptions(options));
  return wrapTdlibClient(client);
}

export function wrapTdlibClient(client: Client): TdlibBridge {
  return {
    invoke: <T>(request: object) =>
      client.invoke(request as never) as Promise<T>,
    onUpdate(listener) {
      const handler = (update: Td.Update): void => {
        listener(update);
      };
      client.on("update", handler);
      return () => {
        client.off("update", handler);
      };
    },
    close: () => client.close(),
    isClosed: () => client.isClosed(),
  };
}

function toClientOptions(options: TdlibClientOptions): ClientOptions {
  return {
    apiId: options.apiId,
    apiHash: options.apiHash,
    databaseDirectory: options.databaseDirectory,
    filesDirectory: options.filesDirectory,
    databaseEncryptionKey: options.databaseEncryptionKey,
    tdlibParameters: {
      use_message_database: options.useMessageDatabase ?? true,
      use_secret_chats: options.useSecretChats ?? true,
      system_language_code: "en",
      application_version: "0.1.0",
      device_model: "Telo",
      system_version: process.platform,
    },
  };
}
