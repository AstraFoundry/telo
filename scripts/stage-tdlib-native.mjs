import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getTdjson } from "prebuilt-tdlib";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Copies libtdjson into build/tdlib-native with a stable filename so a
 * packaged Electron app can load it from process.resourcesPath instead of
 * asar node_modules (pnpm's virtual store is not a loadable layout).
 */
export function packagedTdjsonFileName(platform = process.platform) {
  if (platform === "darwin") return "libtdjson.dylib";
  if (platform === "win32") return "tdjson.dll";
  return "libtdjson.so";
}

const destDir = path.join(repositoryRoot, "build", "tdlib-native");
mkdirSync(destDir, { recursive: true });
const source = getTdjson();
const destination = path.join(destDir, packagedTdjsonFileName());
copyFileSync(source, destination);
process.stdout.write(`staged ${source} -> ${destination}\n`);
