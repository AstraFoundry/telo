import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentConfigurationDto,
  AgentThreadDto,
} from "../../../../../contracts/src/ipc";
import { useAgentStore } from "../../../entities/agent";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

import { GlobalAgentPanel } from "./global-agent-panel";

function configuration(
  partial: Partial<AgentConfigurationDto> = {},
): AgentConfigurationDto {
  return {
    provider: "openai",
    model: "gpt-4.1-mini",
    baseUrl: null,
    instructions: "",
    hasApiKey: true,
    canInspectWorkspace: true,
    ...partial,
  };
}

function threadDto(partial: Partial<AgentThreadDto> = {}): AgentThreadDto {
  return {
    threadId: "thread-1",
    title: "Summarize",
    updatedAt: "2026-08-27T12:00:00.000Z",
    messages: [],
    ...partial,
  };
}

describe("GlobalAgentPanel", () => {
  beforeAll(() => {
    // jsdom does not implement matchMedia, which motion's useReducedMotion needs.
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

  beforeEach(() => {
    const telo = installTeloApiMock();
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: null,
    });
    useAgentStore.setState({
      open: true,
      running: false,
      activity: null,
      messages: [],
      threads: [],
      threadId: null,
      configuration: null,
    });
  });

  it("shows a loading state until the configuration arrives", () => {
    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.getByText("Loading")).toBeTruthy();
    expect(screen.queryByLabelText("Ask about this workspace…")).toBeNull();
  });

  it("blocks the composer and offers a settings recovery when no API key is set", async () => {
    useAgentStore.setState({
      configuration: configuration({ hasApiKey: false }),
    });
    const onOpenSettings = vi.fn();
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={onOpenSettings} />);

    expect(screen.getByText("Connect an AI provider")).toBeTruthy();
    expect(screen.queryByLabelText("Ask about this workspace…")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Open Agent settings" }),
    );
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("renders the conversation composer once an API key is configured", () => {
    useAgentStore.setState({ configuration: configuration() });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.getByLabelText("Ask about this workspace…")).toBeTruthy();
    expect(screen.queryByText("Connect an AI provider")).toBeNull();
  });

  it("shows the live activity while the run has not streamed text yet", () => {
    useAgentStore.setState({
      configuration: configuration(),
      running: true,
      activity: "Reading workspace",
      messages: [{ id: "user-1", from: "user", body: "Hi" }],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("Working");
    expect(screen.getByText("Reading workspace")).toBeTruthy();
  });

  it("shows the default working label when no activity event has arrived", () => {
    useAgentStore.setState({
      configuration: configuration(),
      running: true,
      messages: [{ id: "user-1", from: "user", body: "Hi" }],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("Working");
  });

  it("hides the activity row once the response starts streaming", () => {
    useAgentStore.setState({
      configuration: configuration(),
      running: true,
      activity: "Reading workspace",
      messages: [
        { id: "user-1", from: "user", body: "Hi" },
        { id: "assistant-1", from: "assistant", body: "Partial answer" },
      ],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.getByText("Partial answer")).toBeTruthy();
    expect(screen.queryByText("Reading workspace")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("drops the activity row when the run finishes", () => {
    useAgentStore.setState({
      configuration: configuration(),
      running: false,
      activity: null,
      messages: [
        { id: "user-1", from: "user", body: "Hi" },
        { id: "assistant-1", from: "assistant", body: "Done" },
      ],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Working")).toBeNull();
  });

  it("skips the empty assistant shell left behind by a failed run", () => {
    // TEXT_MESSAGE_START mints an empty assistant message; when the run then
    // fails without text, only the error row may render.
    useAgentStore.setState({
      configuration: configuration(),
      running: false,
      activity: null,
      messages: [
        { id: "user-1", from: "user", body: "Hi" },
        { id: "assistant-1", from: "assistant", body: "" },
        {
          id: "assistant-2",
          from: "assistant",
          body: "The agent request failed.",
          error: true,
        },
      ],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.getAllByLabelText("assistant message")).toHaveLength(1);
    expect(screen.getByText("The agent request failed.")).toBeTruthy();
  });

  it("renders an error message without copy or feedback actions", () => {
    useAgentStore.setState({
      configuration: configuration(),
      running: false,
      activity: null,
      messages: [
        { id: "user-1", from: "user", body: "Hi" },
        {
          id: "assistant-1",
          from: "assistant",
          body: "The agent request failed.",
          error: true,
        },
      ],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.getByText("The agent request failed.")).toBeTruthy();
    expect(screen.queryByLabelText("Copy response")).toBeNull();
    expect(screen.queryByLabelText("Helpful")).toBeNull();
    expect(screen.queryByLabelText("Not helpful")).toBeNull();
  });

  it("starts a new conversation from the header", async () => {
    const telo = installTeloApiMock();
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: null,
    });
    telo.agent.createThread.mockResolvedValue(
      threadDto({ threadId: "thread-2", title: "" }),
    );
    useAgentStore.setState({ configuration: configuration() });
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "New conversation" }));

    expect(telo.agent.createThread).toHaveBeenCalledTimes(1);
    expect(useAgentStore.getState().threadId).toBe("thread-2");
  });

  it("lists stored threads in the history menu and switches on selection", async () => {
    const telo = installTeloApiMock();
    // The widget loads the thread list on mount; the IPC mock is the source.
    telo.agent.listThreads.mockResolvedValue({
      threads: [
        {
          threadId: "thread-1",
          title: "Summarize",
          updatedAt: "2026-08-27T12:00:00.000Z",
        },
        {
          threadId: "thread-0",
          title: "",
          updatedAt: "2026-08-27T11:00:00.000Z",
        },
      ],
      activeThreadId: null,
    });
    telo.agent.selectThread.mockResolvedValue(threadDto());
    useAgentStore.setState({ configuration: configuration() });
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    await user.click(
      screen.getByRole("button", { name: "Conversation history" }),
    );

    const menu = await screen.findByRole("dialog");
    await vi.waitFor(() => {
      expect(menu.textContent).toContain("Summarize");
    });
    // A thread without messages falls back to the new-conversation label.
    expect(menu.textContent).toContain("New conversation");

    await user.click(screen.getByRole("button", { name: "Summarize" }));

    expect(telo.agent.selectThread).toHaveBeenCalledWith("thread-1");
    expect(useAgentStore.getState().threadId).toBe("thread-1");
  });

  it("reports an empty history when no threads are stored", async () => {
    const telo = installTeloApiMock();
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: null,
    });
    useAgentStore.setState({ configuration: configuration() });
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    await user.click(
      screen.getByRole("button", { name: "Conversation history" }),
    );

    expect((await screen.findByRole("dialog")).textContent).toContain(
      "No conversations yet",
    );
  });

  it("disables the session controls while a run is active", () => {
    useAgentStore.setState({
      configuration: configuration(),
      running: true,
      messages: [{ id: "user-1", from: "user", body: "Hi" }],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "New conversation" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Conversation history" }),
    ).toHaveProperty("disabled", true);
  });
});
