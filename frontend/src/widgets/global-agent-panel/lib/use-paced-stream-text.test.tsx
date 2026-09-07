import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePacedStreamText } from "./use-paced-stream-text";

describe("usePacedStreamText", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let now: number;

  const runFrames = (at: number) =>
    act(() => {
      now = at;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(at));
    });

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    now = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("trails the received text and catches up over frames", () => {
    const { result, rerender } = renderHook(
      ({ value, active }) => usePacedStreamText(value, active),
      { initialProps: { value: "", active: true } },
    );

    rerender({ value: "Hello world", active: true });
    expect(result.current).toBe("");
    expect(frames.size).toBe(1);

    runFrames(0);
    expect(result.current).toBe("H");

    runFrames(1000);
    expect(result.current.length).toBeGreaterThan(1);
    expect("Hello world".startsWith(result.current)).toBe(true);
  });

  it("returns the final value immediately when streaming completes", () => {
    const { result, rerender } = renderHook(
      ({ value, active }) => usePacedStreamText(value, active),
      { initialProps: { value: "", active: true } },
    );

    rerender({ value: "unfinished", active: true });
    rerender({ value: "finished", active: false });

    expect(result.current).toBe("finished");
    expect(frames.size).toBe(0);
  });

  it("stops scheduling frames once the backlog is drained", () => {
    const { result, rerender } = renderHook(
      ({ value, active }) => usePacedStreamText(value, active),
      { initialProps: { value: "", active: true } },
    );

    rerender({ value: "ab", active: true });
    runFrames(0);
    runFrames(100);
    expect(result.current).toBe("ab");
    expect(frames.size).toBe(0);
  });
});
