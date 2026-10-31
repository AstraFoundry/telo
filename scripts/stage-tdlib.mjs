// Copies the pinned prebuilt-tdlib libtdjson into build/tdlib-native/<platform>/
// with a stable file name. The Go client (backend/infrastructure/tdlib) loads
// it from there in development and from the app's resources when packaged.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getTdjson } from "prebuilt-tdlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const libraryName = {
  darwin: "libtdjson.dylib",
  win32: "tdjson.dll",
}[process.platform] ?? "libtdjson.so";

// Matches tdlib.PlatformDir in Go.
const arch = { x64: "x64", arm64: "arm64" }[process.arch];
const platformDir =
  process.platform === "linux"
    ? `linux-${arch}-glibc`
    : `${process.platform}-${arch}`;

const destination = path.join(root, "build", "tdlib-native", platformDir);
mkdirSync(destination, { recursive: true });
const source = getTdjson();
copyFileSync(source, path.join(destination, libraryName));

const pkg = JSON.parse(
  readFileSync(path.join(root, "node_modules/prebuilt-tdlib/package.json"), "utf8"),
);
process.stdout.write(
  `staged TDLib ${pkg.tdlib.version} (${pkg.tdlib.commit.slice(0, 12)}) -> ${path.relative(root, destination)}/${libraryName}\n`,
);
