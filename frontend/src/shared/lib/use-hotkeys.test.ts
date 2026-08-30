import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useHotkeys } from "./use-hotkeys";

function press(key: string, init: KeyboardEventInit = {}, target?: Element) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  (target ?? window).dispatchEvent(event);
  return event;
}

describe("useHotkeys", () => {
  it("fires the matching binding for a plain key", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([{ key: "r", handler }]));

    press("r");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire while typing in a field unless the binding allows it", () => {
    const plain = vi.fn();
    const allowed = vi.fn();
    renderHook(() =>
      useHotkeys([
        { key: "r", handler: plain },
        { key: "Escape", allowInInputs: true, handler: allowed },
      ]),
    );
    const input = document.createElement("textarea");
    document.body.appendChild(input);

    press("r", {}, input);
    expect(plain).not.toHaveBeenCalled();

    press("Escape", {}, input);
    expect(allowed).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("matches Cmd or Ctrl for metaOrCtrl bindings and skips bare presses", () => {
    const handler = vi.fn();
    renderHook(() =>
      useHotkeys([
        { key: "k", metaOrCtrl: true, allowInInputs: true, handler },
      ]),
    );

    press("k");
    expect(handler).not.toHaveBeenCalled();

    press("k", { metaKey: true });
    press("k", { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("ignores modifier-free bindings when Cmd or Ctrl is held", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([{ key: "r", handler }]));

    press("r", { metaKey: true });
    press("r", { ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips events another handler already claimed", () => {
    // The claiming listener is registered first (e.g. an open overlay), so it
    // runs before the hook's listener and marks the event as handled.
    window.addEventListener("keydown", (event) => event.preventDefault(), {
      once: true,
    });
    const handler = vi.fn();
    renderHook(() => useHotkeys([{ key: "Escape", handler }]));

    press("Escape");
    expect(handler).not.toHaveBeenCalled();
  });

  it("stops matching after the first matching binding", () => {
    const first = vi.fn();
    const second = vi.fn();
    renderHook(() =>
      useHotkeys([
        { key: "Delete", handler: first },
        { key: "Delete", handler: second },
      ]),
    );

    press("Delete");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
