import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentStore } from "../../../entities/agent";
import { useChatStore } from "../../../entities/chat";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

import type { WorkspacePage as WorkspacePageComponent } from "./workspace-page";

describe("WorkspacePage", () => {
  let WorkspacePage: typeof WorkspacePageComponent;

  beforeAll(() => {
    // jsdom does not implement matchMedia, which the preferences slice and
    // motion's useReducedMotion need.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    // jsdom does not implement ResizeObserver, which the popover positioning
    // hook uses to re-measure the trigger and panel.
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  beforeEach(async () => {
    const telo = installTeloApiMock();
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
    // The preferences slice reads window.telo at module scope through the
    // sidebar's import chain, so the page module is imported only after the
    // mock is installed.
    ({ WorkspacePage } = await import("./workspace-page"));
  });

  it("offers a skip-to-content link that targets the main surface", async () => {
    const user = userEvent.setup();
    render(
      <WorkspacePage onOpenSettings={vi.fn()} onSelectChat={vi.fn()}>
        <main>Conversation surface</main>
      </WorkspacePage>,
    );

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
  });
});
