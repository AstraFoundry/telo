import { EventType, type AGUIEvent } from "@ag-ui/core";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentThreadDto,
  AgentThreadListDto,
  RunAgentInput,
  UpdateUserPreferencesInput,
  UserPreferencesDto,
} from "../../../../contracts/src/ipc";
import type { AgentOutput } from "../../domain/agent/agent-ports";
import { channels } from "./channels";
import type { ApplicationContainer } from "./container";
import { registerIpc } from "./register-ipc";

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => unknown,
    ): void => {
      ipc.handlers.set(channel, listener);
    },
  },
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
}));

const input: RunAgentInput = {
  threadId: "thread-1",
  prompt: "Summarize",
  context: {
    activeChat: { id: "chat", title: "Telo Design", kind: "group" },
    visibleChats: [],
    visibleMessages: [],
    components: [],
  },
};

function agentContainer(
  outputs: ReadonlyArray<AgentOutput>,
): ApplicationContainer {
  return {
    runAgent: {
      async *execute() {
        for (const output of outputs) yield output;
      },
    },
  } as unknown as ApplicationContainer;
}

async function runAgent(outputs: ReadonlyArray<AgentOutput>): Promise<{
  events: AGUIEvent[];
  channelsSeen: string[];
}> {
  registerIpc(agentContainer(outputs));
  const handler = ipc.handlers.get(channels.agentRun);
  if (!handler) throw new Error("agent run handler was not registered");
  const events: AGUIEvent[] = [];
  const channelsSeen: string[] = [];
  const sender = {
    send: (channel: string, event: AGUIEvent): void => {
      channelsSeen.push(channel);
      events.push(event);
    },
  } as unknown as WebContents;
  await handler({ sender }, input);
  return { events, channelsSeen };
}

describe("registerIpc agent event streaming", () => {
  it("emits the AG-UI event sequence for a successful run", async () => {
    const outputs: AgentOutput[] = [
      { type: "activity", label: "Reading workspace" },
      { type: "text", delta: "Hello" },
      { type: "text", delta: " world" },
    ];

    const { events, channelsSeen } = await runAgent(outputs);

    // TEXT_MESSAGE_START opens on the first delta, so activity events that
    // precede any text come first.
    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.CUSTOM,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    expect(channelsSeen).toEqual(events.map(() => channels.agentEvent));

    expect(events[0]).toMatchObject({ threadId: "thread-1" });
    expect(events[1]).toMatchObject({ snapshot: input.context });
    expect(events[2]).toMatchObject({ name: "activity", value: outputs[0] });
    expect(events[3]).toMatchObject({ role: "assistant" });
    expect(events[4]).toMatchObject({ delta: "Hello" });
    expect(events[5]).toMatchObject({ delta: " world" });
    expect(events[7]).toMatchObject({
      threadId: "thread-1",
      outcome: { type: "success" },
    });

    const runStarted = events[0] as { runId: string };
    const runFinished = events[7] as { runId: string };
    expect(runFinished.runId).toBe(runStarted.runId);

    const start = events[3] as { messageId: string };
    for (const index of [4, 5, 6]) {
      expect((events[index] as { messageId: string }).messageId).toBe(
        start.messageId,
      );
    }
  });

  it("closes the started message with TEXT_MESSAGE_END when an error follows partial text", async () => {
    const outputs: AgentOutput[] = [
      { type: "text", delta: "partial" },
      { type: "error", message: "Model exploded" },
    ];

    const { events } = await runAgent(outputs);

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.RUN_ERROR,
      EventType.TEXT_MESSAGE_END,
    ]);
    expect(events[4]).toMatchObject({
      message: "Model exploded",
      code: "AGENT_FAILED",
    });
  });

  it("emits no TEXT_MESSAGE events when the run fails before any text", async () => {
    const outputs: AgentOutput[] = [
      { type: "activity", label: "Reading workspace" },
      { type: "error", message: "Model exploded" },
    ];

    const { events } = await runAgent(outputs);

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.CUSTOM,
      EventType.RUN_ERROR,
    ]);
    expect(events[3]).toMatchObject({
      message: "Model exploded",
      code: "AGENT_FAILED",
    });
  });

  it("finishes without a TEXT_MESSAGE sequence when the agent produces no output", async () => {
    const { events } = await runAgent([]);

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.RUN_FINISHED,
    ]);
  });
});

describe("registerIpc agent threads", () => {
  const thread: AgentThreadDto = {
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
  };

  function threadsContainer(): ApplicationContainer {
    return {
      agentThreads: {
        listThreads: vi.fn().mockResolvedValue({
          threads: [
            {
              threadId: "thread-1",
              title: "Summarize",
              updatedAt: thread.updatedAt,
            },
          ],
          activeThreadId: "thread-1",
        }),
        getThread: vi.fn().mockResolvedValue(thread),
        createThread: vi.fn().mockResolvedValue({ ...thread, messages: [] }),
        selectThread: vi.fn().mockResolvedValue(thread),
      },
    } as unknown as ApplicationContainer;
  }

  it("serves the thread list on agent:threads-list", async () => {
    const container = threadsContainer();
    registerIpc(container);

    const handler = ipc.handlers.get(channels.agentThreadsList);
    if (!handler) throw new Error("threads list handler was not registered");

    const list = (await handler({})) as AgentThreadListDto;
    expect(list.activeThreadId).toBe("thread-1");
    expect(list.threads).toHaveLength(1);
    expect(container.agentThreads.listThreads).toHaveBeenCalledTimes(1);
  });

  it("forwards the threadId on agent:thread-get and agent:thread-select", async () => {
    const container = threadsContainer();
    registerIpc(container);

    const get = ipc.handlers.get(channels.agentThreadGet);
    const select = ipc.handlers.get(channels.agentThreadSelect);
    if (!get || !select) throw new Error("thread handlers were not registered");

    await expect(get({}, "thread-1")).resolves.toEqual(thread);
    await expect(select({}, "thread-1")).resolves.toEqual(thread);
    expect(container.agentThreads.getThread).toHaveBeenCalledWith("thread-1");
    expect(container.agentThreads.selectThread).toHaveBeenCalledWith(
      "thread-1",
    );
  });

  it("creates a thread on agent:thread-create", async () => {
    const container = threadsContainer();
    registerIpc(container);

    const handler = ipc.handlers.get(channels.agentThreadCreate);
    if (!handler) throw new Error("thread create handler was not registered");

    const created = (await handler({})) as AgentThreadDto;
    expect(created.messages).toEqual([]);
    expect(container.agentThreads.createThread).toHaveBeenCalledTimes(1);
  });
});

describe("registerIpc chat actions", () => {
  function chatActionsContainer(): ApplicationContainer {
    return {
      chatActions: {
        setPinned: vi.fn().mockResolvedValue(undefined),
        setMuted: vi.fn().mockResolvedValue(undefined),
        setRead: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as ApplicationContainer;
  }

  it("forwards chat state updates on the workspace channels", async () => {
    const container = chatActionsContainer();
    registerIpc(container);

    const pin = ipc.handlers.get(channels.chatPinSet);
    const mute = ipc.handlers.get(channels.chatMuteSet);
    const read = ipc.handlers.get(channels.chatReadSet);
    if (!pin || !mute || !read)
      throw new Error("chat action handlers were not registered");

    await pin({}, "chat-1", true);
    await mute({}, "chat-2", false);
    await read({}, "chat-3", true);

    expect(container.chatActions.setPinned).toHaveBeenCalledWith(
      "chat-1",
      true,
    );
    expect(container.chatActions.setMuted).toHaveBeenCalledWith(
      "chat-2",
      false,
    );
    expect(container.chatActions.setRead).toHaveBeenCalledWith("chat-3", true);
  });
});

describe("registerIpc message actions", () => {
  function messageActionsContainer(): ApplicationContainer {
    return {
      workspace: {
        sendMessage: vi.fn().mockResolvedValue({ id: "message-2" }),
      },
      messageActions: {
        editMessage: vi.fn().mockResolvedValue(undefined),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        forwardMessage: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as ApplicationContainer;
  }

  it("forwards the reply input on workspace:send-message", async () => {
    const container = messageActionsContainer();
    registerIpc(container);

    const handler = ipc.handlers.get(channels.messageSend);
    if (!handler) throw new Error("send message handler was not registered");

    await handler({}, "chat-1", "hello", { replyToId: "message-1" });
    expect(container.workspace.sendMessage).toHaveBeenCalledWith(
      "chat-1",
      "hello",
      { replyToId: "message-1" },
    );
  });

  it("forwards edit, delete, and forward payloads to the use case", async () => {
    const container = messageActionsContainer();
    registerIpc(container);

    const edit = ipc.handlers.get(channels.messageEdit);
    const del = ipc.handlers.get(channels.messageDelete);
    const forward = ipc.handlers.get(channels.messageForward);
    if (!edit || !del || !forward)
      throw new Error("message action handlers were not registered");

    const editInput = { chatId: "chat-1", messageId: "m-1", body: "updated" };
    const deleteInput = { chatId: "chat-1", messageId: "m-1" };
    const forwardInput = {
      fromChatId: "chat-1",
      messageId: "m-1",
      toChatId: "chat-2",
    };
    await edit({}, editInput);
    await del({}, deleteInput);
    await forward({}, forwardInput);

    expect(container.messageActions.editMessage).toHaveBeenCalledWith(
      editInput,
    );
    expect(container.messageActions.deleteMessage).toHaveBeenCalledWith(
      deleteInput,
    );
    expect(container.messageActions.forwardMessage).toHaveBeenCalledWith(
      forwardInput,
    );
  });
});

describe("registerIpc telegram logout", () => {
  it("runs the logout use case on telegram:logout", async () => {
    const container = {
      telegramLogout: {
        execute: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as ApplicationContainer;
    registerIpc(container);

    const handler = ipc.handlers.get(channels.telegramLogout);
    if (!handler) throw new Error("logout handler was not registered");

    await expect(handler({})).resolves.toBeUndefined();
    expect(container.telegramLogout.execute).toHaveBeenCalledTimes(1);
  });
});

describe("registerIpc preferences", () => {
  const defaults: UserPreferencesDto = {
    agentPanelOpen: false,
    demoWorkspace: false,
    theme: "system",
    accentColor: "blue",
    messageTextSize: 14,
    timeFormat: "system",
    sendWithEnter: true,
    notificationsEnabled: true,
  };

  function preferencesContainer(
    preferences: UserPreferencesDto,
  ): ApplicationContainer {
    return {
      preferences: {
        get: vi.fn().mockResolvedValue(preferences),
        execute: vi
          .fn()
          .mockImplementation((input: UpdateUserPreferencesInput) =>
            Promise.resolve({ ...preferences, ...input }),
          ),
      },
    } as unknown as ApplicationContainer;
  }

  it("serves the current preferences on preferences:get", async () => {
    const stored: UserPreferencesDto = {
      ...defaults,
      agentPanelOpen: true,
      theme: "dark",
    };
    const container = preferencesContainer(stored);
    registerIpc(container);

    const handler = ipc.handlers.get(channels.preferencesGet);
    if (!handler) throw new Error("preferences get handler was not registered");

    await expect(handler({})).resolves.toEqual(stored);
    expect(container.preferences.get).toHaveBeenCalledTimes(1);
  });

  it("forwards partial updates on preferences:update", async () => {
    const container = preferencesContainer(defaults);
    registerIpc(container);

    const handler = ipc.handlers.get(channels.preferencesUpdate);
    if (!handler)
      throw new Error("preferences update handler was not registered");

    await expect(handler({}, { theme: "light" })).resolves.toEqual({
      ...defaults,
      theme: "light",
    });
    expect(container.preferences.execute).toHaveBeenCalledWith({
      theme: "light",
    });
  });
});
