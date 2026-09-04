import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFrameCoalescedValue } from "./use-frame-coalesced-value";

describe("useFrameCoalescedValue", () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  beforeEach(() => {
    callbacks = new Map();
    nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      callbacks.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("commits only the newest streamed value once per frame", () => {
    const { result, rerender } = renderHook(
      ({ value, active }) => useFrameCoalescedValue(value, active),
      { initialProps: { value: "A", active: true } },
    );

    rerender({ value: "AB", active: true });
    rerender({ value: "ABC", active: true });

    expect(result.current).toBe("A");
    expect(callbacks).toHaveLength(1);

    act(() => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(16));
    });

    expect(result.current).toBe("ABC");
  });

  it("returns the final value immediately when streaming completes", () => {
    const { result, rerender } = renderHook(
      ({ value, active }) => useFrameCoalescedValue(value, active),
      { initialProps: { value: "A", active: true } },
    );

    rerender({ value: "unfinished", active: true });
    rerender({ value: "finished", active: false });

    expect(result.current).toBe("finished");
    expect(callbacks).toHaveLength(0);
  });
});
