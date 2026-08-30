import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { clampColumnWidth, useNarrowWorkspace } from "./layout";

describe("clampColumnWidth", () => {
  it("keeps widths inside the bounds", () => {
    expect(clampColumnWidth(320, 200, 480)).toBe(320);
  });

  it("clamps to the minimum and maximum", () => {
    expect(clampColumnWidth(100, 200, 480)).toBe(200);
    expect(clampColumnWidth(900, 200, 480)).toBe(480);
  });

  it("rounds to whole pixels", () => {
    expect(clampColumnWidth(320.6, 200, 480)).toBe(321);
  });
});

describe("useNarrowWorkspace", () => {
  function stubMatchMedia(initialMatches: boolean) {
    // jsdom does not implement matchMedia; the hook queries it for the narrow
    // breakpoint. This stub lets the test flip the match state and notify the
    // registered change listeners.
    let matches = initialMatches;
    const listeners = new Set<() => void>();
    window.matchMedia = ((query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        listeners.delete(listener),
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    return {
      setMatches(next: boolean) {
        matches = next;
        act(() => listeners.forEach((listener) => listener()));
      },
    };
  }

  it("reads the current match state on mount", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useNarrowWorkspace());
    expect(result.current).toBe(true);
  });

  it("follows breakpoint changes through the media query listener", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useNarrowWorkspace());
    expect(result.current).toBe(false);

    media.setMatches(true);
    expect(result.current).toBe(true);

    media.setMatches(false);
    expect(result.current).toBe(false);
  });
});
