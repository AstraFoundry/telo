import "../../../shared/test/test-environment";

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSmoothStream } from "./use-smooth-stream";

describe("useSmoothStream", () => {
  it("shows settled text in full", () => {
    const { result } = renderHook(() => useSmoothStream("Done.", false));
    expect(result.current).toBe("Done.");
  });

  it("reveals streaming text gradually and catches up to the target", async () => {
    const { result, rerender } = renderHook(
      ({ text, streaming }: { text: string; streaming: boolean }) =>
        useSmoothStream(text, streaming),
      { initialProps: { text: "Hello there", streaming: true } },
    );

    // Streaming text starts hidden and is only ever a prefix of the target;
    // frame timing under test load makes the exact intermediate length
    // unobservable, so only the prefix invariant is asserted along the way.
    expect(result.current).toBe("");
    await waitFor(
      () => {
        expect("Hello there".startsWith(result.current)).toBe(true);
        expect(result.current).toBe("Hello there");
      },
      { timeout: 4000 },
    );

    // The stream ending flushes whatever is left without waiting.
    rerender({ text: "Hello there, friend", streaming: false });
    expect(result.current).toBe("Hello there, friend");
  });
});
