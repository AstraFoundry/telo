import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const matrixPath = resolve(
  repositoryRoot,
  "docs/telegram/tdlib-capability-matrix.json",
);
const packagePath = resolve(repositoryRoot, "package.json");
const typesPath = resolve(
  repositoryRoot,
  "node_modules/@prebuilt-tdlib/types/tdlib-types.d.ts",
);
const prebuiltPackagePath = resolve(
  repositoryRoot,
  "node_modules/prebuilt-tdlib/package.json",
);

function fail(message) {
  process.stderr.write(`Telegram capability check failed: ${message}\n`);
  process.exitCode = 1;
}

if (!existsSync(typesPath) || !existsSync(prebuiltPackagePath)) {
  fail("prebuilt-tdlib types are missing; run pnpm install first.");
} else {
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const prebuilt = JSON.parse(readFileSync(prebuiltPackagePath, "utf8"));
  const typesHead = readFileSync(typesPath, "utf8").slice(0, 120);
  const expectedPrebuilt = packageJson.dependencies?.["prebuilt-tdlib"];
  const validStates = new Set(["covered", "planned", "not-applicable"]);

  if (expectedPrebuilt && !expectedPrebuilt.includes(prebuilt.version)) {
    fail(
      `package.json declares prebuilt-tdlib ${expectedPrebuilt}, installed ${prebuilt.version}.`,
    );
  }
  if (matrix.prebuiltTdlib !== prebuilt.version) {
    fail(
      `matrix declares prebuilt-tdlib ${matrix.prebuiltTdlib}, installed ${prebuilt.version}.`,
    );
  }
  if (matrix.tdlibVersion !== prebuilt.tdlib?.version) {
    fail(
      `matrix declares TDLib ${matrix.tdlibVersion}, installed ${prebuilt.tdlib?.version}.`,
    );
  }
  if (matrix.tdlibCommit !== prebuilt.tdlib?.commit) {
    fail(
      `matrix declares commit ${matrix.tdlibCommit}, installed ${prebuilt.tdlib?.commit}.`,
    );
  }
  if (!typesHead.includes(matrix.tdlibVersion)) {
    fail(
      `tdlib-types header does not mention TDLib ${matrix.tdlibVersion}; review the installed types.`,
    );
  }

  const capabilityIds = new Set();
  for (const capability of matrix.capabilities ?? []) {
    if (capabilityIds.has(capability.id)) {
      fail(`duplicate capability id ${capability.id}.`);
    }
    capabilityIds.add(capability.id);
    if (!validStates.has(capability.state)) {
      fail(
        `capability ${capability.id} has an invalid state: ${capability.state}.`,
      );
    }
    if (
      typeof capability.workflow !== "string" ||
      capability.workflow.length === 0
    ) {
      fail(`capability ${capability.id} needs a workflow description.`);
    }
    if (capability.state === "covered") {
      if (
        !Array.isArray(capability.methods) ||
        capability.methods.length === 0
      ) {
        fail(`covered capability ${capability.id} must list TDLib methods.`);
      }
      if (
        !Array.isArray(capability.evidence) ||
        capability.evidence.length === 0
      ) {
        fail(`covered capability ${capability.id} must cite evidence paths.`);
      }
      for (const evidence of capability.evidence) {
        if (!existsSync(resolve(repositoryRoot, evidence))) {
          fail(`capability ${capability.id} evidence is missing: ${evidence}.`);
        }
      }
    }
  }
}
