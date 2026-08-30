// The preferences slice reads matchMedia and window.telo at module scope;
// this prelude installs both before the panel imports evaluate.
import "../../../shared/test/test-environment";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentConfigurationDto,
  AgentThreadDto,
  ChatDto,
  MessageDto,
} from "../../../../../contracts/src/ipc";
import { useAgentStore } from "../../../entities/agent";
import { useChatStore } from "../../../entities/chat";
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
      runChatId: null,
    });
    useChatStore.setState({
      chats: [],
      messages: [],
      activeChatId: null,
      jumpTarget: null,
      loading: false,
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

function chat(partial: Partial<ChatDto> & Pick<ChatDto, "id" | "title">) {
  return {
    preview: "",
    updatedAt: "2026-01-01T10:00:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "direct",
    initials: "AB",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    ...partial,
  } satisfies ChatDto;
}

function message(id: string, body = `Message ${id}`): MessageDto {
  return {
    id,
    chatId: "design",
    senderName: "Lev",
    body,
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-01-01T00:00:00.000Z",
    outgoing: false,
    status: "read",
  };
}

describe("GlobalAgentPanel chat actions and citations", () => {
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
      runChatId: null,
    });
    useChatStore.setState({
      chats: [],
      messages: [],
      activeChatId: null,
      jumpTarget: null,
      loading: false,
    });
  });

  function unreadDesignChat(): void {
    useChatStore.setState({
      chats: [
        chat({
          id: "design",
          title: "Telo Design",
          unreadCount: 2,
          lastReadMessageId: "design-3",
        }),
      ],
      messages: [
        message("design-1"),
        message("design-3"),
        message("design-4"),
        message("design-5"),
      ],
      activeChatId: "design",
    });
  }

  it("runs the unread summary from the action row", async () => {
    const telo = installTeloApiMock();
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: null,
    });
    telo.agent.createThread.mockResolvedValue(
      threadDto({ threadId: "thread-1", messages: [] }),
    );
    telo.agent.runChatSummary.mockResolvedValue(undefined);
    useAgentStore.setState({ configuration: configuration() });
    unreadDesignChat();
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Summarize unread" }));

    expect(telo.agent.runChatSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "design",
        chatTitle: "Telo Design",
        promptLabel: "Summarize unread",
      }),
    );
  });

  it("runs the extraction from the action row", async () => {
    const telo = installTeloApiMock();
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: null,
    });
    telo.agent.createThread.mockResolvedValue(
      threadDto({ threadId: "thread-1", messages: [] }),
    );
    telo.agent.runChatExtraction.mockResolvedValue(undefined);
    useAgentStore.setState({ configuration: configuration() });
    unreadDesignChat();
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    await user.click(
      screen.getByRole("button", { name: "Extract decisions & todos" }),
    );

    expect(telo.agent.runChatExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "design" }),
    );
  });

  it("disables the chat actions when nothing unread has text", () => {
    useAgentStore.setState({ configuration: configuration() });
    useChatStore.setState({
      chats: [
        chat({ id: "saved", title: "Saved Messages", lastReadMessageId: "m1" }),
      ],
      messages: [message("m1")],
      activeChatId: "saved",
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Summarize unread" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Extract decisions & todos" }),
    ).toHaveProperty("disabled", true);
  });

  it("renders citation chips and requests the jump to the cited message", async () => {
    useAgentStore.setState({
      configuration: configuration(),
      messages: [
        { id: "u-1", from: "user", body: "Summarize unread" },
        {
          id: "a-1",
          from: "assistant",
          body: "Demo summary of 2 messages.\n[[telo-cite:design-4]]\n[[telo-cite:design-5]]",
          chatId: "design",
        },
      ],
    });
    useChatStore.setState({
      chats: [chat({ id: "design", title: "Telo Design" })],
      activeChatId: "design",
    });
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    // The markers leave the text; the ids become numbered chips.
    expect(screen.getByText("Demo summary of 2 messages.")).toBeTruthy();
    const citations = screen.getByRole("list", { name: "Cited messages" });
    expect(citations.textContent).not.toContain("[[telo-cite:");

    await user.click(
      screen.getByRole("button", { name: "Scroll to message 1" }),
    );

    expect(useChatStore.getState().jumpTarget).toMatchObject({
      chatId: "design",
      messageId: "design-4",
    });
  });

  it("disables citation chips when the run's chat is unknown", () => {
    useAgentStore.setState({
      configuration: configuration(),
      messages: [
        {
          id: "a-1",
          from: "assistant",
          body: "Demo summary of 1 messages.\n[[telo-cite:design-4]]",
        },
      ],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Scroll to message 1" }),
    ).toHaveProperty("disabled", true);
  });
});

describe("GlobalAgentPanel scope controls", () => {
  let telo: ReturnType<typeof installTeloApiMock>;

  beforeEach(() => {
    telo = installTeloApiMock();
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
      configuration: configuration(),
      runChatId: null,
    });
    useChatStore.setState({
      chats: [
        chat({
          id: "design",
          title: "Telo Design",
          unreadCount: 2,
          lastReadMessageId: "design-3",
        }),
      ],
      messages: [message("design-4"), message("design-5")],
      activeChatId: "design",
      activeFolderId: null,
      composerTarget: null,
      jumpTarget: null,
      loading: false,
    });
  });

  it("defaults to the unread scope and previews the exact payload", async () => {
    telo.agent.previewContext.mockResolvedValue({
      scope: "unread",
      messages: [
        {
          messageId: "design-4",
          chatId: "design",
          chatTitle: "Telo Design",
          senderName: "Lev",
          body: "Ship the retry flow.",
          sentAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      redactionCounts: { emails: 1, phones: 0, tokens: 0 },
    });
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(
      screen
        .getByRole("button", { name: "Unread" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await vi.waitFor(() => {
      expect(telo.agent.previewContext).toHaveBeenCalledWith({
        scope: "unread",
        chatId: "design",
      });
    });

    await user.click(screen.getByRole("button", { name: "Payload preview" }));

    expect(await screen.findByText("Ship the retry flow.")).toBeTruthy();
    expect(screen.getByText("design-4")).toBeTruthy();
    expect(screen.getByText("Lev")).toBeTruthy();
    // The redaction pass ran main-side; the preview reports what was masked.
    expect(screen.getByText("1 redacted")).toBeTruthy();
  });

  it("switches the scope to the active folder", async () => {
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Folder" }));

    await vi.waitFor(() => {
      expect(telo.agent.previewContext).toHaveBeenCalledWith({
        scope: "folder",
        folderId: null,
      });
    });
  });

  it("disables the selected scope until a message is being replied to", async () => {
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Selected" })).toHaveProperty(
      "disabled",
      true,
    );

    useChatStore.setState({
      composerTarget: {
        mode: "reply",
        messageId: "design-4",
        preview: "Ship the retry flow.",
      },
    });
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Selected" })).toHaveProperty(
        "disabled",
        false,
      );
    });
    await user.click(screen.getByRole("button", { name: "Selected" }));

    await vi.waitFor(() => {
      expect(telo.agent.previewContext).toHaveBeenCalledWith({
        scope: "selected",
        chatId: "design",
        messageIds: ["design-4"],
      });
    });
  });

  it("sends the chosen scope with the run", async () => {
    telo.agent.createThread.mockResolvedValue(
      threadDto({ threadId: "thread-1", messages: [] }),
    );
    telo.agent.run.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    const composer = screen.getByLabelText("Ask about this workspace…");
    await user.type(composer, "What did I miss?");
    await user.keyboard("{Enter}");

    await vi.waitFor(() => {
      expect(telo.agent.run).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "What did I miss?",
          scope: { scope: "unread", chatId: "design" },
        }),
      );
    });
  });

  it("lists recent runs from the local audit log", async () => {
    telo.agent.listAuditRecords.mockResolvedValue([
      {
        id: "r1",
        timestamp: "2026-08-27T15:00:00.000Z",
        action: "run",
        threadId: "thread-1",
        scope: "folder",
        messageIds: ["design-4", "design-5"],
        redactionCounts: { emails: 0, phones: 2, tokens: 0 },
        model: "gpt-4.1-mini",
        promptHash: "deadbeef",
      },
    ]);
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Recent runs" }));

    expect(await screen.findByText(/Folder · 2/)).toBeTruthy();
    expect(screen.getByText(/2 redacted/)).toBeTruthy();
  });
});
