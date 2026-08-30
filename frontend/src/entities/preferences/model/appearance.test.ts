import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserPreferencesDto } from "../../../../../contracts/src/ipc";
import {
  installTeloApiMock,
  type TeloApiMock,
} from "../../../shared/test/mock-telo";

function stubMatchMedia(dark: boolean): void {
  // jsdom does not implement matchMedia, which the theme model applies at
  // module scope when the hooks module is imported.
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

function preferences(
  partial: Partial<UserPreferencesDto> = {},
): UserPreferencesDto {
  return {
    agentPanelOpen: false,
    accentColor: "blue",
    messageTextSize: 14,
    timeFormat: "system",
    sendWithEnter: true,
    notificationsEnabled: true,
    sidebarWidth: 280,
    agentPanelWidth: 380,
    recentEmojis: [],
    messageTemplates: [],
    demoWorkspace: false,
    theme: "system",
    ...partial,
  };
}

const OVERRIDDEN_TOKENS = ["--primary", "--primary-foreground", "--ring"];

function clearDocumentTokens(): void {
  document.documentElement.classList.remove("dark");
  OVERRIDDEN_TOKENS.forEach((token) =>
    document.documentElement.style.removeProperty(token),
  );
  document.documentElement.style.removeProperty("--message-text-size");
}

async function importHooks() {
  return import("./hooks");
}

describe("appearance model", () => {
  let telo: TeloApiMock;

  beforeEach(() => {
    vi.resetModules();
    telo = installTeloApiMock();
    stubMatchMedia(false);
    clearDocumentTokens();
    telo.preferences.get.mockResolvedValue(preferences());
    telo.preferences.update.mockImplementation((input) =>
      Promise.resolve(preferences(input)),
    );
  });

  it("applies the persisted accent and text size once preferences resolve", async () => {
    telo.preferences.get.mockResolvedValue(
      preferences({ accentColor: "purple", messageTextSize: 16 }),
    );

    await importHooks();

    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
        "oklch(0.56 0.16 295)",
      );
    });
    expect(
      document.documentElement.style.getPropertyValue("--primary-foreground"),
    ).toBe("oklch(0.985 0 0)");
    expect(document.documentElement.style.getPropertyValue("--ring")).toBe(
      "oklch(0.61 0.14 295)",
    );
    expect(
      document.documentElement.style.getPropertyValue("--message-text-size"),
    ).toBe("16px");
  });

  it("follows the dark class with the dark token set", async () => {
    telo.preferences.get.mockResolvedValue(
      preferences({ accentColor: "green" }),
    );
    await importHooks();
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
        "oklch(0.56 0.16 145)",
      );
    });

    act(() => document.documentElement.classList.add("dark"));

    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
        "oklch(0.7 0.13 145)",
      );
    });
    expect(document.documentElement.style.getPropertyValue("--ring")).toBe(
      "oklch(0.7 0.13 145)",
    );
  });

  it("keeps blue on the stylesheet defaults by clearing inline overrides", async () => {
    telo.preferences.get.mockResolvedValue(
      preferences({ accentColor: "orange" }),
    );
    const { useAccentColor } = await importHooks();
    await vi.waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
        "oklch(0.56 0.16 60)",
      );
    });
    const { result } = renderHook(() => useAccentColor());

    act(() => result.current.select("blue"));

    expect(telo.preferences.update).toHaveBeenCalledWith({
      accentColor: "blue",
    });
    OVERRIDDEN_TOKENS.forEach((token) => {
      expect(document.documentElement.style.getPropertyValue(token)).toBe("");
    });
  });

  it("re-sources the persisted accent when the write fails", async () => {
    const { useAccentColor } = await importHooks();
    const { result } = renderHook(() => useAccentColor());
    // Flush the module-scope preference loads before the optimistic write.
    await act(async () => {});
    telo.preferences.update.mockRejectedValue(new Error("disk full"));
    telo.preferences.get.mockResolvedValue(
      preferences({ accentColor: "green" }),
    );

    act(() => result.current.select("red"));

    // Optimistic write applies immediately.
    expect(result.current.value).toBe("red");
    await vi.waitFor(() => {
      expect(result.current.value).toBe("green");
    });
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      "oklch(0.56 0.16 145)",
    );
  });

  it("persists the text size and applies the token optimistically", async () => {
    telo.preferences.get.mockResolvedValue(
      preferences({ messageTextSize: 16 }),
    );
    const { useMessageTextSize } = await importHooks();
    const { result } = renderHook(() => useMessageTextSize());
    await vi.waitFor(() => {
      expect(result.current.value).toBe(16);
    });

    act(() => result.current.select(18));

    expect(result.current.value).toBe(18);
    expect(
      document.documentElement.style.getPropertyValue("--message-text-size"),
    ).toBe("18px");
    expect(telo.preferences.update).toHaveBeenCalledWith({
      messageTextSize: 18,
    });
  });

  it("persists the time format choice", async () => {
    telo.preferences.get.mockResolvedValue(preferences({ timeFormat: "12h" }));
    const { useTimeFormat } = await importHooks();
    const { result } = renderHook(() => useTimeFormat());
    await vi.waitFor(() => {
      expect(result.current.value).toBe("12h");
    });

    act(() => result.current.select("24h"));

    expect(result.current.value).toBe("24h");
    expect(telo.preferences.update).toHaveBeenCalledWith({
      timeFormat: "24h",
    });
  });
});
