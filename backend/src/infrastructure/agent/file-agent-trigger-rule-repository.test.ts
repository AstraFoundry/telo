import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AgentTriggerRule } from "../../domain/agent/agent-trigger-rule";
import { FileAgentTriggerRuleRepository } from "./file-agent-trigger-rule-repository";

const NOW = "2026-09-03T12:00:00.000Z";

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "telo-agent-rules-"));
  return path.join(directory, "agent-trigger-rules.json");
}

function rule(ruleId: string, name: string): AgentTriggerRule {
  return AgentTriggerRule.create({
    ruleId,
    name,
    promptTemplate: "Draft a reply",
    createdBy: "user",
    now: NOW,
    match: { keywords: ["urgent"] },
  });
}

describe("FileAgentTriggerRuleRepository", () => {
  it("returns an empty list when the file is missing", async () => {
    const repository = new FileAgentTriggerRuleRepository(
      await temporaryFile(),
    );

    expect(await repository.list()).toEqual([]);
  });

  it("persists rules across instances in creation order", async () => {
    const filePath = await temporaryFile();

    await new FileAgentTriggerRuleRepository(filePath).save(rule("r1", "One"));
    await new FileAgentTriggerRuleRepository(filePath).save(rule("r2", "Two"));

    const restored = await new FileAgentTriggerRuleRepository(filePath).list();
    expect(restored.map((entry) => entry.ruleId)).toEqual(["r1", "r2"]);
    expect(restored[0].snapshot()).toEqual(rule("r1", "One").snapshot());
  });

  it("updates an existing rule instead of duplicating it", async () => {
    const filePath = await temporaryFile();
    const repository = new FileAgentTriggerRuleRepository(filePath);

    await repository.save(rule("r1", "One"));
    await repository.save(
      rule("r1", "Renamed").withEnabled(false, "2026-09-03T13:00:00.000Z"),
    );

    const restored = await repository.list();
    expect(restored).toHaveLength(1);
    expect(restored[0].snapshot().name).toBe("Renamed");
    expect(restored[0].enabled).toBe(false);
  });

  it("removes a rule by id", async () => {
    const filePath = await temporaryFile();
    const repository = new FileAgentTriggerRuleRepository(filePath);

    await repository.save(rule("r1", "One"));
    await repository.save(rule("r2", "Two"));
    await repository.remove("r1");

    expect((await repository.list()).map((entry) => entry.ruleId)).toEqual([
      "r2",
    ]);
  });

  it("stores rules as plain JSON with a restrictive file mode", async () => {
    const filePath = await temporaryFile();

    await new FileAgentTriggerRuleRepository(filePath).save(rule("r1", "One"));

    const stored = JSON.parse(await readFile(filePath, "utf8")) as {
      rules: Array<{ ruleId: string }>;
    };
    expect(stored.rules.map((entry) => entry.ruleId)).toEqual(["r1"]);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("rejects snapshots that fail domain validation", async () => {
    const filePath = await temporaryFile();
    await writeFile(
      filePath,
      JSON.stringify({
        rules: [
          {
            ...rule("r1", "One").snapshot(),
            match: {
              chatIds: [],
              senderIds: [],
              keywords: [],
              pattern: null,
              excludeMuted: true,
            },
          },
        ],
      }),
    );

    await expect(
      new FileAgentTriggerRuleRepository(filePath).list(),
    ).rejects.toThrow(/at least one match dimension/);
  });

  it("rejects corrupted JSON instead of falling back", async () => {
    const filePath = await temporaryFile();
    await writeFile(filePath, "{ not json");

    await expect(
      new FileAgentTriggerRuleRepository(filePath).list(),
    ).rejects.toThrow();
  });
});
