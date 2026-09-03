import { EventType, type AGUIEvent } from "@ag-ui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentConfigurationDto,
  AgentThreadDto,
  UiContextSnapshot,
  UserPreferencesDto,
} from "../../../../../contracts/src/ipc";
import {
  AGENT_OAUTH_PROVIDERS,
  AGENT_SUGGESTIONS_EVENT_NAME,
} from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

import { subscribeToAgentEvents, useAgentStore } from "./agent-store";

function resetAgentStore(): void {
  useAgentStore.setState({
    open: false,
    running: true,
    activity: "Drafting",
    messages: [],
    threads: [],
    threadId: null,
    configuration: null,
    notificationsEnabled: false,
  });
}

function preferences(
  partial: Partial<UserPreferencesDto> = {},
): UserPreferencesDto {
  return {
    agentPanelOpen: false,
    accentColor: "blue",
    messageTextSize: 14,
    timeFormat: "system",
    sendWithEnter: true,
    notificationsEnabled: true,
    sidebarWidth: 280,
    agentPanelWidth: 380,
    recentEmojis: [],
    messageTemplates: [],
    demoWorkspace: false,
    theme: "system",
    reduceMotion: false,
    loopStickers: true,
    notificationSenderName: true,
    notificationPreview: true,
    countMutedChats: false,
    mediaCacheLimitMb: 512,
    ...partial,
  };
}

function threadDto(partial: Partial<AgentThreadDto> = {}): AgentThreadDto {
  return {
    threadId: "thread-1",
    title: "Summarize",
    updatedAt: "2026-08-27T12:00:00.000Z",
    messages: [
      {
        id: "msg-1",
        from: "user",
        body: "Summarize",
        sentAt: "2026-08-27T12:00:00.000Z",
      },
    ],
    ...partial,
  };
}

describe("agent-store accept()", () => {
  beforeEach(resetAgentStore);

  it("appends an empty assistant message on TEXT_MESSAGE_START", () => {
    useAgentStore.getState().accept({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-1",
      role: "assistant",
    } as AGUIEvent);

    expect(useAgentStore.getState().messages).toEqual([
      { id: "msg-1", from: "assistant", body: "" },
    ]);
  });

  it("appends TEXT_MESSAGE_CONTENT deltas to the matching messageId only", () => {
    const { accept } = useAgentStore.getState();
    accept({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-1",
      role: "assistant",
    } as AGUIEvent);
    accept({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-2",
      role: "assistant",
    } as AGUIEvent);

    accept({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg-2",
      delta: "Hello",
    } as AGUIEvent);
    accept({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg-2",
      delta: " world",
    } as AGUIEvent);

    expect(useAgentStore.getState().messages).toEqual([
      { id: "msg-1", from: "assistant", body: "" },
      { id: "msg-2", from: "assistant", body: "Hello world" },
    ]);
  });

  it("sets the activity label from a CUSTOM activity event", () => {
    useAgentStore.getState().accept({
      type: EventType.CUSTOM,
      name: "activity",
      value: { label: "Inspecting workspace" },
    } as AGUIEvent);

    expect(useAgentStore.getState().activity).toBe("Inspecting workspace");
  });

  it("clears the activity when the CUSTOM activity event has no label", () => {
    useAgentStore.getState().accept({
      type: EventType.CUSTOM,
      name: "activity",
      value: {},
    } as AGUIEvent);

    expect(useAgentStore.getState().activity).toBeNull();
  });

  it("stops running and clears activity on RUN_FINISHED", () => {
    useAgentStore.getState().accept({
      type: EventType.RUN_FINISHED,
      threadId: "global",
      runId: "run-1",
    } as AGUIEvent);

    const state = useAgentStore.getState();
    expect(state.running).toBe(false);
    expect(state.activity).toBeNull();
    expect(state.messages).toEqual([]);
  });

  it("flags the failure on RUN_ERROR without putting the message in the transcript", () => {
    useAgentStore.setState({
      messages: [{ id: "user-1", from: "user", body: "Hi" }],
    });
    useAgentStore.getState().accept({
      type: EventType.RUN_ERROR,
      message: "Please wait 11 seconds before repeating the action.",
    } as AGUIEvent);

    const state = useAgentStore.getState();
    expect(state.running).toBe(false);
    expect(state.activity).toBeNull();
    expect(state.runFailed).toBe(true);
    expect(state.messages).toEqual([
      { id: "user-1", from: "user", body: "Hi" },
    ]);
  });

  it("drops the empty assistant shell but keeps partial text on RUN_ERROR", () => {
    const { accept } = useAgentStore.getState();
    accept({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-1",
      role: "assistant",
    } as AGUIEvent);
    accept({
      type: EventType.RUN_ERROR,
      message: "Provider unavailable",
    } as AGUIEvent);
    expect(useAgentStore.getState().messages).toEqual([]);

    accept({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-2",
      role: "assistant",
    } as AGUIEvent);
    accept({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg-2",
      delta: "Partial",
    } as AGUIEvent);
    accept({
      type: EventType.RUN_ERROR,
      message: "Provider unavailable",
    } as AGUIEvent);
    expect(useAgentStore.getState().messages).toEqual([
      { id: "msg-2", from: "assistant", body: "Partial" },
    ]);
  });

  it("ignores unrelated event types", () => {
    const before = useAgentStore.getState();
    useAgentStore.getState().accept({
      type: EventType.RUN_STARTED,
      threadId: "global",
      runId: "run-1",
    } as AGUIEvent);

    const after = useAgentStore.getState();
    expect(after.messages).toBe(before.messages);
    expect(after.running).toBe(before.running);
    expect(after.activity).toBe(before.activity);
  });
});

describe("agent-store actions", () => {
  beforeEach(resetAgentStore);

  it("toggle() flips the panel visibility and close() hides it", () => {
    const telo = installTeloApiMock();
    telo.preferences.update.mockResolvedValue(
      preferences({ agentPanelOpen: true }),
    );

    useAgentStore.getState().toggle();
    expect(useAgentStore.getState().open).toBe(true);

    useAgentStore.getState().toggle();
    expect(useAgentStore.getState().open).toBe(false);

    useAgentStore.getState().toggle();
    useAgentStore.getState().close();
    expect(useAgentStore.getState().open).toBe(false);
  });

  it("loadPanelState() applies the persisted panel visibility", async () => {
    const telo = installTeloApiMock();
    telo.preferences.get.mockResolvedValue(
      preferences({ agentPanelOpen: true }),
    );

    await useAgentStore.getState().loadPanelState();

    expect(useAgentStore.getState().open).toBe(true);
    expect(telo.preferences.get).toHaveBeenCalledTimes(1);
  });

  it("loadPanelState() caches the notifications preference", async () => {
    const telo = installTeloApiMock();
    telo.preferences.get.mockResolvedValue(
      preferences({ notificationsEnabled: true }),
    );

    await useAgentStore.getState().loadPanelState();

    expect(useAgentStore.getState().notificationsEnabled).toBe(true);
  });

  it("toggle() persists the new panel visibility optimistically", () => {
    const telo = installTeloApiMock();
    telo.preferences.update.mockResolvedValue(
      preferences({ agentPanelOpen: true }),
    );

    useAgentStore.getState().toggle();

    expect(useAgentStore.getState().open).toBe(true);
    expect(telo.preferences.update).toHaveBeenCalledWith({
      agentPanelOpen: true,
    });
  });

  it("close() does not persist when the panel is already closed", () => {
    const telo = installTeloApiMock();

    useAgentStore.getState().close();

    expect(telo.preferences.update).not.toHaveBeenCalled();
  });

  it("resyncs the panel visibility from storage when the write fails", async () => {
    const telo = installTeloApiMock();
    telo.preferences.update.mockRejectedValue(new Error("disk full"));
    telo.preferences.get.mockResolvedValue(preferences());

    useAgentStore.getState().toggle();
    expect(useAgentStore.getState().open).toBe(true);

    await vi.waitFor(() => {
      expect(useAgentStore.getState().open).toBe(false);
    });
    expect(telo.preferences.get).toHaveBeenCalledTimes(1);
  });

  it("loadConfiguration() stores the configuration from the preload API", async () => {
    const telo = installTeloApiMock();
    const configuration: AgentConfigurationDto = {
      provider: "openai",
      model: "gpt-5",
      baseUrl: null,
      instructions: "Be concise",
      hasCredential: true,
      authKind: "api-key",
      accountLabel: null,
      configuredOAuthProviders: [...AGENT_OAUTH_PROVIDERS],
      canInspectWorkspace: false,
      temperature: 0.7,
      maxSteps: 4,
      historyLimit: 20,
    };
    telo.agent.getConfiguration.mockResolvedValue(configuration);

    await useAgentStore.getState().loadConfiguration();

    expect(useAgentStore.getState().configuration).toEqual(configuration);
  });

  it("saveConfiguration() stores the saved configuration", async () => {
    const telo = installTeloApiMock();
    const configuration: AgentConfigurationDto = {
      provider: "openai-compatible",
      model: "local-model",
      baseUrl: "http://localhost:11434/v1",
      instructions: "",
      hasCredential: false,
      authKind: null,
      accountLabel: null,
      configuredOAuthProviders: [...AGENT_OAUTH_PROVIDERS],
      canInspectWorkspace: true,
      temperature: 1.2,
      maxSteps: 6,
      historyLimit: 10,
    };
    telo.agent.saveConfiguration.mockResolvedValue(configuration);

    await useAgentStore.getState().saveConfiguration({
      provider: "openai-compatible",
      model: "local-model",
      baseUrl: "http://localhost:11434/v1",
      instructions: "",
      canInspectWorkspace: true,
      temperature: 1.2,
      maxSteps: 6,
      historyLimit: 10,
    });

    expect(useAgentStore.getState().configuration).toEqual(configuration);
  });

  it("run() appends the user message, marks the run active, and delegates", async () => {
    const telo = installTeloApiMock();
    telo.agent.run.mockResolvedValue(undefined);
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: "thread-1",
    });
    useAgentStore.setState({ threadId: "thread-1" });
    const context: UiContextSnapshot = {
      activeChat: null,
      visibleChats: [],
      visibleMessages: [],
      components: [],
    };

    await useAgentStore.getState().run("Summarize this chat", context, {
      scope: "unread",
      chatId: "design",
    });

    const state = useAgentStore.getState();
    expect(state.running).toBe(true);
    expect(state.activity).toBeNull();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      from: "user",
      body: "Summarize this chat",
    });
    expect(telo.agent.run).toHaveBeenCalledWith({
      threadId: "thread-1",
      prompt: "Summarize this chat",
      context,
      scope: { scope: "unread", chatId: "design" },
    });
    expect(telo.agent.createThread).not.toHaveBeenCalled();
  });

  it("run() creates a thread first when none is active, then refreshes the list", async () => {
    const telo = installTeloApiMock();
    const created = threadDto({ threadId: "thread-9", messages: [] });
    telo.agent.createThread.mockResolvedValue(created);
    telo.agent.run.mockResolvedValue(undefined);
    telo.agent.listThreads.mockResolvedValue({
      threads: [
        {
          threadId: "thread-9",
          title: "Summarize this chat",
          updatedAt: created.updatedAt,
        },
      ],
      activeThreadId: "thread-9",
    });
    const context: UiContextSnapshot = {
      activeChat: null,
      visibleChats: [],
      visibleMessages: [],
      components: [],
    };

    await useAgentStore.getState().run("Summarize this chat", context, {
      scope: "unread",
      chatId: "design",
    });

    expect(telo.agent.createThread).toHaveBeenCalledTimes(1);
    expect(telo.agent.run).toHaveBeenCalledWith({
      threadId: "thread-9",
      prompt: "Summarize this chat",
      context,
      scope: { scope: "unread", chatId: "design" },
    });
    const state = useAgentStore.getState();
    expect(state.threadId).toBe("thread-9");
    expect(state.threads.map((thread) => thread.threadId)).toEqual([
      "thread-9",
    ]);
  });

  it("loadThreads() restores the thread list and the active transcript", async () => {
    const telo = installTeloApiMock();
    const thread = threadDto();
    telo.agent.listThreads.mockResolvedValue({
      threads: [
        {
          threadId: thread.threadId,
          title: thread.title,
          updatedAt: thread.updatedAt,
        },
      ],
      activeThreadId: thread.threadId,
    });
    telo.agent.getThread.mockResolvedValue(thread);

    await useAgentStore.getState().loadThreads();

    const state = useAgentStore.getState();
    expect(state.threadId).toBe("thread-1");
    expect(state.threads).toHaveLength(1);
    expect(state.messages).toEqual([
      { id: "msg-1", from: "user", body: "Summarize" },
    ]);
    expect(telo.agent.getThread).toHaveBeenCalledWith("thread-1");
  });

  it("loadThreads() keeps the error flag on persisted error messages", async () => {
    const telo = installTeloApiMock();
    const thread = threadDto({
      messages: [
        {
          id: "msg-1",
          from: "user",
          body: "Summarize",
          sentAt: "2026-08-27T12:00:00.000Z",
        },
        {
          id: "msg-2",
          from: "assistant",
          body: "Provider unavailable",
          sentAt: "2026-08-27T12:01:00.000Z",
          error: true,
        },
      ],
    });
    telo.agent.listThreads.mockResolvedValue({
      threads: [
        {
          threadId: thread.threadId,
          title: thread.title,
          updatedAt: thread.updatedAt,
        },
      ],
      activeThreadId: thread.threadId,
    });
    telo.agent.getThread.mockResolvedValue(thread);

    await useAgentStore.getState().loadThreads();

    expect(useAgentStore.getState().messages[1]).toEqual({
      id: "msg-2",
      from: "assistant",
      body: "Provider unavailable",
      error: true,
    });
  });

  it("loadThreads() leaves the transcript empty when no thread is active", async () => {
    const telo = installTeloApiMock();
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: null,
    });

    await useAgentStore.getState().loadThreads();

    expect(useAgentStore.getState().threadId).toBeNull();
    expect(useAgentStore.getState().messages).toEqual([]);
    expect(telo.agent.getThread).not.toHaveBeenCalled();
  });

  it("startNewThread() persists a thread and resets the transcript", async () => {
    const telo = installTeloApiMock();
    const created = threadDto({
      threadId: "thread-2",
      title: "",
      messages: [],
    });
    telo.agent.createThread.mockResolvedValue(created);
    useAgentStore.setState({
      threadId: "thread-1",
      messages: [{ id: "msg-1", from: "user", body: "Old" }],
      threads: [
        {
          threadId: "thread-1",
          title: "Old",
          updatedAt: "2026-08-27T11:00:00.000Z",
        },
      ],
    });

    await useAgentStore.getState().startNewThread();

    const state = useAgentStore.getState();
    expect(state.threadId).toBe("thread-2");
    expect(state.messages).toEqual([]);
    expect(state.threads.map((thread) => thread.threadId)).toEqual([
      "thread-2",
      "thread-1",
    ]);
  });

  it("selectThread() loads the transcript through the IPC boundary", async () => {
    const telo = installTeloApiMock();
    telo.agent.selectThread.mockResolvedValue(threadDto());
    useAgentStore.setState({ threadId: "thread-0", messages: [] });

    await useAgentStore.getState().selectThread("thread-1");

    expect(telo.agent.selectThread).toHaveBeenCalledWith("thread-1");
    expect(useAgentStore.getState().threadId).toBe("thread-1");
    expect(useAgentStore.getState().messages).toEqual([
      { id: "msg-1", from: "user", body: "Summarize" },
    ]);
  });

  it("selectThread() keeps the error flag on persisted error messages", async () => {
    const telo = installTeloApiMock();
    telo.agent.selectThread.mockResolvedValue(
      threadDto({
        messages: [
          {
            id: "msg-2",
            from: "assistant",
            body: "Provider unavailable",
            sentAt: "2026-08-27T12:01:00.000Z",
            error: true,
          },
        ],
      }),
    );
    useAgentStore.setState({ threadId: "thread-0", messages: [] });

    await useAgentStore.getState().selectThread("thread-1");

    expect(useAgentStore.getState().messages).toEqual([
      {
        id: "msg-2",
        from: "assistant",
        body: "Provider unavailable",
        error: true,
      },
    ]);
  });

  it("selectThread() is a no-op for the already active thread", async () => {
    const telo = installTeloApiMock();
    useAgentStore.setState({ threadId: "thread-1" });

    await useAgentStore.getState().selectThread("thread-1");

    expect(telo.agent.selectThread).not.toHaveBeenCalled();
  });

  it("subscribeToAgentEvents() forwards preload events to accept()", () => {
    const telo = installTeloApiMock();
    resetAgentStore();
    const unsubscribe = subscribeToAgentEvents();

    expect(telo.agent.onEvent).toHaveBeenCalledTimes(1);
    const listener = telo.agent.onEvent.mock.calls[0][0];
    listener({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-1",
      role: "assistant",
    } as AGUIEvent);

    expect(useAgentStore.getState().messages).toEqual([
      { id: "msg-1", from: "assistant", body: "" },
    ]);
    expect(typeof unsubscribe).toBe("function");
  });
});

describe("agent-store run completion notifications", () => {
  beforeEach(() => {
    resetAgentStore();
    installTeloApiMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubHidden(hidden: boolean): void {
    vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);
  }

  it("notifies on RUN_FINISHED when the window is hidden and notifications are on", () => {
    const telo = installTeloApiMock();
    stubHidden(true);
    useAgentStore.setState({ notificationsEnabled: true });

    useAgentStore.getState().accept({
      type: EventType.RUN_FINISHED,
      threadId: "global",
      runId: "run-1",
    } as AGUIEvent);

    expect(telo.shell.notify).toHaveBeenCalledWith(
      copy.agent,
      copy.notifyRunCompleteBody,
    );
  });

  it("notifies on RUN_ERROR when the window is hidden and notifications are on", () => {
    const telo = installTeloApiMock();
    stubHidden(true);
    useAgentStore.setState({ notificationsEnabled: true });

    useAgentStore.getState().accept({
      type: EventType.RUN_ERROR,
      message: "Provider unavailable",
    } as AGUIEvent);

    expect(telo.shell.notify).toHaveBeenCalledWith(
      copy.agent,
      copy.notifyRunCompleteBody,
    );
  });

  it("stays silent while the window is visible", () => {
    const telo = installTeloApiMock();
    stubHidden(false);
    useAgentStore.setState({ notificationsEnabled: true });

    useAgentStore.getState().accept({
      type: EventType.RUN_FINISHED,
      threadId: "global",
      runId: "run-1",
    } as AGUIEvent);

    expect(telo.shell.notify).not.toHaveBeenCalled();
  });

  it("stays silent when notifications are disabled", () => {
    const telo = installTeloApiMock();
    stubHidden(true);
    useAgentStore.setState({ notificationsEnabled: false });

    useAgentStore.getState().accept({
      type: EventType.RUN_FINISHED,
      threadId: "global",
      runId: "run-1",
    } as AGUIEvent);

    expect(telo.shell.notify).not.toHaveBeenCalled();
  });
});

describe("agent-store runChatAction()", () => {
  beforeEach(() => {
    resetAgentStore();
    useAgentStore.setState({ running: false });
  });

  const scope = {
    chatId: "design",
    chatTitle: "Telo Design",
    messages: [{ id: "design-4", senderName: "Lev", body: "Ship it." }],
  };
  const context: UiContextSnapshot = {
    activeChat: { id: "design", title: "Telo Design", kind: "group" },
    visibleChats: [],
    visibleMessages: [],
    components: [],
  };

  it("delegates a summary run with the chat and the action label", async () => {
    const telo = installTeloApiMock();
    telo.agent.runChatSummary.mockResolvedValue(undefined);
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: "thread-1",
    });
    useAgentStore.setState({ threadId: "thread-1" });

    await useAgentStore.getState().runChatAction("summary", scope, context);

    expect(telo.agent.runChatSummary).toHaveBeenCalledWith({
      threadId: "thread-1",
      context,
      chatId: "design",
      chatTitle: "Telo Design",
      promptLabel: "Summarize unread",
    });
    const state = useAgentStore.getState();
    expect(state.running).toBe(true);
    // The transcript shows the action label, never the machine prompt.
    expect(state.messages[0]).toMatchObject({
      from: "user",
      body: "Summarize unread",
    });
  });

  it("delegates an extraction run with its own label", async () => {
    const telo = installTeloApiMock();
    telo.agent.runChatExtraction.mockResolvedValue(undefined);
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: "thread-1",
    });
    useAgentStore.setState({ threadId: "thread-1" });

    await useAgentStore.getState().runChatAction("extraction", scope, context);

    expect(telo.agent.runChatExtraction).toHaveBeenCalledWith({
      threadId: "thread-1",
      context,
      chatId: "design",
      chatTitle: "Telo Design",
      promptLabel: "Extract decisions & todos",
    });
    expect(telo.agent.runChatSummary).not.toHaveBeenCalled();
  });

  it("creates a thread first when none is active", async () => {
    const telo = installTeloApiMock();
    telo.agent.createThread.mockResolvedValue(
      threadDto({ threadId: "thread-9", messages: [] }),
    );
    telo.agent.runChatSummary.mockResolvedValue(undefined);
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: "thread-9",
    });

    await useAgentStore.getState().runChatAction("summary", scope, context);

    expect(telo.agent.createThread).toHaveBeenCalledTimes(1);
    expect(telo.agent.runChatSummary).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-9" }),
    );
  });

  it("ignores an empty scope", async () => {
    const telo = installTeloApiMock();

    await useAgentStore
      .getState()
      .runChatAction("summary", { ...scope, messages: [] }, context);

    expect(telo.agent.runChatSummary).not.toHaveBeenCalled();
    expect(useAgentStore.getState().messages).toEqual([]);
  });
});

describe("agent-store suggestions", () => {
  beforeEach(() => {
    resetAgentStore();
    useAgentStore.setState({ running: false, suggestions: [] });
  });

  const suggestionsEvent = {
    type: EventType.CUSTOM,
    name: AGENT_SUGGESTIONS_EVENT_NAME,
    value: { items: ["And then?", "Who owns it?"] },
  } as AGUIEvent;
  const context: UiContextSnapshot = {
    activeChat: null,
    visibleChats: [],
    visibleMessages: [],
    components: [],
  };

  it("stores the follow-ups that trail a finished run", () => {
    useAgentStore.getState().accept(suggestionsEvent);

    expect(useAgentStore.getState().suggestions).toEqual([
      "And then?",
      "Who owns it?",
    ]);
  });

  it("ignores follow-ups that arrive once a new run is already in flight", () => {
    useAgentStore.setState({ running: true });

    useAgentStore.getState().accept(suggestionsEvent);

    expect(useAgentStore.getState().suggestions).toEqual([]);
  });

  it("clears the follow-ups when a run starts or the thread changes", async () => {
    const telo = installTeloApiMock();
    telo.agent.run.mockResolvedValue(undefined);
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: "thread-1",
    });
    telo.agent.createThread.mockResolvedValue(
      threadDto({ threadId: "thread-2", messages: [] }),
    );
    useAgentStore.setState({ threadId: "thread-1" });
    useAgentStore.getState().accept(suggestionsEvent);

    await useAgentStore.getState().run("Go on", context, { scope: "folder" });
    expect(useAgentStore.getState().suggestions).toEqual([]);

    useAgentStore.setState({ running: false });
    useAgentStore.getState().accept(suggestionsEvent);
    await useAgentStore.getState().startNewThread();
    expect(useAgentStore.getState().suggestions).toEqual([]);
  });
});

describe("agent-store attachments and retry", () => {
  beforeEach(() => {
    resetAgentStore();
    useAgentStore.setState({
      running: false,
      runFailed: false,
      lastRun: null,
      attachments: [],
    });
  });

  const card = (messageId: string, chatId = "design") => ({
    chatId,
    chatTitle: chatId === "design" ? "Telo Design" : "Ops",
    messageId,
    senderName: "Lev",
    body: `Body ${messageId}`,
  });
  const context: UiContextSnapshot = {
    activeChat: null,
    visibleChats: [],
    visibleMessages: [],
    components: [],
  };

  it("attachMessages() appends new cards and ignores duplicates", () => {
    const { attachMessages } = useAgentStore.getState();
    attachMessages([card("m1"), card("m2")]);
    attachMessages([card("m2"), card("m3")]);

    expect(
      useAgentStore.getState().attachments.map((item) => item.messageId),
    ).toEqual(["m1", "m2", "m3"]);
  });

  it("attachMessages() replaces cards from another chat", () => {
    const { attachMessages } = useAgentStore.getState();
    attachMessages([card("m1")]);
    attachMessages([card("o1", "ops")]);

    expect(useAgentStore.getState().attachments).toEqual([card("o1", "ops")]);
  });

  it("detachMessage() and clearAttachments() remove cards", () => {
    const state = useAgentStore.getState();
    state.attachMessages([card("m1"), card("m2")]);
    state.detachMessage("m1");
    expect(useAgentStore.getState().attachments).toEqual([card("m2")]);

    state.clearAttachments();
    expect(useAgentStore.getState().attachments).toEqual([]);
  });

  it("run() consumes the cards and remembers the inputs for a retry", async () => {
    const telo = installTeloApiMock();
    telo.agent.run.mockResolvedValue(undefined);
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: "thread-1",
    });
    useAgentStore.setState({ threadId: "thread-1" });
    useAgentStore.getState().attachMessages([card("m1")]);
    const scope = {
      scope: "selected" as const,
      chatId: "design",
      messageIds: ["m1"],
    };

    await useAgentStore.getState().run("Summarize these", context, scope);

    const state = useAgentStore.getState();
    expect(state.attachments).toEqual([]);
    expect(state.runFailed).toBe(false);
    expect(state.lastRun).toEqual({
      kind: "prompt",
      prompt: "Summarize these",
      context,
      scope,
    });
  });

  it("retryLastRun() re-sends the failed prompt once", async () => {
    const telo = installTeloApiMock();
    telo.agent.run.mockResolvedValue(undefined);
    telo.agent.listThreads.mockResolvedValue({
      threads: [],
      activeThreadId: "thread-1",
    });
    useAgentStore.setState({ threadId: "thread-1" });
    const scope = { scope: "unread" as const, chatId: "design" };

    await useAgentStore.getState().run("What did I miss?", context, scope);
    useAgentStore.getState().accept({
      type: EventType.RUN_ERROR,
      message: "Provider unavailable",
    } as AGUIEvent);
    expect(useAgentStore.getState().runFailed).toBe(true);

    await useAgentStore.getState().retryLastRun();

    expect(telo.agent.run).toHaveBeenCalledTimes(2);
    expect(telo.agent.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: "What did I miss?", scope }),
    );
    const state = useAgentStore.getState();
    expect(state.runFailed).toBe(false);
    // The question shows once, not once per attempt.
    expect(
      state.messages.filter((message) => message.from === "user"),
    ).toHaveLength(1);
  });

  it("retryLastRun() is a no-op without a previous run or while running", async () => {
    const telo = installTeloApiMock();

    await useAgentStore.getState().retryLastRun();
    expect(telo.agent.run).not.toHaveBeenCalled();

    useAgentStore.setState({
      running: true,
      lastRun: {
        kind: "prompt",
        prompt: "Hi",
        context,
        scope: { scope: "folder", folderId: null },
      },
    });
    await useAgentStore.getState().retryLastRun();
    expect(telo.agent.run).not.toHaveBeenCalled();
  });
});
