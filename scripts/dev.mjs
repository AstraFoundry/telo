import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const electronViteCli = path.join(
  projectRoot,
  "node_modules",
  "electron-vite",
  "bin",
  "electron-vite.js",
);

function prepareMacDevelopmentRuntime() {
  if (process.platform !== "darwin") return undefined;

  const electronExecutable = require("electron");
  const electronPackage = JSON.parse(
    readFileSync(require.resolve("electron/package.json"), "utf8"),
  );
  const sourceBundle = path.resolve(path.dirname(electronExecutable), "../..");
  const runtimeDirectory = path.join(
    projectRoot,
    ".workspace",
    "electron-runtime",
    electronPackage.version,
  );
  const brandedBundle = path.join(runtimeDirectory, "Telo.app");
  const brandedExecutable = path.join(
    brandedBundle,
    "Contents",
    "MacOS",
    "Electron",
  );

  mkdirSync(runtimeDirectory, { recursive: true });
  if (!existsSync(brandedBundle)) {
    execFileSync("cp", ["-cR", sourceBundle, brandedBundle], {
      stdio: "inherit",
    });
  }

  const infoPlist = path.join(brandedBundle, "Contents", "Info.plist");
  const iconDestination = path.join(
    brandedBundle,
    "Contents",
    "Resources",
    "electron.icns",
  );
  copyFileSync(path.join(projectRoot, "build", "icon.icns"), iconDestination);
  execFileSync(
    "plutil",
    ["-replace", "CFBundleDisplayName", "-string", "Telo", infoPlist],
    { stdio: "inherit" },
  );
  execFileSync(
    "plutil",
    ["-replace", "CFBundleName", "-string", "Telo", infoPlist],
    { stdio: "inherit" },
  );
  execFileSync(
    "plutil",
    [
      "-replace",
      "CFBundleIdentifier",
      "-string",
      "dev.telo.desktop.development",
      infoPlist,
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", brandedBundle],
    { stdio: "inherit" },
  );

  return brandedExecutable;
}

const electronExecutable = prepareMacDevelopmentRuntime();
const child = spawn(
  process.execPath,
  [electronViteCli, "dev", ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(electronExecutable
        ? { ELECTRON_EXEC_PATH: electronExecutable }
        : undefined),
    },
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
