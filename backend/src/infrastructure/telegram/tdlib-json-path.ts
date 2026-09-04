import { existsSync } from "node:fs";
import path from "node:path";

import { getTdjson } from "prebuilt-tdlib";

export interface TdjsonResolveOptions {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
}

export function packagedTdjsonFileName(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "darwin") return "libtdjson.dylib";
  if (platform === "win32") return "tdjson.dll";
  return "libtdjson.so";
}

/**
 * Path to `libtdjson` for `tdl.configure`. Unpackaged development uses
 * `prebuilt-tdlib`'s own resolver. A packaged Electron app loads the copy
 * electron-builder staged under `process.resourcesPath/tdlib-native`.
 */
export function resolveTdjsonPath(options: TdjsonResolveOptions): string {
  if (!options.isPackaged) return getTdjson();
  const staged = path.join(
    options.resourcesPath,
    "tdlib-native",
    packagedTdjsonFileName(),
  );
  if (!existsSync(staged)) {
    throw new Error(`Packaged libtdjson missing at ${staged}`);
  }
  return staged;
}
