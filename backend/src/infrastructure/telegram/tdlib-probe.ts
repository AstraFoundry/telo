import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { configureTdlib, createTdlibBridge } from "./tdlib-client";
import type { TdjsonResolveOptions } from "./tdlib-json-path";

export interface TdlibSmokeResult {
  readonly ok: boolean;
  readonly tdjson: string;
  readonly authorizationStates: ReadonlyArray<string>;
  readonly error: string | null;
}

/**
 * Wave 0 / L2 packaged smoke: load `libtdjson`, accept TDLib parameters, and
 * stop at `authorizationStateWaitPhoneNumber`. No phone login.
 */
export async function runTdlibSmoke(
  resolve: TdjsonResolveOptions,
  apiId = 1,
  apiHash = "1",
): Promise<TdlibSmokeResult> {
  const tdjson = configureTdlib(resolve);
  const databaseDirectory = await mkdtemp(
    path.join(os.tmpdir(), "telo-tdlib-"),
  );
  const filesDirectory = path.join(databaseDirectory, "files");
  const authorizationStates: string[] = [];
  const client = createTdlibBridge({
    apiId,
    apiHash,
    databaseDirectory,
    filesDirectory,
    useMessageDatabase: true,
    useSecretChats: true,
  });
  try {
    const state = await waitForPhoneNumber(client, authorizationStates);
    return {
      ok: state === "authorizationStateWaitPhoneNumber",
      tdjson,
      authorizationStates,
      error:
        state === "authorizationStateWaitPhoneNumber"
          ? null
          : `unexpected authorization state ${state}`,
    };
  } catch (error) {
    return {
      ok: false,
      tdjson,
      authorizationStates,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.close();
    await rm(databaseDirectory, { recursive: true, force: true });
  }
}

async function waitForPhoneNumber(
  client: {
    onUpdate(
      listener: (update: {
        _: string;
        authorization_state?: { _: string };
      }) => void,
    ): () => void;
  },
  authorizationStates: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("timed out waiting for TDLib parameters"));
    }, 15000);
    const unsubscribe = client.onUpdate((update) => {
      if (update._ !== "updateAuthorizationState") return;
      const state = update.authorization_state?._ ?? "";
      authorizationStates.push(state);
      if (
        state === "authorizationStateWaitPhoneNumber" ||
        state === "authorizationStateWaitEncryptionKey"
      ) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state);
      }
    });
  });
}
