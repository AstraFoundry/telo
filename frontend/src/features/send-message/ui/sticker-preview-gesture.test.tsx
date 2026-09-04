import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StickerItemDto } from "../../../../../contracts/src/ipc";

import { StickerPreviewGesture } from "./sticker-preview-gesture";

const FIRST: StickerItemDto = {
  id: "sticker/1",
  emoji: "👋",
  format: "static",
  width: 512,
  height: 512,
  outlinePath: null,
};
const SECOND: StickerItemDto = {
  ...FIRST,
  id: "sticker/2",
  emoji: "🎉",
};

describe("StickerPreviewGesture", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("holds to preview, scrubs across cells, and releases without sending", () => {
    vi.useFakeTimers();
    const previews: Array<string | null> = [];
    const send = vi.fn();
    render(
      <StickerPreviewGesture
        stickers={[FIRST, SECOND]}
        onPreview={(sticker) => previews.push(sticker?.id ?? null)}
      >
        <div data-testid="grid">
          <button data-sticker-id={FIRST.id} onClick={send}>
            First
          </button>
          <button data-sticker-id={SECOND.id} onClick={send}>
            Second
          </button>
        </div>
      </StickerPreviewGesture>,
    );
    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [second]),
    });

    fireEvent.pointerDown(first, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(400));
    expect(previews).toEqual([FIRST.id]);

    fireEvent.pointerMove(screen.getByTestId("grid"), {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      clientX: 80,
      clientY: 10,
    });
    expect(previews).toEqual([FIRST.id, SECOND.id]);

    fireEvent.pointerUp(screen.getByTestId("grid"), {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      clientX: 80,
      clientY: 10,
    });
    fireEvent.click(first);
    expect(previews).toEqual([FIRST.id, SECOND.id, null]);
    expect(send).not.toHaveBeenCalled();

    fireEvent.click(first);
    expect(send).toHaveBeenCalledOnce();
  });

  it("turns movement before the hold threshold back into an ordinary drag", () => {
    vi.useFakeTimers();
    const onPreview = vi.fn();
    render(
      <StickerPreviewGesture stickers={[FIRST]} onPreview={onPreview}>
        <button data-sticker-id={FIRST.id}>First</button>
      </StickerPreviewGesture>,
    );
    const first = screen.getByRole("button", { name: "First" });

    fireEvent.pointerDown(first, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(first, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 30,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(500));

    expect(onPreview).not.toHaveBeenCalled();
  });
});
