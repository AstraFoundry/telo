import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "entities/chat";

import { useTeloLinks } from "./telo-links";

function clickAnchor(href: string): MouseEvent {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.textContent = "1";
  document.body.append(anchor);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  anchor.remove();
  return event;
}

describe("useTeloLinks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes a telo://message link click into the jump-to-message flow", () => {
    const requestJumpToMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ requestJumpToMessage });
    const onNavigate = vi.fn();
    renderHook(() => useTeloLinks(onNavigate));

    const event = clickAnchor("telo://message/design/design-4");

    expect(event.defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(requestJumpToMessage).toHaveBeenCalledWith("design", "design-4");
  });

  it("leaves other links alone", () => {
    const requestJumpToMessage = vi.fn();
    useChatStore.setState({ requestJumpToMessage });
    renderHook(() => useTeloLinks(() => {}));
    // Registered after the hook, so it observes the hook's verdict and then
    // stops jsdom from attempting a real navigation.
    let preventedByHook: boolean | null = null;
    const observe = (event: MouseEvent) => {
      preventedByHook = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", observe);

    clickAnchor("https://example.com/");
    document.removeEventListener("click", observe);

    expect(preventedByHook).toBe(false);
    expect(requestJumpToMessage).not.toHaveBeenCalled();
  });
});
