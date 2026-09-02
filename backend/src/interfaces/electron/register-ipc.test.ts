import { EventType, type AGUIEvent } from "@ag-ui/core";
import type { WebContents } from "electron";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentThreadDto,
  AgentThreadListDto,
  LocalMediaFileInput,
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
  showSaveDialog: vi.fn(),
  openPath: vi.fn(),
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
  dialog: {
    showSaveDialog: ipc.showSaveDialog,
  },
  shell: {
    openPath: ipc.openPath,
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
  scope: { scope: "unread", chatId: "chat" },
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

describe("registerIpc chat agent actions", () => {
  function chatActionContainer(): ApplicationContainer {
    const stream = async function* (): AsyncIterable<AgentOutput> {
      yield { type: "text", delta: "Demo summary of 1 messages." };
    };
    return {
      runChatSummary: { execute: vi.fn(stream) },
      runChatExtraction: { execute: vi.fn(stream) },
    } as unknown as ApplicationContainer;
  }

  it.each([
    ["agentRunChatSummary", "runChatSummary"],
    ["agentRunChatExtraction", "runChatExtraction"],
  ] as const)(
    "streams the %s use case over the agent event channel",
    async (channel, service) => {
      const container = chatActionContainer();
      registerIpc(container);
      const handler = ipc.handlers.get(channels[channel]);
      if (!handler) throw new Error(`${channel} handler was not registered`);
      const events: AGUIEvent[] = [];
      const sender = {
        send: (_channel: string, event: AGUIEvent): void => {
          events.push(event);
        },
      } as unknown as WebContents;
      const chatInput = {
        threadId: "thread-1",
        chatId: "design",
        chatTitle: "Telo Design",
        promptLabel: "Summarize unread",
        context: input.context,
      };

      await handler({ sender }, chatInput);

      expect(container[service].execute).toHaveBeenCalledWith(chatInput);
      expect(events.map((event) => event.type)).toEqual([
        EventType.RUN_STARTED,
        EventType.STATE_SNAPSHOT,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.RUN_FINISHED,
      ]);
    },
  );
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

describe("registerIpc workspace pagination", () => {
  it("forwards chat and message page cursors to the workspace service", async () => {
    const container = {
      workspace: {
        listChatPage: vi
          .fn()
          .mockResolvedValue({ items: [], nextCursor: null }),
        listMessagePage: vi
          .fn()
          .mockResolvedValue({ items: [], nextCursor: null }),
      },
    } as unknown as ApplicationContainer;
    registerIpc(container);
    const chats = ipc.handlers.get(channels.chatPageList);
    const messages = ipc.handlers.get(channels.messagePageList);
    if (!chats || !messages)
      throw new Error("page handlers were not registered");
    const chatInput = {
      limit: 25,
      cursor: {
        chatId: "chat-1",
        topMessageId: "42",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const messageInput = { limit: 30, beforeMessageId: "42" };

    await chats({}, chatInput);
    await messages({}, "chat-1", messageInput);

    expect(container.workspace.listChatPage).toHaveBeenCalledWith(chatInput);
    expect(container.workspace.listMessagePage).toHaveBeenCalledWith(
      "chat-1",
      messageInput,
    );
  });
});

describe("registerIpc workspace search", () => {
  it("forwards global and in-chat search queries to the workspace service", async () => {
    const container = {
      workspace: {
        searchGlobal: vi.fn().mockResolvedValue({ chats: [], messages: [] }),
        searchMessages: vi.fn().mockResolvedValue({
          messageIds: [],
          totalCount: 0,
          nextCursor: null,
        }),
      },
    } as unknown as ApplicationContainer;
    registerIpc(container);
    const global = ipc.handlers.get(channels.searchGlobal);
    const inChat = ipc.handlers.get(channels.searchMessages);
    if (!global || !inChat)
      throw new Error("search handlers were not registered");
    const input = { limit: 30, beforeMessageId: "42" };

    await global({}, "report");
    await inChat({}, "chat-1", "report", input);

    expect(container.workspace.searchGlobal).toHaveBeenCalledWith("report");
    expect(container.workspace.searchMessages).toHaveBeenCalledWith(
      "chat-1",
      "report",
      input,
    );
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
    sidebarWidth: 280,
    agentPanelWidth: 380,
    recentEmojis: [],
    messageTemplates: [],
    reduceMotion: false,
    loopStickers: true,
    notificationSenderName: true,
    notificationPreview: true,
    countMutedChats: false,
    mediaCacheLimitMb: 512,
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

describe("registerIpc storage", () => {
  function storageContainer() {
    const mediaCacheStorage = {
      usageBytes: vi.fn().mockResolvedValue(2048),
      clear: vi.fn().mockResolvedValue(2048),
    };
    return {
      mediaCacheStorage,
      container: { mediaCacheStorage } as unknown as ApplicationContainer,
    };
  }

  it("reports the media cache usage on storage:media-cache-usage", async () => {
    const { mediaCacheStorage, container } = storageContainer();
    registerIpc(container);

    const handler = ipc.handlers.get(channels.storageMediaCacheUsage);
    if (!handler) throw new Error("cache usage handler was not registered");

    await expect(handler({})).resolves.toBe(2048);
    expect(mediaCacheStorage.usageBytes).toHaveBeenCalledTimes(1);
  });

  it("clears the media cache on storage:media-cache-clear", async () => {
    const { mediaCacheStorage, container } = storageContainer();
    registerIpc(container);

    const handler = ipc.handlers.get(channels.storageMediaCacheClear);
    if (!handler) throw new Error("cache clear handler was not registered");

    await expect(handler({})).resolves.toBe(2048);
    expect(mediaCacheStorage.clear).toHaveBeenCalledTimes(1);
  });
});

describe("registerIpc media send validation", () => {
  function workspaceContainer() {
    const workspace = { sendMedia: vi.fn(async () => []) };
    return {
      workspace,
      container: { workspace } as unknown as ApplicationContainer,
    };
  }

  async function mediaSend(files: ReadonlyArray<LocalMediaFileInput>): Promise<{
    result: unknown;
    workspace: { sendMedia: ReturnType<typeof vi.fn> };
  }> {
    const { workspace, container } = workspaceContainer();
    registerIpc(container);
    const handler = ipc.handlers.get(channels.mediaSend);
    if (!handler) throw new Error("media send handler was not registered");
    const result = await handler({}, "chat", files, { uploadId: "upload-1" });
    return { result, workspace };
  }

  async function tempUpload(contents = "photo-bytes") {
    const directory = await mkdtemp(path.join(tmpdir(), "telo-upload-"));
    const source = path.join(directory, "photo.jpg");
    await writeFile(source, contents);
    return {
      source,
      name: "photo.jpg",
      mimeType: "image/jpeg",
      size: contents.length,
    };
  }

  it.each<{
    files: ReadonlyArray<LocalMediaFileInput>;
    error: string;
  }>([
    { files: [], error: "Select from 1 to 10 files" },
    {
      files: Array.from({ length: 11 }, (_, index) => ({
        source: `/tmp/file-${index}.jpg`,
        name: `file-${index}.jpg`,
        mimeType: "image/jpeg",
        size: 1,
      })),
      error: "Select from 1 to 10 files",
    },
    {
      files: [
        {
          source: "/tmp/photo.jpg",
          name: " ",
          mimeType: "image/jpeg",
          size: 1,
        },
      ],
      error: "Upload file name is required",
    },
    {
      files: [
        {
          source: "/tmp/photo.jpg",
          name: "photo.jpg",
          mimeType: "image/jpeg",
          size: 2 * 1024 ** 3 + 1,
        },
      ],
      error: "exceeds the 2 GB limit",
    },
    {
      files: [
        {
          source: "relative/photo.jpg",
          name: "photo.jpg",
          mimeType: "image/jpeg",
          size: 1,
        },
      ],
      error: "Upload source must be absolute",
    },
  ])("rejects invalid uploads ($error)", async ({ files, error }) => {
    await expect(mediaSend(files)).rejects.toThrow(error);
  });

  it("rejects a file whose on-disk size changed since selection", async () => {
    const file = await tempUpload();
    await expect(mediaSend([{ ...file, size: file.size + 1 }])).rejects.toThrow(
      "Upload source changed for photo.jpg",
    );
  });

  it("forwards validated files to the workspace", async () => {
    const file = await tempUpload();

    const { result, workspace } = await mediaSend([file]);

    expect(result).toEqual([]);
    expect(workspace.sendMedia).toHaveBeenCalledWith("chat", [file], {
      uploadId: "upload-1",
    });
  });

  it("stages pasted in-memory files to disk and cleans up after the send", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const { result, workspace } = await mediaSend([
      {
        source: "",
        bytes,
        name: "screenshot-1.png",
        mimeType: "image/png",
        size: bytes.byteLength,
      },
    ]);

    expect(result).toEqual([]);
    const staged = workspace.sendMedia.mock.calls[0]?.[1][0];
    expect(path.isAbsolute(staged.source)).toBe(true);
    expect(staged.name).toBe("screenshot-1.png");
    expect(staged.bytes).toBeUndefined();
    // The workspace saw the true bytes, and the staging directory is removed
    // once the send settles.
    await expect(readFile(staged.source)).rejects.toThrow();
  });

  it("rejects an in-memory file whose byte length does not match its size", async () => {
    await expect(
      mediaSend([
        {
          source: "",
          bytes: new Uint8Array([1, 2, 3]),
          name: "screenshot-1.png",
          mimeType: "image/png",
          size: 4,
        },
      ]),
    ).rejects.toThrow("Upload source changed for screenshot-1.png");
  });
});

describe("registerIpc media file actions", () => {
  async function cachedMedia(contents = "cached-bytes") {
    const directory = await mkdtemp(path.join(tmpdir(), "telo-cache-"));
    const source = path.join(directory, "chat_1.png");
    await writeFile(source, contents);
    const workspace = { resolveMediaFile: vi.fn(async () => source) };
    const container = { workspace } as unknown as ApplicationContainer;
    registerIpc(container);
    return { workspace, source, directory };
  }

  it("copies the cached file to the dialog destination on save-as", async () => {
    const { workspace, source, directory } = await cachedMedia();
    const target = path.join(directory, "chosen.png");
    ipc.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const handler = ipc.handlers.get(channels.mediaSaveAs);
    if (!handler) throw new Error("save-as handler was not registered");

    const result = await handler({}, "chat/1", "hero.png");

    expect(result).toBe(target);
    expect(workspace.resolveMediaFile).toHaveBeenCalledWith("chat/1");
    expect(ipc.showSaveDialog).toHaveBeenCalledWith({
      defaultPath: "hero.png",
    });
    await expect(readFile(target, "utf8")).resolves.toBe("cached-bytes");
    // The cache file survives the export.
    await expect(readFile(source, "utf8")).resolves.toBe("cached-bytes");
  });

  it("returns null when the save dialog is cancelled", async () => {
    await cachedMedia();
    ipc.showSaveDialog.mockResolvedValue({ canceled: true });
    const handler = ipc.handlers.get(channels.mediaSaveAs);
    if (!handler) throw new Error("save-as handler was not registered");

    await expect(handler({}, "chat/1", null)).resolves.toBeNull();
    // Without a usable suggestion the cached file name seeds the dialog.
    expect(ipc.showSaveDialog).toHaveBeenCalledWith({
      defaultPath: "chat_1.png",
    });
  });

  it("rejects a suggested name that is not a bare file name", async () => {
    await cachedMedia();
    ipc.showSaveDialog.mockResolvedValue({ canceled: true });
    const handler = ipc.handlers.get(channels.mediaSaveAs);
    if (!handler) throw new Error("save-as handler was not registered");

    await handler({}, "chat/1", "../escape.png");

    expect(ipc.showSaveDialog).toHaveBeenCalledWith({
      defaultPath: "chat_1.png",
    });
  });

  it("opens the cached file with the system handler", async () => {
    const { workspace, source } = await cachedMedia();
    ipc.openPath.mockResolvedValue("");
    const handler = ipc.handlers.get(channels.mediaOpen);
    if (!handler) throw new Error("open handler was not registered");

    await expect(handler({}, "chat/1")).resolves.toBeUndefined();
    expect(workspace.resolveMediaFile).toHaveBeenCalledWith("chat/1");
    expect(ipc.openPath).toHaveBeenCalledWith(source);
  });

  it("rejects when the system cannot open the file", async () => {
    await cachedMedia();
    ipc.openPath.mockResolvedValue("No application registered");
    const handler = ipc.handlers.get(channels.mediaOpen);
    if (!handler) throw new Error("open handler was not registered");

    await expect(handler({}, "chat/1")).rejects.toThrow(
      "No application registered",
    );
  });
});
