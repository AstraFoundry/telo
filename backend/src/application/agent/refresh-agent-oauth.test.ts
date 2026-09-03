import { describe, expect, it, vi } from "vitest";

import { AgentConfiguration } from "../../domain/agent/agent-configuration";
import type {
  AgentConfigurationRepository,
  AgentOAuthClient,
} from "../../domain/agent/agent-ports";
import {
  oauthNeedsRefresh,
  RefreshingAgentConfigurationRepository,
} from "./refresh-agent-oauth";

const oauth = {
  accessToken: "ya29.old",
  refreshToken: "1//refresh",
  expiresAt: "2026-09-03T12:00:00.000Z",
  accountLabel: "mina@example.com",
};

function googleConfig(expiresAt: string | null = oauth.expiresAt) {
  return AgentConfiguration.create({
    provider: "google",
    model: "gemini-2.5-flash",
    baseUrl: null,
    instructions: "Be brief.",
    apiKey: null,
    oauth: { ...oauth, expiresAt },
    canInspectWorkspace: true,
    temperature: 0.7,
    maxSteps: 4,
    historyLimit: 20,
  });
}

describe("oauthNeedsRefresh", () => {
  it("refreshes within a minute of expiry", () => {
    expect(oauthNeedsRefresh(oauth, new Date("2026-09-03T11:59:30.000Z"))).toBe(
      true,
    );
    expect(oauthNeedsRefresh(oauth, new Date("2026-09-03T11:58:00.000Z"))).toBe(
      false,
    );
  });

  it("leaves tokens without an expiry alone", () => {
    expect(oauthNeedsRefresh({ ...oauth, expiresAt: null }, new Date())).toBe(
      false,
    );
  });
});

describe("RefreshingAgentConfigurationRepository", () => {
  it("refreshes an expiring Google session and persists the new tokens", async () => {
    const inner: AgentConfigurationRepository = {
      get: async () => googleConfig(),
      save: vi.fn(async () => undefined),
    };
    const client: AgentOAuthClient = {
      isConfigured: () => true,
      supports: (provider) => provider === "google",
      authorize: async () => oauth,
      refresh: async () => ({
        ...oauth,
        accessToken: "ya29.new",
        expiresAt: "2026-09-03T13:00:00.000Z",
      }),
    };
    const repository = new RefreshingAgentConfigurationRepository(
      inner,
      client,
      () => new Date("2026-09-03T11:59:30.000Z"),
    );

    const resolved = await repository.get();

    expect(resolved.snapshot().oauth?.accessToken).toBe("ya29.new");
    expect(inner.save).toHaveBeenCalledTimes(1);
  });

  it("leaves a session without a refresh token untouched", async () => {
    const inner: AgentConfigurationRepository = {
      get: async () => googleConfig("2026-09-03T12:00:00.000Z"),
      save: vi.fn(async () => undefined),
    };
    const current = await inner.get();
    const snapshot = current.snapshot();
    const withoutRefresh = AgentConfiguration.create({
      ...snapshot,
      oauth: { ...snapshot.oauth!, refreshToken: null },
    });
    inner.get = async () => withoutRefresh;
    const repository = new RefreshingAgentConfigurationRepository(
      inner,
      {
        isConfigured: () => true,
        supports: () => true,
        authorize: async () => oauth,
        refresh: async () => oauth,
      },
      () => new Date("2026-09-03T12:00:00.000Z"),
    );

    const resolved = await repository.get();

    expect(resolved.snapshot().oauth?.accessToken).toBe("ya29.old");
    expect(inner.save).not.toHaveBeenCalled();
  });

  it("delegates save to the inner repository", async () => {
    const inner: AgentConfigurationRepository = {
      get: async () => googleConfig(),
      save: vi.fn(async () => undefined),
    };
    const repository = new RefreshingAgentConfigurationRepository(inner, {
      isConfigured: () => true,
      supports: () => true,
      authorize: async () => oauth,
      refresh: async () => oauth,
    });
    const configuration = googleConfig();

    await repository.save(configuration);

    expect(inner.save).toHaveBeenCalledWith(configuration);
  });

  it("keeps the stored session when refresh fails", async () => {
    const inner: AgentConfigurationRepository = {
      get: async () => googleConfig(),
      save: vi.fn(async () => undefined),
    };
    const repository = new RefreshingAgentConfigurationRepository(
      inner,
      {
        isConfigured: () => true,
        supports: () => true,
        authorize: async () => oauth,
        refresh: async () => {
          throw new Error("network");
        },
      },
      () => new Date("2026-09-03T12:00:00.000Z"),
    );

    const resolved = await repository.get();

    expect(resolved.snapshot().oauth?.accessToken).toBe("ya29.old");
    expect(inner.save).not.toHaveBeenCalled();
  });
});
