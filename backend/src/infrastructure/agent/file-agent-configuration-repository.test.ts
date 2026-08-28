import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import { FileAgentConfigurationRepository } from "./file-agent-configuration-repository";

function repositoryAt(filePath: string): FileAgentConfigurationRepository {
  return new FileAgentConfigurationRepository(
    filePath,
    (value) => Buffer.from(value).toString("base64"),
    (value) => Buffer.from(value, "base64").toString("utf8"),
  );
}

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "telo-agent-"));
  return path.join(directory, "agent.json");
}

describe("FileAgentConfigurationRepository", () => {
  it("falls back to the default configuration when the file is missing", async () => {
    const repository = repositoryAt(await temporaryFile());

    const configuration = await repository.get();

    expect(configuration.snapshot()).toEqual(
      AgentConfiguration.default().snapshot(),
    );
  });

  it("encrypts the API key and restores the configuration", async () => {
    const filePath = await temporaryFile();
    const repository = repositoryAt(filePath);
    const configuration = AgentConfiguration.create({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: null,
      instructions: "Be brief.",
      apiKey: "sk-secret",
      canInspectWorkspace: true,
    });

    await repository.save(configuration);

    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("sk-secret");
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect((await repository.get()).snapshot()).toEqual(
      configuration.snapshot(),
    );
  });

  it("persists a null key when no API key is set", async () => {
    const filePath = await temporaryFile();
    const repository = repositoryAt(filePath);

    await repository.save(AgentConfiguration.default());

    expect(await readFile(filePath, "utf8")).toContain(
      '"encryptedApiKey": null',
    );
    expect((await repository.get()).snapshot().apiKey).toBeNull();
  });

  it("rejects corrupted JSON instead of falling back", async () => {
    const filePath = await temporaryFile();
    await writeFile(filePath, "not json");
    const repository = repositoryAt(filePath);

    await expect(repository.get()).rejects.toThrow(SyntaxError);
  });
});
