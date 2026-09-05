import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type TeloApiMock,
  installTeloApiMock,
  testPreferences,
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

describe("send-with-enter model", () => {
  let telo: TeloApiMock;

  beforeEach(() => {
    vi.resetModules();
    telo = installTeloApiMock();
    stubMatchMedia(false);
    telo.preferences.get.mockResolvedValue(testPreferences());
    telo.preferences.update.mockImplementation((input) =>
      Promise.resolve(testPreferences(input)),
    );
  });

  it("publishes the persisted send-with-enter choice to subscribers", async () => {
    telo.preferences.get.mockResolvedValue(
      testPreferences({ sendWithEnter: false }),
    );
    const { useSendWithEnter } = await import("./hooks");
    const { result } = renderHook(() => useSendWithEnter());

    await vi.waitFor(() => {
      expect(result.current.value).toBe(false);
    });
  });

  it("persists the choice optimistically", async () => {
    const { useSendWithEnter } = await import("./hooks");
    const { result } = renderHook(() => useSendWithEnter());
    await vi.waitFor(() => {
      expect(result.current.value).toBe(true);
    });

    act(() => result.current.select(false));

    expect(result.current.value).toBe(false);
    expect(telo.preferences.update).toHaveBeenCalledWith({
      sendWithEnter: false,
    });
  });

  it("re-sources the persisted choice when the write fails", async () => {
    const { useSendWithEnter } = await import("./hooks");
    const { result } = renderHook(() => useSendWithEnter());
    await vi.waitFor(() => {
      expect(result.current.value).toBe(true);
    });
    telo.preferences.update.mockRejectedValue(new Error("disk full"));

    act(() => result.current.select(false));

    expect(result.current.value).toBe(false);
    await vi.waitFor(() => {
      expect(result.current.value).toBe(true);
    });
  });
});
