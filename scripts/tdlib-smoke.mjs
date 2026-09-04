import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const releaseRoot = path.join(repositoryRoot, "release");

function fail(message) {
  process.stderr.write(`TDLib packaged smoke failed: ${message}\n`);
  process.exitCode = 1;
}

function findExecutable() {
  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push(
      path.join(releaseRoot, "mac", "Telo.app", "Contents", "MacOS", "Telo"),
      path.join(
        releaseRoot,
        "mac-arm64",
        "Telo.app",
        "Contents",
        "MacOS",
        "Telo",
      ),
      path.join(
        releaseRoot,
        "mac-x64",
        "Telo.app",
        "Contents",
        "MacOS",
        "Telo",
      ),
    );
  } else if (process.platform === "win32") {
    candidates.push(path.join(releaseRoot, "win-unpacked", "Telo.exe"));
  } else {
    candidates.push(
      path.join(releaseRoot, "linux-unpacked", "telo"),
      path.join(releaseRoot, "linux-unpacked", "Telo"),
    );
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  if (!existsSync(releaseRoot)) return null;
  return findFileNamed(
    releaseRoot,
    process.platform === "win32" ? "Telo.exe" : "telo",
  );
}

function findFileNamed(directory, name) {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const nested = findFileNamed(full, name);
      if (nested) return nested;
    } else if (entry === name) {
      return full;
    }
  }
  return null;
}

const executable = findExecutable();
if (!executable) {
  fail("no unpacked Electron artifact under release/; run pnpm package first.");
} else {
  const child = spawn(executable, ["--no-sandbox"], {
    env: {
      ...process.env,
      TELO_TDLIB_SMOKE: "1",
      TELO_PLAINTEXT_SECRETS: "1",
    },
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    if (code !== 0) fail(`packaged process exited ${code}`);
  });
  child.on("error", (error) => {
    fail(error.message);
  });
}
