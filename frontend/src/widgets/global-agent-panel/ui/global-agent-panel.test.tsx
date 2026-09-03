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
import { AGENT_OAUTH_PROVIDERS } from "../../../../../contracts/src/ipc";
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
    hasCredential: true,
    authKind: "api-key",
    accountLabel: null,
    configuredOAuthProviders: [...AGENT_OAUTH_PROVIDERS],
    canInspectWorkspace: true,
    temperature: 0.7,
    maxSteps: 4,
    historyLimit: 20,
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
    senderId: "peer-lev",
    senderAvatarUrl: null,
    body,
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-01-01T00:00:00.000Z",
    outgoing: false,
    status: "read",
  };
}

function installBrowserStubs(): void {
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
}

function resetStores(): ReturnType<typeof installTeloApiMock> {
  const telo = installTeloApiMock();
  telo.agent.listThreads.mockResolvedValue({
    threads: [],
    activeThreadId: null,
  });
  useAgentStore.setState({
    open: true,
    running: false,
    runFailed: false,
    lastRun: null,
    attachments: [],
    activity: null,
    messages: [],
    threads: [],
    threadId: null,
    configuration: null,
    suggestions: [],
  });
  useChatStore.setState({
    chats: [],
    messages: [],
    peerAvatars: {},
    activeChatId: null,
    activeFolderId: null,
    composerTarget: null,
    jumpTarget: null,
    loading: false,
  });
  telo.workspace.listChatMembers.mockResolvedValue([]);
  return telo;
}

describe("GlobalAgentPanel", () => {
  beforeAll(installBrowserStubs);
  beforeEach(resetStores);

  it("shows a loading state until the configuration arrives", () => {
    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.getByText("Loading")).toBeTruthy();
    expect(screen.queryByLabelText("Ask about this workspace…")).toBeNull();
  });

  it("blocks the composer and offers a settings recovery when no API key is set", async () => {
    useAgentStore.setState({
      configuration: configuration({ hasCredential: false }),
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

  it("renders assistant rows without an avatar", () => {
    useAgentStore.setState({
      configuration: configuration(),
      messages: [
        { id: "user-1", from: "user", body: "Hi" },
        { id: "assistant-1", from: "assistant", body: "Done" },
      ],
    });

    const { container } = render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(container.querySelector('[data-slot="message-avatar"]')).toBeNull();
  });

  it("holds the reply's place with a skeleton labelled by the live activity", () => {
    useAgentStore.setState({
      configuration: configuration(),
      running: true,
      activity: "Reading workspace",
      messages: [{ id: "user-1", from: "user", body: "Hi" }],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    const skeleton = screen.getByRole("status", { name: "Reading workspace" });
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
  });

  it("labels the skeleton with the default when no activity event has arrived", () => {
    useAgentStore.setState({
      configuration: configuration(),
      running: true,
      messages: [{ id: "user-1", from: "user", body: "Hi" }],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("status", { name: "Thinking" })).toBeTruthy();
  });

  it("replaces the skeleton with the reply once text streams", async () => {
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

    // The reveal is smoothed, so the full text lands a few frames later.
    expect(
      await screen.findByText("Partial answer", {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("drops the skeleton when the run finishes", () => {
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
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("never renders failure text, even from a persisted error row", () => {
    useAgentStore.setState({
      configuration: configuration(),
      messages: [
        { id: "user-1", from: "user", body: "Hi" },
        { id: "assistant-1", from: "assistant", body: "" },
        {
          id: "assistant-2",
          from: "assistant",
          body: "Please wait 11 seconds before repeating the action.",
          error: true,
        },
      ],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.getAllByLabelText("user message")).toHaveLength(1);
    expect(screen.queryAllByLabelText("assistant message")).toHaveLength(0);
    expect(screen.queryByText(/Please wait/)).toBeNull();
  });

  it("offers a quiet retry after a failed run and re-sends the last prompt", async () => {
    const telo = installTeloApiMock();
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: null,
    });
    telo.agent.run.mockResolvedValue(undefined);
    telo.agent.createThread.mockResolvedValue(
      threadDto({ threadId: "thread-1", messages: [] }),
    );
    useAgentStore.setState({
      configuration: configuration(),
      runFailed: true,
      lastRun: {
        kind: "prompt",
        prompt: "What did I miss?",
        context: {
          activeChat: null,
          visibleChats: [],
          visibleMessages: [],
          components: [],
        },
        scope: { scope: "unread", chatId: "design" },
      },
      messages: [{ id: "user-1", from: "user", body: "What did I miss?" }],
    });
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    expect(screen.getByText("Couldn't finish this reply.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await vi.waitFor(() => {
      expect(telo.agent.run).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "What did I miss?",
          scope: { scope: "unread", chatId: "design" },
        }),
      );
    });
    // The retried question appears once, not twice.
    expect(screen.getAllByText("What did I miss?")).toHaveLength(1);
    expect(screen.queryByText("Couldn't finish this reply.")).toBeNull();
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

describe("GlobalAgentPanel suggestions and citations", () => {
  beforeAll(installBrowserStubs);
  beforeEach(resetStores);

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

  it("runs the unread summary from a suggestion pill above the composer", async () => {
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
    const pills = screen.getByRole("list", { name: "Suggested prompts" });
    const pill = screen.getByRole("button", { name: "Summarize unread" });
    expect(pills.contains(pill)).toBe(true);
    await user.click(pill);

    expect(telo.agent.runChatSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "design",
        chatTitle: "Telo Design",
        promptLabel: "Summarize unread",
      }),
    );
  });

  it("runs the extraction from a suggestion pill", async () => {
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

  it("shows no suggestions when nothing unread has text", () => {
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
      screen.queryByRole("list", { name: "Suggested prompts" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Summarize unread" }),
    ).toBeNull();
  });

  it("shows no chrome for payload previews, scopes, or audit records", async () => {
    const telo = installTeloApiMock();
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: null,
    });
    useAgentStore.setState({ configuration: configuration() });
    unreadDesignChat();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    await vi.waitFor(() => {
      expect(telo.agent.listThreads).toHaveBeenCalled();
    });

    expect(telo.agent.previewContext).not.toHaveBeenCalled();
    expect(telo.agent.listAuditRecords).not.toHaveBeenCalled();
    expect(screen.queryByText("Payload preview")).toBeNull();
    expect(screen.queryByText("Recent runs")).toBeNull();
    expect(screen.queryByText("Context scope")).toBeNull();
  });

  it("renders in-app message links as numbered citation marks", () => {
    useAgentStore.setState({
      configuration: configuration(),
      messages: [
        { id: "u-1", from: "user", body: "Summarize unread" },
        {
          id: "a-1",
          from: "assistant",
          body: "Demo summary of 2 messages.\n- Lev shipped. telo://message/design/design-4\n- Priya waited. telo://message/design/design-5",
        },
      ],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    const conversation = screen.getByRole("region", {
      name: "Agent conversation",
    });
    // The links leave the prose and become marks that carry the same href,
    // so the app-level telo:// handler can route the click.
    expect(conversation.textContent).not.toContain("telo://");
    const first = screen.getByRole("link", { name: "Scroll to message 1" });
    expect(first.getAttribute("href")).toBe("telo://message/design/design-4");
    expect(first.textContent).toBe("1");
    expect(
      screen
        .getByRole("link", { name: "Scroll to message 2" })
        .getAttribute("href"),
    ).toBe("telo://message/design/design-5");
  });

  it("renders @Name as a chip with the peer's photo for known people", () => {
    useAgentStore.setState({
      configuration: configuration(),
      messages: [
        {
          id: "a-1",
          from: "assistant",
          body: "@Lev agreed, @Stranger did not.",
        },
      ],
    });
    useChatStore.setState({
      chats: [chat({ id: "design", title: "Telo Design" })],
      messages: [
        { ...message("design-4"), senderAvatarUrl: "telo-media://lev" },
      ],
      activeChatId: "design",
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    const conversation = screen.getByRole("region", {
      name: "Agent conversation",
    });
    const chip = conversation.querySelector("span.rounded-md");
    expect(chip?.textContent).toBe("@Lev");
    expect(chip?.querySelector("img")?.getAttribute("src")).toBe(
      "telo-media://lev",
    );
    // Unknown names stay plain text.
    expect(conversation.textContent).toContain("@Stranger did not.");
  });

  it("offers the model's follow-ups as pills and runs the picked one", async () => {
    const telo = installTeloApiMock();
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: null,
    });
    telo.agent.createThread.mockResolvedValue(
      threadDto({ threadId: "thread-1", messages: [] }),
    );
    telo.agent.run.mockResolvedValue(undefined);
    useAgentStore.setState({
      configuration: configuration(),
      messages: [
        { id: "u-1", from: "user", body: "Summarize unread" },
        { id: "a-1", from: "assistant", body: "Done." },
      ],
      suggestions: ["Who is waiting on me?", "Draft a reply"],
    });
    unreadDesignChat();
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);

    // After the first reply the chat actions give way to the follow-ups.
    expect(
      screen.queryByRole("button", { name: "Summarize unread" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Who is waiting on me?" }),
    );

    expect(telo.agent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Who is waiting on me?",
        scope: { scope: "unread", chatId: "design" },
      }),
    );
  });

  it("shows the jump-to-latest button only once the transcript is scrolled up", async () => {
    useAgentStore.setState({
      configuration: configuration(),
      messages: [{ id: "a-1", from: "assistant", body: "Done." }],
    });

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "Jump to latest messages" }),
    ).toBeNull();

    const viewport = screen.getByRole("region", {
      name: "Agent conversation",
    });
    Object.defineProperty(viewport, "scrollHeight", { value: 1000 });
    Object.defineProperty(viewport, "clientHeight", { value: 300 });
    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll"));

    const jump = await screen.findByRole("button", {
      name: "Jump to latest messages",
    });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    await userEvent.setup().click(jump);
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 1000 }),
    );
  });
});

describe("GlobalAgentPanel @mentions in the composer", () => {
  let telo: ReturnType<typeof installTeloApiMock>;

  beforeAll(installBrowserStubs);
  beforeEach(() => {
    telo = resetStores();
    telo.workspace.listChatMembers.mockResolvedValue([
      {
        id: "peer-mina",
        displayName: "Mina Park",
        username: "mina",
        avatarDataUrl: "telo-media://mina",
      },
    ]);
    telo.agent.createThread.mockResolvedValue(
      threadDto({ threadId: "thread-1", messages: [] }),
    );
    telo.agent.run.mockResolvedValue(undefined);
    useAgentStore.setState({ configuration: configuration() });
    useChatStore.setState({
      chats: [chat({ id: "design", title: "Telo Design" })],
      messages: [message("design-4")],
      activeChatId: "design",
    });
  });

  it("completes members and authors with their photos and inserts the display name", async () => {
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    await vi.waitFor(() => {
      expect(telo.workspace.listChatMembers).toHaveBeenCalledWith("design");
    });
    const composer = screen.getByLabelText("Ask about this workspace…");
    await user.type(composer, "Ask @mi");

    const listbox = screen.getByRole("listbox", { name: "Mentions" });
    const option = screen.getByRole("option", { name: "Mina Park, @mina" });
    expect(listbox.contains(option)).toBe(true);
    expect(option.querySelector("img")?.getAttribute("src")).toBe(
      "telo-media://mina",
    );
    expect(composer.getAttribute("aria-activedescendant")).toBe(option.id);

    await user.keyboard("{Enter}");

    expect(composer).toHaveProperty("value", "Ask @Mina Park ");
    expect(screen.queryByRole("listbox", { name: "Mentions" })).toBeNull();
    // Enter completed the mention rather than sending the prompt.
    expect(telo.agent.run).not.toHaveBeenCalled();
  });

  it("matches display names across a space and offers chats too", async () => {
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    await user.type(
      screen.getByLabelText("Ask about this workspace…"),
      "@telo des",
    );

    expect(screen.getByRole("option", { name: "Telo Design" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Lev/ })).toBeNull();
  });

  it("closes the list when nothing matches and lets Escape dismiss it", async () => {
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    const composer = screen.getByLabelText("Ask about this workspace…");
    await user.type(composer, "@zzz");
    expect(screen.queryByRole("listbox", { name: "Mentions" })).toBeNull();

    await user.clear(composer);
    await user.type(composer, "@Le");
    expect(screen.getByRole("option", { name: "Lev" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Mentions" })).toBeNull();
    await user.keyboard("v");
    expect(screen.queryByRole("listbox", { name: "Mentions" })).toBeNull();
  });
});

describe("GlobalAgentPanel run scope", () => {
  let telo: ReturnType<typeof installTeloApiMock>;

  beforeAll(installBrowserStubs);
  beforeEach(() => {
    telo = resetStores();
    telo.agent.createThread.mockResolvedValue(
      threadDto({ threadId: "thread-1", messages: [] }),
    );
    telo.agent.run.mockResolvedValue(undefined);
    useAgentStore.setState({ configuration: configuration() });
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
    });
  });

  it("reads the open chat's unread tail by default", async () => {
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

  it("widens to the folder's unread messages when no chat is open", async () => {
    useChatStore.setState({ activeChatId: null, activeFolderId: 3 });
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    await user.type(
      screen.getByLabelText("Ask about this workspace…"),
      "Anything new?",
    );
    await user.keyboard("{Enter}");

    await vi.waitFor(() => {
      expect(telo.agent.run).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { scope: "folder", folderId: 3 } }),
      );
    });
  });

  it("shows added messages as cards in the composer and sends them as the selected scope", async () => {
    useAgentStore.getState().attachMessages([
      {
        chatId: "design",
        chatTitle: "Telo Design",
        messageId: "design-4",
        senderName: "Lev",
        body: "Ship the retry flow.",
      },
      {
        chatId: "design",
        chatTitle: "Telo Design",
        messageId: "design-5",
        senderName: "Mina",
        body: "And the divider.",
      },
    ]);
    const user = userEvent.setup();

    render(<GlobalAgentPanel onOpenSettings={vi.fn()} />);
    const cards = screen.getByRole("list", {
      name: "Messages added to the conversation",
    });
    expect(cards.textContent).toContain("Lev");
    expect(cards.textContent).toContain("Ship the retry flow.");
    // Suggestions step aside while the question is about specific messages.
    expect(
      screen.queryByRole("list", { name: "Suggested prompts" }),
    ).toBeNull();

    // Removing a card narrows the scope to the remaining one.
    await user.click(
      screen.getAllByRole("button", { name: "Remove message" })[1]!,
    );
    await user.type(
      screen.getByLabelText("Ask about this workspace…"),
      "Summarize these",
    );
    await user.keyboard("{Enter}");

    await vi.waitFor(() => {
      expect(telo.agent.run).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: {
            scope: "selected",
            chatId: "design",
            messageIds: ["design-4"],
          },
        }),
      );
    });
    // The cards were consumed by the run.
    expect(useAgentStore.getState().attachments).toEqual([]);
  });
});
