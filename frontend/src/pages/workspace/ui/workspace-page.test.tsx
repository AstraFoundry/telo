import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentStore } from "../../../entities/agent";
import { useChatProfileStore, useChatStore } from "../../../entities/chat";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

import type { WorkspacePage as WorkspacePageComponent } from "./workspace-page";

function stubMatchMedia(matches: boolean): void {
  // jsdom does not implement matchMedia, which the preferences slice, the
  // narrow-workspace hook, and motion's useReducedMotion need.
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("WorkspacePage", () => {
  let WorkspacePage: typeof WorkspacePageComponent;

  beforeAll(() => {
    stubMatchMedia(false);
    // jsdom does not implement ResizeObserver, which the popover positioning
    // hook uses to re-measure the trigger and panel.
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
    // jsdom does not implement pointer capture, which the column resize
    // handle uses to keep tracking the drag outside its bounds.
    window.HTMLElement.prototype.setPointerCapture = () => {};
    window.HTMLElement.prototype.releasePointerCapture = () => {};
  });

  beforeEach(async () => {
    stubMatchMedia(false);
    const telo = installTeloApiMock();
    telo.preferences.update.mockResolvedValue(await telo.preferences.get());
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: null,
    });
    useAgentStore.setState({
      open: false,
      running: false,
      activity: null,
      messages: [],
      threads: [],
      threadId: null,
      configuration: null,
    });
    useChatStore.setState({
      chats: [],
      messages: [],
      activeChatId: null,
      loading: false,
    });
    useChatProfileStore.setState({ open: false });
    // The preferences slice reads window.telo at module scope through the
    // sidebar's import chain, so the page module is imported only after the
    // mock is installed.
    ({ WorkspacePage } = await import("./workspace-page"));
  });

  function renderPage(showBackToChats = false) {
    return render(
      <WorkspacePage
        onOpenSettings={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSelectChat={vi.fn()}
        showBackToChats={showBackToChats}
      >
        <main>Conversation surface</main>
      </WorkspacePage>,
    );
  }

  it("offers a skip-to-content link that targets the main surface", async () => {
    const user = userEvent.setup();
    renderPage();

    const link = screen.getByRole("link", { name: copy.skipToContent });
    // Visually hidden until focused.
    expect(link.className).toContain("sr-only");
    expect(link.className).toContain("focus:not-sr-only");
    // First tab stop of the workspace.
    await user.tab();
    expect(document.activeElement).toBe(link);
    // The anchor resolves to the wrapper around the central surface.
    expect(link.getAttribute("href")).toBe("#main");
    const target = document.getElementById("main");
    expect(target).not.toBeNull();
    expect(target?.textContent).toContain("Conversation surface");
    expect(target?.parentElement?.className).toContain(
      "grid-rows-[minmax(0,1fr)]",
    );
    expect(target?.className).toContain("min-h-0");
  });

  it("exposes a separator between the chat list and the conversation", () => {
    renderPage();

    const separator = screen.getByRole("separator", {
      name: copy.resizeChatList,
    });
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-valuenow")).toBe("280");
  });

  it("nudges the chat list width from the keyboard and persists it", async () => {
    const user = userEvent.setup();
    renderPage();

    const separator = screen.getByRole("separator", {
      name: copy.resizeChatList,
    });
    separator.focus();
    await user.keyboard("{ArrowRight}");

    expect(separator.getAttribute("aria-valuenow")).toBe("296");
    expect(window.telo.preferences.update).toHaveBeenCalledWith({
      sidebarWidth: 296,
    });
  });

  it("resets the chat list width to the default on double-click", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.dblClick(
      screen.getByRole("separator", { name: copy.resizeChatList }),
    );

    expect(window.telo.preferences.update).toHaveBeenCalledWith({
      sidebarWidth: 280,
    });
  });

  it("keeps the right column resizable when the profile replaces the agent", () => {
    useChatProfileStore.setState({ open: true });
    renderPage();

    // One column, one handle: both panels read the same width, so the drag
    // target cannot depend on which of them happens to be in the slot.
    const separator = screen.getByRole("separator", {
      name: copy.resizeAgentPanel,
    });
    expect(separator.getAttribute("aria-valuenow")).toBe("380");
  });

  it("keeps one animated shell mounted for every right-side panel", () => {
    const { container } = renderPage();
    const shell = container.querySelector<HTMLElement>('[data-slot="sidebar"]');

    expect(shell).not.toBeNull();
    expect(shell?.dataset.state).toBe("collapsed");

    act(() => useAgentStore.getState().openPanel());
    expect(container.querySelector('[data-slot="sidebar"]')).toBe(shell);
    expect(shell?.dataset.state).toBe("expanded");
    expect(shell?.getAttribute("aria-label")).toBe(copy.agent);

    act(() => useChatProfileStore.getState().openPanel());
    expect(container.querySelector('[data-slot="sidebar"]')).toBe(shell);
    expect(shell?.dataset.state).toBe("expanded");
    expect(shell?.getAttribute("aria-label")).toBe(copy.chatProfile);

    act(() => useChatProfileStore.getState().closePanel());
    expect(container.querySelector('[data-slot="sidebar"]')).toBe(shell);
    expect(shell?.dataset.state).toBe("collapsed");
    expect(shell?.hasAttribute("inert")).toBe(true);
  });

  it("collapses to a list ↔ conversation column at the narrow breakpoint", async () => {
    const user = userEvent.setup();
    stubMatchMedia(true);
    useChatStore.setState({ activeChatId: "chat-1" });
    renderPage(true);

    // A chat is active, so the conversation wins and the list stays away.
    expect(screen.queryByText("Conversation surface")).not.toBeNull();
    expect(screen.queryByRole("navigation", { name: copy.chats })).toBeNull();

    await user.click(screen.getByRole("button", { name: copy.backToChats }));

    expect(
      screen.queryByRole("navigation", { name: copy.chats }),
    ).not.toBeNull();
    expect(screen.queryByText("Conversation surface")).toBeNull();
  });

  it("keeps frameless window controls next to the back control on the narrow conversation", () => {
    window.telo.shell.frameless = true;
    stubMatchMedia(true);
    useChatStore.setState({ activeChatId: "chat-1" });
    renderPage(true);

    const back = screen.getByRole("button", { name: copy.backToChats });
    const close = screen.getByRole("button", { name: copy.windowClose });
    expect(back.parentElement?.contains(close)).toBe(true);
    expect(
      close.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
