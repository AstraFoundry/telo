import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const matrixPath = resolve(
  repositoryRoot,
  "docs/telegram/teleproto-capability-matrix.json",
);
const packagePath = resolve(repositoryRoot, "package.json");
const apiDefinitionsPath = resolve(
  repositoryRoot,
  "node_modules/teleproto/tl/generated/api.d.ts",
);

function fail(message) {
  process.stderr.write(`Teleproto capability check failed: ${message}\n`);
  process.exitCode = 1;
}

if (!existsSync(apiDefinitionsPath)) {
  fail("Teleproto API definitions are missing; run pnpm install first.");
} else {
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const apiDefinitions = readFileSync(apiDefinitionsPath, "utf8");
  const requestNames = [
    ...apiDefinitions.matchAll(
      /classType: "request";\s+className: "([^"]+)";/g,
    ),
  ]
    .map((match) => match[1])
    .sort();
  const requestNameSet = new Set(requestNames);
  const requestNamespaces = [
    ...new Set(
      requestNames.map((name) =>
        name.includes(".") ? name.split(".")[0] : "__root__",
      ),
    ),
  ].sort();
  const inventoryHash = createHash("sha256")
    .update(requestNames.join("\n"))
    .digest("hex");
  const expectedVersion = packageJson.dependencies?.teleproto;

  if (matrix.teleprotoVersion !== expectedVersion) {
    fail(
      `matrix declares ${matrix.teleprotoVersion}, but package.json declares ${expectedVersion}.`,
    );
  }
  if (matrix.requestInventorySha256 !== inventoryHash) {
    fail(
      "the Teleproto request inventory changed; review every changed API and update the matrix hash.",
    );
  }

  const policyNamespaces = Object.keys(matrix.namespacePolicy ?? {}).sort();
  if (JSON.stringify(policyNamespaces) !== JSON.stringify(requestNamespaces)) {
    fail(
      `namespace policy must classify every Teleproto request namespace. Expected: ${requestNamespaces.join(", ")}.`,
    );
  }

  const validStates = new Set(["covered", "planned", "not-applicable"]);
  for (const [namespace, policy] of Object.entries(
    matrix.namespacePolicy ?? {},
  )) {
    if (!validStates.has(policy.state)) {
      fail(`namespace ${namespace} has an invalid state: ${policy.state}.`);
    }
    if (typeof policy.rationale !== "string" || policy.rationale.length === 0) {
      fail(`namespace ${namespace} needs a rationale.`);
    }
  }

  const capabilityIds = new Set();
  for (const capability of matrix.capabilities ?? []) {
    if (capabilityIds.has(capability.id)) {
      fail(`capability ${capability.id} is duplicated.`);
    }
    capabilityIds.add(capability.id);
    if (!validStates.has(capability.state)) {
      fail(
        `capability ${capability.id} has an invalid state: ${capability.state}.`,
      );
    }
    if (!Array.isArray(capability.apis) || capability.apis.length === 0) {
      fail(
        `capability ${capability.id} must name at least one Teleproto request.`,
      );
    }
    for (const api of capability.apis) {
      if (!requestNameSet.has(api)) {
        fail(`capability ${capability.id} names unknown request ${api}.`);
      }
    }
    if (
      !Array.isArray(capability.evidence) ||
      capability.evidence.length === 0
    ) {
      fail(
        `capability ${capability.id} needs implementation or backlog evidence.`,
      );
    }
    for (const evidence of capability.evidence) {
      if (!existsSync(resolve(repositoryRoot, evidence))) {
        fail(
          `capability ${capability.id} cites missing evidence: ${evidence}.`,
        );
      }
    }
  }

  if (process.exitCode !== 1) {
    process.stdout.write(
      `Teleproto capability matrix is current: ${requestNames.length} requests across ${requestNamespaces.length} namespaces.\n`,
    );
  }
}
