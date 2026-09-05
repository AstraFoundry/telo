import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserPreferencesDto } from "../../../../../contracts/src/ipc";
import {
  type TeloApiMock,
  installTeloApiMock,
  testPreferences,
} from "../../../shared/test/mock-telo";

function stubMatchMedia(dark: boolean): void {
  // jsdom does not implement matchMedia.
  window.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

async function importHooks() {
  return import("./hooks");
}

describe("theme model", () => {
  let telo: TeloApiMock;

  beforeEach(() => {
    vi.resetModules();
    telo = installTeloApiMock();
    stubMatchMedia(false);
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    telo.preferences.get.mockResolvedValue(testPreferences());
    telo.preferences.update.mockImplementation((input) =>
      Promise.resolve(testPreferences(input)),
    );
  });

  it("applies the persisted theme once preferences resolve over IPC", async () => {
    telo.preferences.get.mockResolvedValue(testPreferences({ theme: "dark" }));

    await importHooks();

    await vi.waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(telo.preferences.get).toHaveBeenCalled();
  });

  it("applies the system theme at import before preferences resolve", async () => {
    stubMatchMedia(true);
    // Every per-key store issues its own get at module scope; keep all
    // resolvers so the pending loads can settle together.
    const resolvers: ((value: UserPreferencesDto) => void)[] = [];
    telo.preferences.get.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );

    await importHooks();

    // Module scope applies the system theme immediately to avoid a flash.
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    resolvers.forEach((resolve) =>
      resolve(testPreferences({ theme: "light" })),
    );
    await vi.waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  it("migrates the legacy localStorage choice into preferences", async () => {
    stubMatchMedia(true);
    window.localStorage.setItem("telo:theme", "light");

    await importHooks();

    await vi.waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
    expect(telo.preferences.update).toHaveBeenCalledWith({ theme: "light" });
    expect(window.localStorage.getItem("telo:theme")).toBe("light");
  });

  it("discards an unrecognized legacy value and keeps the persisted theme", async () => {
    window.localStorage.setItem("telo:theme", "neon");
    telo.preferences.get.mockResolvedValue(testPreferences({ theme: "dark" }));

    await importHooks();

    await vi.waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(telo.preferences.update).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("telo:theme")).toBe("dark");
  });

  it("applies a cached non-system theme at import before preferences resolve", async () => {
    stubMatchMedia(false);
    window.localStorage.setItem("telo:theme", "dark");
    const resolvers: ((value: UserPreferencesDto) => void)[] = [];
    telo.preferences.get.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );

    await importHooks();

    expect(document.documentElement.classList.contains("dark")).toBe(true);

    resolvers.forEach((resolve) => resolve(testPreferences({ theme: "dark" })));
    await vi.waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  it("persists the selected theme and applies it optimistically", async () => {
    const { useTheme } = await importHooks();
    await vi.waitFor(() => {
      expect(telo.preferences.get).toHaveBeenCalled();
    });
    const { result } = renderHook(() => useTheme());

    expect(result.current.choice).toBe("system");

    act(() => result.current.select("dark"));

    expect(result.current.choice).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(telo.preferences.update).toHaveBeenCalledWith({ theme: "dark" });
    expect(window.localStorage.getItem("telo:theme")).toBe("dark");
  });
});
