import "@/shared/test/test-environment";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageScroller } from "./message-scroller";

describe("MessageScroller live-edge following", () => {
  let resize: ResizeObserverCallback;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushFrames(): void {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(16));
  }

  it("coalesces resize bursts and follows with an immediate scroll", () => {
    render(
      <MessageScroller label="Test conversation">
        <p>Growing output</p>
      </MessageScroller>,
    );
    const viewport = screen.getByRole("region", {
      name: "Test conversation",
    });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 500 },
    });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;

    act(flushFrames);
    scrollTo.mockClear();

    act(() => {
      resize([], {} as ResizeObserver);
      resize([], {} as ResizeObserver);
      resize([], {} as ResizeObserver);
    });
    expect(frames).toHaveLength(1);

    act(flushFrames);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 500, behavior: "auto" });
  });

  async function settleProgrammaticScroll() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("stays following when the viewport shrinks without a user gesture", async () => {
    const onFollowChange = vi.fn();
    render(
      <MessageScroller
        label="Test conversation"
        onFollowChange={onFollowChange}
      >
        <p>Growing output</p>
      </MessageScroller>,
    );
    const viewport = screen.getByRole("region", {
      name: "Test conversation",
    });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    act(flushFrames);
    await settleProgrammaticScroll();
    scrollTo.mockClear();
    onFollowChange.mockClear();
    fireEvent.scroll(viewport);

    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 120,
    });
    fireEvent.scroll(viewport);
    expect(onFollowChange).not.toHaveBeenCalledWith(false);

    act(() => resize([], {} as ResizeObserver));
    act(flushFrames);
    expect(scrollTo).toHaveBeenCalledWith({ top: 500, behavior: "auto" });
  });

  it("stops following when the reader drags the scrollbar", async () => {
    const onFollowChange = vi.fn();
    render(
      <MessageScroller
        label="Test conversation"
        onFollowChange={onFollowChange}
      >
        <p>Growing output</p>
      </MessageScroller>,
    );
    const viewport = screen.getByRole("region", {
      name: "Test conversation",
    });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 300 },
    });
    act(flushFrames);
    await settleProgrammaticScroll();
    fireEvent.scroll(viewport);
    onFollowChange.mockClear();

    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      writable: true,
      value: 40,
    });
    fireEvent.scroll(viewport);
    expect(onFollowChange).toHaveBeenCalledWith(false);
  });

  it("stops following as soon as the reader scrolls manually", () => {
    render(
      <MessageScroller label="Test conversation">
        <p>Growing output</p>
      </MessageScroller>,
    );
    const viewport = screen.getByRole("region", {
      name: "Test conversation",
    });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    act(flushFrames);
    scrollTo.mockClear();

    fireEvent.wheel(viewport, { deltaY: -1 });
    act(() => resize([], {} as ResizeObserver));
    act(flushFrames);

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
