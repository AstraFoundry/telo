import { describe, expect, it } from "vitest";

import type { UserPreferencesRepository } from "../../domain/preferences/preferences-ports";
import { UserPreferences } from "../../domain/preferences/user-preferences";
import { UpdateUserPreferencesService } from "./update-user-preferences";

class MemoryUserPreferencesRepository implements UserPreferencesRepository {
  value = UserPreferences.default();
  async get() {
    return this.value;
  }
  async save(value: UserPreferences) {
    this.value = value;
  }
}

const DEFAULTS = UserPreferences.default().snapshot();

describe("UpdateUserPreferencesService", () => {
  it("returns the stored preferences", async () => {
    const repository = new MemoryUserPreferencesRepository();
    const service = new UpdateUserPreferencesService(repository);

    expect(await service.get()).toEqual(DEFAULTS);
  });

  it("merges a partial update, persists it, and returns the result", async () => {
    const repository = new MemoryUserPreferencesRepository();
    const service = new UpdateUserPreferencesService(repository);

    const result = await service.execute({ demoWorkspace: true });

    expect(result).toEqual({
      ...DEFAULTS,
      demoWorkspace: true,
    });
    expect(repository.value.snapshot()).toEqual(result);

    const next = await service.execute({
      agentPanelOpen: true,
      theme: "dark",
      accentColor: "purple",
      messageTextSize: 16,
      timeFormat: "24h",
      sendWithEnter: false,
      notificationsEnabled: false,
    });

    expect(next).toEqual({
      ...DEFAULTS,
      agentPanelOpen: true,
      demoWorkspace: true,
      theme: "dark",
      accentColor: "purple",
      messageTextSize: 16,
      timeFormat: "24h",
      sendWithEnter: false,
      notificationsEnabled: false,
    });
    expect(repository.value.snapshot()).toEqual(next);
  });
});
