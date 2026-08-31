import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  TelegramAuthState,
  TelegramLoginInput,
} from "../../../../contracts/src/ipc";
import { ARCHIVE_FOLDER_ID } from "../../../../contracts/src/ipc";
import type {
  TelegramConnectionProfile,
  TelegramDialogSnapshotRepository,
  TelegramSessionRepository,
} from "../../domain/telegram/telegram-ports";
import { ChannelInvalidError, FloodWaitError } from "teleproto/errors/index.js";

import { MemoryTelegramDialogSnapshotRepository } from "./file-telegram-dialog-snapshot-repository";
import { TelegramClientCoordinator } from "./teleproto-telegram-repository";

const fake = vi.hoisted(() => {
  interface FakeStartParams {
    readonly phoneNumber: string;
    readonly phoneCode: () => Promise<string>;
    readonly password: (hint: string) => Promise<string>;
    readonly onError: (error: unknown) => void;
  }

  type StartBehavior = (params: FakeStartParams) => Promise<void>;

  interface FakeSendFileParams {
    readonly file: unknown;
    readonly caption: unknown;
    readonly parseMode: unknown;
    readonly replyTo?: number;
    readonly supportsStreaming?: boolean;
    readonly progressCallback?: ((progress: number) => void) & {
      isCanceled?: boolean;
    };
  }

  type SendFileBehavior = (
    entity: unknown,
    params: FakeSendFileParams,
  ) => Promise<unknown>;

  class FakeTelegramClient {
    static instances: FakeTelegramClient[] = [];
    static authorized = true;
    static startBehavior: StartBehavior | null = null;
    static catchUpBehavior: (() => Promise<void>) | null = null;
    static connectBehavior: (() => Promise<void>) | null = null;
    static getDialogsGate: (() => Promise<void>) | null = null;
    static sendFileBehavior: SendFileBehavior | null = null;
    static dialogs: unknown[] = [];
    static dialogFilters: unknown[] = [];
    static photoRequests: Array<{
      readonly entity: unknown;
      readonly resolve: (photo: Buffer | null) => void;
    }> = [];

    connectCalls = 0;
    disconnectCalls = 0;
    readonly session = { save: (): string => "restored-session" };
    connectionHandler:
      | ((
          update: { state: number },
          next: () => Promise<void>,
        ) => Promise<void>)
      | null = null;
    readonly updates = {
      on: (
        _name: string,
        handler: (
          update: { state: number },
          next: () => Promise<void>,
        ) => Promise<void>,
      ) => {
        this.connectionHandler = handler;
        return () => {
          this.connectionHandler = null;
        };
      },
    };
    catchUpCalls = 0;
    getDialogsInFlight = 0;
    readonly getDialogsParams: unknown[] = [];
    maxConcurrentGetDialogs = 0;
    readonly sendFileCalls: Array<{
      readonly entity: unknown;
      readonly params: FakeSendFileParams;
    }> = [];
    addEventHandler(
      callback: (update: unknown) => void,
      builder: unknown,
    ): void {
      this.eventHandlers.push({ callback, builder });
    }
    removeEventHandler(): void {}

    readonly eventHandlers: Array<{
      callback: (update: unknown) => void;
      builder: unknown;
    }> = [];
    readonly getMessagesCalls: Array<{
      entity: unknown;
      params: unknown;
    }> = [];
    static getMessagesBehavior:
      ((entity: unknown, params: unknown) => Promise<unknown[]>) | null = null;

    async getMessages(entity: unknown, params: unknown): Promise<unknown[]> {
      this.getMessagesCalls.push({ entity, params });
      const behavior = FakeTelegramClient.getMessagesBehavior;
      if (!behavior) return [];
      return behavior(entity, params);
    }

    constructor(
      readonly stringSession: unknown,
      readonly apiId: number,
      readonly apiHash: string,
      readonly options: {
        readonly connection?: { readonly name?: string };
        readonly connectionRetries?: number;
        readonly timeout?: number;
        readonly floodSleepThreshold?: number;
      } = {},
    ) {
      FakeTelegramClient.instances.push(this);
    }

    errorHandler: ((error: Error) => Promise<void>) | null = null;
    set onError(handler: (error: Error) => Promise<void>) {
      this.errorHandler = handler;
    }

    readonly downloadMediaCalls: unknown[] = [];
    async downloadMedia(message: unknown): Promise<Buffer> {
      this.downloadMediaCalls.push(message);
      if (
        message &&
        typeof message === "object" &&
        "className" in message &&
        (message as { className?: string }).className === "MessageService"
      ) {
        throw new Error("Cannot download media of type MessageService");
      }
      return Buffer.from("");
    }

    async getPeerId(peer: unknown): Promise<string> {
      if (
        typeof peer === "string" ||
        typeof peer === "number" ||
        typeof peer === "bigint"
      ) {
        return String(peer);
      }
      if (peer && typeof peer === "object") {
        const record = peer as { channelId?: unknown; userId?: unknown };
        if (record.channelId != null) return String(record.channelId);
        if (record.userId != null) return String(record.userId);
      }
      throw new Error("getPeerId is not stubbed");
    }

    async connect(): Promise<void> {
      this.connectCalls += 1;
      await FakeTelegramClient.connectBehavior?.();
    }

    async disconnect(): Promise<void> {
      this.disconnectCalls += 1;
    }

    async checkAuthorization(): Promise<boolean> {
      return FakeTelegramClient.authorized;
    }

    async catchUp(): Promise<void> {
      this.catchUpCalls += 1;
      await FakeTelegramClient.catchUpBehavior?.();
    }

    async getDialogs(params?: unknown): Promise<unknown[]> {
      this.getDialogsParams.push(params ?? {});
      this.getDialogsInFlight += 1;
      this.maxConcurrentGetDialogs = Math.max(
        this.maxConcurrentGetDialogs,
        this.getDialogsInFlight,
      );
      try {
        await FakeTelegramClient.getDialogsGate?.();
        return FakeTelegramClient.dialogs;
      } finally {
        this.getDialogsInFlight -= 1;
      }
    }

    async getDialogFilters(): Promise<{ filters: unknown[] }> {
      return { filters: FakeTelegramClient.dialogFilters };
    }

    downloadProfilePhoto(entity: unknown): Promise<Buffer | null> {
      return new Promise((resolve) => {
        FakeTelegramClient.photoRequests.push({ entity, resolve });
      });
    }

    async emitConnectionState(state: number): Promise<void> {
      await this.connectionHandler?.({ state }, async () => undefined);
    }

    async start(params: FakeStartParams): Promise<void> {
      await FakeTelegramClient.startBehavior?.(params);
    }

    async sendFile(
      entity: unknown,
      params: FakeSendFileParams,
    ): Promise<unknown> {
      this.sendFileCalls.push({ entity, params });
      const behavior = FakeTelegramClient.sendFileBehavior;
      if (!behavior) throw new Error("sendFile is not stubbed");
      return behavior(entity, params);
    }

    readonly forwardMessagesCalls: Array<{
      entity: unknown;
      params: unknown;
    }> = [];

    async forwardMessages(entity: unknown, params: unknown): Promise<void> {
      this.forwardMessagesCalls.push({ entity, params });
    }

    static entityBehavior: ((entity: unknown) => Promise<unknown>) | null =
      null;

    async getEntity(entity: unknown): Promise<unknown> {
      const behavior = FakeTelegramClient.entityBehavior;
      if (!behavior) throw new Error("getEntity is not stubbed");
      return behavior(entity);
    }
  }

  class FakeUpdateDraftMessage {}
  class FakeDraftMessage {}
  class FakeUser {}
  class FakeUserStatusOnline {}
  class FakeUpdateUserStatus {}
  class FakeInputMessagesFilterPhotoVideo {}
  class FakeInputMessagesFilterDocument {}
  class FakeInputMessagesFilterPinned {}
  class FakeUpdatePinnedMessages {}
  class FakeUpdatePinnedChannelMessages {}
  class FakePeerChannel {
    channelId: unknown;
    constructor(params: { channelId: unknown }) {
      this.channelId = params.channelId;
    }
  }

  return {
    FakeTelegramClient,
    FakeUpdateDraftMessage,
    FakeDraftMessage,
    FakeUser,
    FakeUserStatusOnline,
    FakeUpdateUserStatus,
    FakeInputMessagesFilterPhotoVideo,
    FakeInputMessagesFilterDocument,
    FakeInputMessagesFilterPinned,
    FakeUpdatePinnedMessages,
    FakeUpdatePinnedChannelMessages,
    FakePeerChannel,
  };
});

vi.mock("teleproto", () => ({
  TelegramClient: fake.FakeTelegramClient,
  Api: {
    UpdateDraftMessage: fake.FakeUpdateDraftMessage,
    DraftMessage: fake.FakeDraftMessage,
    User: fake.FakeUser,
    UserStatusOnline: fake.FakeUserStatusOnline,
    UpdateUserStatus: fake.FakeUpdateUserStatus,
    InputMessagesFilterPhotoVideo: fake.FakeInputMessagesFilterPhotoVideo,
    InputMessagesFilterDocument: fake.FakeInputMessagesFilterDocument,
    InputMessagesFilterPinned: fake.FakeInputMessagesFilterPinned,
    UpdatePinnedMessages: fake.FakeUpdatePinnedMessages,
    UpdatePinnedChannelMessages: fake.FakeUpdatePinnedChannelMessages,
    PeerChannel: fake.FakePeerChannel,
  },
}));
vi.mock("teleproto/sessions/index.js", () => ({ StringSession: class {} }));

const { FakeTelegramClient } = fake;

function sessionRepository(initial = "") {
  const saved: string[] = [];
  let clearCalls = 0;
  const repository: TelegramSessionRepository = {
    get: async () => initial,
    save: async (session) => {
      saved.push(session);
    },
    clear: async () => {
      clearCalls += 1;
    },
  };
  return { repository, saved, clearCalls: () => clearCalls };
}

function profileRepository(initial: TelegramConnectionProfile | null = null) {
  const saved: TelegramConnectionProfile[] = [];
  const repository = {
    get: async () => initial,
    save: async (profile: TelegramConnectionProfile) => {
      saved.push(profile);
    },
  };
  return { repository, saved };
}

function dispatchRawUpdate(
  client: InstanceType<typeof FakeTelegramClient> | undefined,
  update: object,
): void {
  for (const { callback, builder } of client?.eventHandlers ?? []) {
    const types = (builder as { types?: unknown[] }).types;
    if (
      types?.some(
        (type) =>
          typeof type === "function" &&
          update instanceof (type as new (...args: never[]) => object),
      )
    ) {
      callback(update);
    }
  }
}

function createCoordinator(
  options: {
    session?: string;
    profile?: TelegramConnectionProfile | null;
    credentials?: { apiId: number; apiHash: string } | null;
    sessions?: TelegramSessionRepository;
    snapshots?: TelegramDialogSnapshotRepository;
  } = {},
) {
  const states: TelegramAuthState[] = [];
  const sessions = sessionRepository(options.session ?? "");
  const profiles = profileRepository(options.profile ?? null);
  const coordinator = new TelegramClientCoordinator(
    options.sessions ?? sessions.repository,
    profiles.repository,
    options.credentials ?? null,
    (state) => states.push(state),
    "",
    options.snapshots,
  );
  return { coordinator, sessions, profiles, states };
}

async function waitForState(
  coordinator: TelegramClientCoordinator,
  expected: TelegramAuthState,
): Promise<void> {
  await vi.waitFor(() => {
    expect(coordinator.getAuthState()).toEqual(expected);
  });
}

async function connectedCoordinator(): Promise<TelegramClientCoordinator> {
  const { coordinator } = createCoordinator({
    session: "stored-session",
    credentials: { apiId: 7, apiHash: "hash" },
  });
  await coordinator.initialize();
  return coordinator;
}

function fakeSentMessage(
  id: number,
  options: { groupedId?: bigint; body?: string } = {},
) {
  return {
    id,
    message: options.body ?? "",
    date: 1_700_000_000,
    out: true,
    groupedId: options.groupedId,
    photo: { id: BigInt(id) },
    file: { name: `file-${id}.jpg`, mimeType: "image/jpeg", size: 1234 },
    getSender: async () => ({ firstName: "You" }),
  };
}

const photoFile = {
  source: "/tmp/photo.jpg",
  name: "photo.jpg",
  mimeType: "image/jpeg",
  size: 1234,
};

describe("TelegramClientCoordinator", () => {
  beforeEach(() => {
    FakeTelegramClient.instances.length = 0;
    FakeTelegramClient.authorized = true;
    FakeTelegramClient.startBehavior = null;
    FakeTelegramClient.connectBehavior = null;
    FakeTelegramClient.catchUpBehavior = null;
    FakeTelegramClient.getDialogsGate = null;
    FakeTelegramClient.sendFileBehavior = null;
    FakeTelegramClient.getMessagesBehavior = null;
    FakeTelegramClient.entityBehavior = null;
    FakeTelegramClient.dialogs = [];
    FakeTelegramClient.dialogFilters = [];
    FakeTelegramClient.photoRequests = [];
  });

  it("serves demo data until a client is connected", async () => {
    const { coordinator } = createCoordinator();
    await expect(coordinator.getCurrentUser()).resolves.toMatchObject({
      id: "demo-user",
      displayName: "Demo User",
    });
    expect((await coordinator.listChatPage({ limit: 100 })).items).toHaveLength(
      4,
    );
  });

  it("stays idle when there is no session or credentials to restore", async () => {
    const { coordinator: withoutSession, states: sessionStates } =
      createCoordinator({ credentials: { apiId: 7, apiHash: "hash" } });
    await withoutSession.initialize();
    expect(sessionStates).toEqual([]);

    const { coordinator: withoutCredentials, states: credentialStates } =
      createCoordinator({ session: "stored-session" });
    await withoutCredentials.initialize();
    expect(credentialStates).toEqual([]);
    expect(FakeTelegramClient.instances).toHaveLength(0);
  });

  it("restores an authorized session and becomes ready", async () => {
    const { coordinator, states } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });

    await coordinator.initialize();

    expect(states).toEqual([{ status: "restoring" }, { status: "ready" }]);
    const client = FakeTelegramClient.instances[0];
    expect(client?.apiId).toBe(7);
    expect(client?.apiHash).toBe("hash");
    expect(client?.options.connection?.name).toBe("ConnectionTCPObfuscated");
    expect(client?.options.connectionRetries).toBe(5);
    expect(client?.options.timeout).toBe(15);
    expect(client?.connectCalls).toBe(1);
    expect(client?.catchUpCalls).toBe(0);
    expect(client?.disconnectCalls).toBe(0);
  });

  it("disconnects and returns to idle when the session is no longer authorized", async () => {
    FakeTelegramClient.authorized = false;
    const { coordinator, states } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });

    await coordinator.initialize();

    expect(states).toEqual([{ status: "restoring" }, { status: "idle" }]);
    expect(FakeTelegramClient.instances[0]?.disconnectCalls).toBe(1);
    await expect(coordinator.getCurrentUser()).resolves.toMatchObject({
      id: "demo-user",
    });
  });

  it("serves the dialog snapshot while the session is restoring", async () => {
    const snapshots = new MemoryTelegramDialogSnapshotRepository();
    const cached: ChatDto = {
      id: "cached",
      title: "Cached",
      preview: "hi",
      updatedAt: "2026-01-01T00:00:00.000Z",
      unreadCount: 2,
      lastReadMessageId: null,
      muted: false,
      pinned: false,
      kind: "direct",
      initials: "C",
      avatarDataUrl: null,
      draftPreview: null,
      typing: false,
    };
    await snapshots.save({
      version: 1,
      chats: [cached],
      folders: [{ id: 2, title: "Work", unreadCount: 2 }],
      nextCursor: null,
    });
    let releaseConnect: (() => void) | undefined;
    FakeTelegramClient.connectBehavior = () =>
      new Promise<void>((resolve) => {
        releaseConnect = resolve;
      });
    const { coordinator } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
      snapshots,
    });
    const init = coordinator.initialize();
    await vi.waitFor(() => {
      expect(coordinator.getAuthState()).toEqual({ status: "restoring" });
    });
    await expect(coordinator.listChatPage()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "cached", title: "Cached" })],
    });
    await expect(coordinator.listFolders()).resolves.toEqual([
      { id: 2, title: "Work", unreadCount: 2 },
    ]);
    releaseConnect?.();
    await init;
  });

  it("paints the dialog snapshot first and refreshes it in the background once ready", async () => {
    const snapshots = new MemoryTelegramDialogSnapshotRepository();
    await snapshots.save({
      version: 1,
      chats: [
        {
          id: "cached",
          title: "Cached",
          preview: "hi",
          updatedAt: "2026-01-01T00:00:00.000Z",
          unreadCount: 0,
          lastReadMessageId: null,
          muted: false,
          pinned: false,
          kind: "direct",
          initials: "C",
          avatarDataUrl: null,
          draftPreview: null,
          typing: false,
        },
      ],
      folders: [],
      nextCursor: null,
    });
    FakeTelegramClient.dialogs = [
      {
        id: BigInt(1),
        title: "Live",
        name: "Live",
        dialog: { notifySettings: {}, topMessage: 1 },
        isUser: true,
        isChannel: false,
        isGroup: false,
        entity: {},
        message: { message: "Preview" },
        date: 1,
        unreadCount: 0,
        pinned: false,
        archived: false,
      },
    ];
    const { coordinator } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
      snapshots,
    });
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    await coordinator.initialize();

    await expect(coordinator.listChatPage()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "cached" })],
    });
    await vi.waitFor(() => {
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "chats",
            chats: expect.arrayContaining([
              expect.objectContaining({ id: "1", title: "Live" }),
            ]),
          }),
        ]),
      );
    });
  });

  it("computes folder badges from the cached page instead of a full GetDialogs", async () => {
    FakeTelegramClient.dialogs = [
      {
        id: BigInt(1),
        title: "Chat 1",
        name: "Chat 1",
        dialog: { notifySettings: {}, topMessage: 1 },
        isUser: true,
        isChannel: false,
        isGroup: false,
        entity: {},
        message: { message: "Preview" },
        date: 1,
        unreadCount: 0,
        pinned: false,
        archived: false,
      },
    ];
    const coordinator = await connectedCoordinator();
    const client = FakeTelegramClient.instances[0];
    await coordinator.listChatPage({ limit: 10 });
    const calls = client?.getDialogsParams.length ?? 0;
    await coordinator.listFolders();
    expect(client?.getDialogsParams).toHaveLength(calls);
    expect(client?.getDialogsParams[0]).toMatchObject({
      limit: 11,
      ignoreMigrated: false,
    });
  });

  it("filters migrated legacy groups locally without losing the raw page cursor", async () => {
    const dialog = (id: number, migratedTo?: object) => ({
      id: BigInt(id),
      title: `Chat ${id}`,
      name: `Chat ${id}`,
      dialog: { notifySettings: {}, topMessage: id },
      isUser: false,
      isChannel: false,
      isGroup: true,
      entity: { migratedTo },
      message: { message: "Preview" },
      date: id,
      unreadCount: 0,
      pinned: false,
      archived: false,
    });
    FakeTelegramClient.dialogs = [
      dialog(3),
      dialog(2, { channelId: BigInt(20) }),
      dialog(1),
    ];
    const coordinator = await connectedCoordinator();

    const page = await coordinator.listChatPage({ limit: 2 });

    expect(page.items.map((chat) => chat.id)).toEqual(["3"]);
    expect(page.nextCursor).toMatchObject({
      chatId: "2",
      topMessageId: "2",
    });
  });

  it("publishes offline and synchronized states around reconnect catch-up", async () => {
    const { coordinator } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    await coordinator.initialize();
    const client = FakeTelegramClient.instances[0];

    await client?.emitConnectionState(-1);
    await client?.emitConnectionState(1);

    expect(events).toEqual([
      { type: "connection-state", state: "offline" },
      { type: "connection-state", state: "synchronizing" },
      { type: "chats", chats: [], nextCursor: null },
      { type: "connection-state", state: "connected" },
    ]);
    expect(client?.catchUpCalls).toBe(1);
    expect(client?.options.floodSleepThreshold).toBe(0);
  });

  it("ignores duplicate connected events after synchronization", async () => {
    const { coordinator } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    await coordinator.initialize();
    const client = FakeTelegramClient.instances[0];

    await client?.emitConnectionState(-1);
    await client?.emitConnectionState(1);
    await client?.emitConnectionState(1);

    expect(client?.catchUpCalls).toBe(1);
    expect(events).toEqual([
      { type: "connection-state", state: "offline" },
      { type: "connection-state", state: "synchronizing" },
      { type: "chats", chats: [], nextCursor: null },
      { type: "connection-state", state: "connected" },
    ]);
  });

  it("logs language-level catch-up failures without publishing a sync-error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    FakeTelegramClient.catchUpBehavior = async () => {
      throw new TypeError("Right-hand side of 'instanceof' is not callable");
    };
    const { coordinator } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    try {
      await coordinator.initialize();
      const client = FakeTelegramClient.instances[0];

      await client?.emitConnectionState(-1);
      await client?.emitConnectionState(1);

      expect(logged).toHaveBeenCalledWith(
        "Telegram sync failed",
        expect.any(TypeError),
      );
      expect(events).toEqual([
        { type: "connection-state", state: "offline" },
        { type: "connection-state", state: "synchronizing" },
      ]);
    } finally {
      logged.mockRestore();
    }
  });

  it("publishes user-facing catch-up failures as sync-error events", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    FakeTelegramClient.catchUpBehavior = async () => {
      throw new Error("FLOOD_WAIT_30");
    };
    const { coordinator } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    try {
      await coordinator.initialize();
      const client = FakeTelegramClient.instances[0];

      await client?.emitConnectionState(-1);
      await client?.emitConnectionState(1);

      expect(logged).toHaveBeenCalledWith(
        "Telegram sync failed",
        expect.any(Error),
      );
      expect(events).toEqual([
        { type: "connection-state", state: "offline" },
        { type: "connection-state", state: "synchronizing" },
        { type: "sync-error", message: "FLOOD_WAIT_30" },
      ]);
    } finally {
      logged.mockRestore();
    }
  });

  it("does not report connected from a stale catch-up after another disconnect", async () => {
    let finishCatchUp: (() => void) | undefined;
    FakeTelegramClient.catchUpBehavior = () =>
      new Promise<void>((resolve) => {
        finishCatchUp = resolve;
      });
    const { coordinator } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    await coordinator.initialize();
    const client = FakeTelegramClient.instances[0];

    await client?.emitConnectionState(-1);
    const reconnect = client?.emitConnectionState(1);
    await vi.waitFor(() => {
      expect(events.at(-1)).toEqual({
        type: "connection-state",
        state: "synchronizing",
      });
    });
    await client?.emitConnectionState(-1);
    finishCatchUp?.();
    await reconnect;

    expect(events.at(-1)).toEqual({
      type: "connection-state",
      state: "offline",
    });
  });

  it("waits GetDialogs flood outside the exclusive queue and stays Updating until it returns", async () => {
    const snapshots = new MemoryTelegramDialogSnapshotRepository();
    await snapshots.save({
      version: 1,
      chats: [
        {
          id: "cached",
          title: "Cached",
          preview: "hi",
          updatedAt: "2026-01-01T00:00:00.000Z",
          unreadCount: 0,
          lastReadMessageId: null,
          muted: false,
          pinned: false,
          kind: "direct",
          initials: "C",
          avatarDataUrl: null,
          draftPreview: null,
          typing: false,
        },
      ],
      folders: [],
      nextCursor: null,
    });
    let attempts = 0;
    FakeTelegramClient.getDialogsGate = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new FloodWaitError({ request: {}, capture: 30 });
      }
    };
    FakeTelegramClient.dialogs = [
      {
        id: BigInt(1),
        title: "Live",
        name: "Live",
        dialog: { notifySettings: {}, topMessage: 1 },
        isUser: true,
        isChannel: false,
        isGroup: false,
        entity: {},
        message: { message: "Preview" },
        date: 1,
        unreadCount: 0,
        pinned: false,
      },
    ];
    const { coordinator } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
      snapshots,
    });
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    await coordinator.initialize();
    const client = FakeTelegramClient.instances[0];
    await client?.emitConnectionState(-1);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const reconnect = client?.emitConnectionState(1);
      let spins = 0;
      while (spins < 50) {
        const queueIdle = attempts === 1 && client?.getDialogsInFlight === 0;
        if (queueIdle) break;
        spins += 1;
        await Promise.resolve();
      }
      expect(attempts).toBe(1);
      expect(client?.getDialogsInFlight).toBe(0);
      expect(events).toEqual([
        { type: "connection-state", state: "offline" },
        { type: "connection-state", state: "synchronizing" },
      ]);
      await expect(
        coordinator.listChatPage({ limit: 10 }),
      ).resolves.toMatchObject({
        items: [expect.objectContaining({ id: "cached" })],
      });
      expect(await snapshots.get()).toMatchObject({
        chats: [expect.objectContaining({ id: "cached" })],
      });

      await vi.advanceTimersByTimeAsync(30_000);
      await reconnect;

      expect(attempts).toBe(2);
      expect(events).toContainEqual({
        type: "connection-state",
        state: "connected",
      });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "chats",
          chats: expect.arrayContaining([
            expect.objectContaining({ id: "1", title: "Live" }),
          ]),
        }),
      );
      expect(await snapshots.get()).toMatchObject({
        chats: expect.arrayContaining([
          expect.objectContaining({ id: "1", title: "Live" }),
        ]),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not download MessageService as user media", async () => {
    FakeTelegramClient.getMessagesBehavior = async () => [
      {
        id: 8,
        className: "MessageService",
        action: { photo: { id: 2 } },
        photo: { id: 2 },
        file: { name: "chat.jpg" },
      },
    ];
    const coordinator = await connectedCoordinator();
    const client = FakeTelegramClient.instances.at(-1);
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));

    await expect(
      coordinator.downloadMedia("chat-1/8"),
    ).resolves.toBeUndefined();
    expect(client?.downloadMediaCalls).toEqual([]);
    expect(
      events.some(
        (event) => (event as { type?: string }).type === "media-download",
      ),
    ).toBe(false);
  });

  it("skips CHANNEL_INVALID instead of publishing a workspace sync-error", async () => {
    const coordinator = await connectedCoordinator();
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    const client = FakeTelegramClient.instances.at(-1);
    await client?.errorHandler?.(new ChannelInvalidError({ request: {} }));
    let resolvedPeer = false;
    client!.getPeerId = async () => {
      resolvedPeer = true;
      throw new ChannelInvalidError({ request: {} });
    };
    const update = Object.assign(new fake.FakeUpdatePinnedMessages(), {
      peer: { userId: 9 },
    });
    dispatchRawUpdate(client, update);
    await vi.waitFor(() => {
      expect(resolvedPeer).toBe(true);
    });
    expect(
      events.filter(
        (event) => (event as { type?: string }).type === "sync-error",
      ),
    ).toEqual([]);
    expect(
      events.filter(
        (event) => (event as { type?: string }).type === "pinned-messages",
      ),
    ).toEqual([]);
  });

  it("emits pinned-messages when Telegram pins change", async () => {
    const coordinator = await connectedCoordinator();
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    const client = FakeTelegramClient.instances.at(-1);
    const update = Object.assign(new fake.FakeUpdatePinnedMessages(), {
      peer: { userId: 9 },
    });
    dispatchRawUpdate(client, update);
    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: "pinned-messages", chatId: "9" });
    });
  });

  it("returns dialogs before loading avatars and bounds media concurrency", async () => {
    const entities = Array.from({ length: 5 }, (_, index) => ({
      id: BigInt(index + 1),
      accessHash: BigInt(index + 101),
    }));
    FakeTelegramClient.dialogs = entities.map((entity, index) => ({
      id: BigInt(index + 1),
      title: `Chat ${index + 1}`,
      name: `Chat ${index + 1}`,
      dialog: { notifySettings: {}, topMessage: index + 1 },
      isUser: true,
      isChannel: false,
      isGroup: false,
      entity,
      message: { message: "Preview" },
      date: 1,
      unreadCount: 0,
      pinned: false,
    }));
    const { coordinator } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    await coordinator.initialize();

    const page = await coordinator.listChatPage({ limit: 5 });

    expect(page.items).toHaveLength(5);
    expect(page.items.every((entry) => entry.avatarDataUrl === null)).toBe(
      true,
    );
    expect(FakeTelegramClient.photoRequests).toHaveLength(3);
    expect(FakeTelegramClient.photoRequests[0]?.entity).toBe(entities[0]);
    expect(events).toEqual([]);

    FakeTelegramClient.photoRequests[0]?.resolve(Buffer.from("photo"));
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "chat-avatar",
        chatId: "1",
        avatarDataUrl: "data:image/jpeg;base64,cGhvdG8=",
      });
      expect(FakeTelegramClient.photoRequests).toHaveLength(4);
    });
  });

  it("maps archived dialogs to the Archive folder with summed unread counts", async () => {
    const dialog = (
      id: number,
      options: { archived: boolean; unreadCount: number },
    ) => ({
      id: BigInt(id),
      title: `Chat ${id}`,
      name: `Chat ${id}`,
      dialog: { notifySettings: {}, topMessage: id },
      isUser: true,
      isChannel: false,
      isGroup: false,
      entity: {},
      message: { message: "Preview" },
      date: 1,
      unreadCount: options.unreadCount,
      pinned: false,
      archived: options.archived,
    });
    FakeTelegramClient.dialogs = [
      dialog(1, { archived: false, unreadCount: 0 }),
      dialog(2, { archived: true, unreadCount: 2 }),
      dialog(3, { archived: true, unreadCount: 5 }),
    ];
    const coordinator = await connectedCoordinator();

    const page = await coordinator.listChatPage({ limit: 10 });

    expect(page.items.map((chat) => chat.folderId)).toEqual([null, 1, 1]);
    await expect(coordinator.listFolders()).resolves.toEqual([
      { id: ARCHIVE_FOLDER_ID, title: "Archive", unreadCount: 7 },
    ]);
  });

  it("does not overlap GetDialogs between the chat page and folder badges", async () => {
    FakeTelegramClient.dialogs = [
      {
        id: BigInt(1),
        title: "Chat 1",
        name: "Chat 1",
        dialog: { notifySettings: {}, topMessage: 1 },
        isUser: true,
        isChannel: false,
        isGroup: false,
        entity: {},
        message: { message: "Preview" },
        date: 1,
        unreadCount: 0,
        pinned: false,
      },
    ];
    const coordinator = await connectedCoordinator();
    const client = FakeTelegramClient.instances[0];
    let releaseDialogs: (() => void) | undefined;
    FakeTelegramClient.getDialogsGate = () =>
      new Promise<void>((resolve) => {
        releaseDialogs = resolve;
      });

    const page = coordinator.listChatPage({ limit: 10 });
    const folders = coordinator.listFolders();
    await vi.waitFor(() => {
      expect(client?.getDialogsInFlight).toBe(1);
    });
    releaseDialogs?.();
    await Promise.all([page, folders]);

    expect(client?.maxConcurrentGetDialogs).toBe(1);
  });

  it("maps an online direct-chat counterpart to presence", async () => {
    const user = new fake.FakeUser() as { status?: unknown };
    user.status = new fake.FakeUserStatusOnline();
    FakeTelegramClient.dialogs = [
      {
        id: BigInt(9),
        title: "Mina",
        name: "Mina",
        dialog: { notifySettings: {}, topMessage: 1 },
        isUser: true,
        isChannel: false,
        isGroup: false,
        entity: user,
        message: { message: "hey" },
        date: 1,
        unreadCount: 0,
        pinned: false,
      },
    ];
    const coordinator = await connectedCoordinator();

    const page = await coordinator.listChatPage({ limit: 5 });

    expect(page.items[0]?.presence).toBe("online");
  });

  it("emits chat-presence when a counterpart's status flips", async () => {
    const coordinator = await connectedCoordinator();
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    const client = FakeTelegramClient.instances.at(-1);
    const update = Object.assign(new fake.FakeUpdateUserStatus(), {
      userId: BigInt(9),
      status: new fake.FakeUserStatusOnline(),
    });

    // Dispatch the raw update the way teleproto would: to every registered
    // handler; only the UserStatus handler turns it into a workspace event.
    for (const { callback } of client?.eventHandlers ?? []) callback(update);

    expect(events).toContainEqual({
      type: "chat-presence",
      chatId: "9",
      online: true,
    });
  });

  it("maps in-chat search results to newest-first ids with total and cursor", async () => {
    const coordinator = await connectedCoordinator();
    const client = FakeTelegramClient.instances.at(-1);
    FakeTelegramClient.getMessagesBehavior = async () => {
      const results = [{ id: 44 }, { id: 43 }, { id: 42 }] as Array<{
        id: number;
      }> & { total?: number };
      results.total = 9;
      return results;
    };

    const page = await coordinator.searchMessages("chat-1", "report", {
      limit: 2,
    });

    expect(client?.getMessagesCalls).toEqual([
      {
        entity: "chat-1",
        params: { search: "report", limit: 3, offsetId: undefined },
      },
    ]);
    expect(page).toEqual({
      messageIds: ["44", "43"],
      totalCount: 9,
      nextCursor: "43",
    });

    await coordinator.searchMessages("chat-1", "report", {
      limit: 2,
      beforeMessageId: "43",
    });
    expect(client?.getMessagesCalls[1]?.params).toMatchObject({
      offsetId: 43,
    });
  });

  it("maps global search results to matching chats and messages", async () => {
    FakeTelegramClient.dialogs = [
      {
        id: BigInt(1),
        title: "Telo Design",
        name: "Telo Design",
        dialog: { notifySettings: {}, topMessage: 1 },
        isUser: false,
        isChannel: false,
        isGroup: true,
        entity: {},
        message: { message: "Preview" },
        date: 1,
        unreadCount: 0,
        pinned: false,
      },
      {
        id: BigInt(2),
        title: "Telo Legacy",
        name: "Telo Legacy",
        dialog: { notifySettings: {}, topMessage: 2 },
        isUser: false,
        isChannel: false,
        isGroup: true,
        entity: { migratedTo: { channelId: BigInt(20) } },
        message: { message: "Preview" },
        date: 1,
        unreadCount: 0,
        pinned: false,
      },
    ];
    const coordinator = await connectedCoordinator();
    const client = FakeTelegramClient.instances.at(-1);
    FakeTelegramClient.getMessagesBehavior = async () => [
      {
        id: 7,
        chatId: BigInt(1),
        message: "Telo search hit",
        date: 1_700_000_000,
        out: false,
        getSender: async () => ({ firstName: "Mina" }),
      },
    ];

    const result = await coordinator.searchGlobal("telo");

    expect(
      client?.getMessagesCalls.some((call) => call.entity === undefined),
    ).toBe(true);
    expect(result.chats.map((chat) => chat.id)).toEqual(["1"]);
    expect(client?.getDialogsParams.at(-1)).toMatchObject({
      ignoreMigrated: false,
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: "7",
      chatId: "1",
      senderName: "Mina",
      body: "Telo search hit",
      media: null,
      status: "read",
    });
  });

  it("surfaces an error state when session restoration fails", async () => {
    const failing: TelegramSessionRepository = {
      get: async () => {
        throw new Error("disk gone");
      },
      save: async () => undefined,
      clear: async () => undefined,
    };
    const { coordinator, states } = createCoordinator({ sessions: failing });

    await coordinator.initialize();

    expect(states).toEqual([{ status: "error", message: "disk gone" }]);
  });

  it("forwards with dropAuthor only when the sender is hidden", async () => {
    const coordinator = await connectedCoordinator();
    const client = FakeTelegramClient.instances.at(-1);

    await coordinator.forwardMessage({
      fromChatId: "chat-1",
      messageId: "42",
      toChatId: "chat-2",
    });
    await coordinator.forwardMessage({
      fromChatId: "chat-1",
      messageId: "43",
      toChatId: "chat-2",
      hideSender: true,
    });

    expect(client?.forwardMessagesCalls).toEqual([
      {
        entity: "chat-2",
        params: { messages: [42], fromPeer: "chat-1", dropAuthor: false },
      },
      {
        entity: "chat-2",
        params: { messages: [43], fromPeer: "chat-1", dropAuthor: true },
      },
    ]);
  });

  it("merges the shared media filters and keeps only photo, video, and file messages", async () => {
    const coordinator = await connectedCoordinator();
    const client = FakeTelegramClient.instances.at(-1);
    FakeTelegramClient.getMessagesBehavior = async (_entity, params) => {
      const filter = (params as { filter?: unknown }).filter;
      if (filter instanceof fake.FakeInputMessagesFilterPhotoVideo) {
        return [
          {
            id: 10,
            message: "",
            date: 1_700_000_010,
            out: false,
            photo: { id: BigInt(10) },
            file: { name: "shot.jpg", mimeType: "image/jpeg", size: 10 },
            getSender: async () => ({ firstName: "Mina" }),
          },
        ];
      }
      if (filter instanceof fake.FakeInputMessagesFilterDocument) {
        return [
          {
            id: 8,
            message: "",
            date: 1_700_000_008,
            out: false,
            document: { id: BigInt(8) },
            file: { name: "spec.pdf", mimeType: "application/pdf", size: 20 },
            getSender: async () => ({ firstName: "Mina" }),
          },
          {
            id: 7,
            message: "",
            date: 1_700_000_007,
            out: false,
            audio: { id: BigInt(7) },
            file: { name: "song.mp3", mimeType: "audio/mpeg", size: 30 },
            getSender: async () => ({ firstName: "Mina" }),
          },
        ];
      }
      return [];
    };

    const page = await coordinator.listSharedMedia("chat-1", {});

    const filters = client?.getMessagesCalls.map(
      (call) => (call.params as { filter?: unknown }).filter,
    );
    expect(
      filters?.some(
        (filter) => filter instanceof fake.FakeInputMessagesFilterPhotoVideo,
      ),
    ).toBe(true);
    expect(
      filters?.some(
        (filter) => filter instanceof fake.FakeInputMessagesFilterDocument,
      ),
    ).toBe(true);
    // Chronological items, audio filtered out of the shared media slice.
    expect(page.items.map((message) => message.id)).toEqual(["8", "10"]);
    expect(page.items.map((message) => message.media?.kind)).toEqual([
      "file",
      "photo",
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("maps pinned messages through the pinned filter", async () => {
    const coordinator = await connectedCoordinator();
    const client = FakeTelegramClient.instances.at(-1);
    FakeTelegramClient.getMessagesBehavior = async () => [
      {
        id: 5,
        message: "Pinned note",
        date: 1_700_000_005,
        out: false,
        getSender: async () => ({ firstName: "Lev" }),
      },
    ];

    const pinned = await coordinator.listPinnedMessages("chat-1");

    const filter = client?.getMessagesCalls[0]
      ? (client.getMessagesCalls[0].params as { filter?: unknown }).filter
      : null;
    expect(filter).toBeInstanceOf(fake.FakeInputMessagesFilterPinned);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toMatchObject({
      id: "5",
      chatId: "chat-1",
      senderName: "Lev",
      body: "Pinned note",
    });
  });

  it("maps the forward attribution from fromName and resolves fromId peers", async () => {
    const coordinator = await connectedCoordinator();
    FakeTelegramClient.entityBehavior = async () => ({
      firstName: "Mina",
      lastName: "K",
    });
    FakeTelegramClient.getMessagesBehavior = async () => [
      {
        id: 5,
        message: "Named forward",
        date: 1_700_000_005,
        out: false,
        fwdFrom: { fromName: "Hidden Author" },
        getSender: async () => ({ firstName: "You" }),
      },
      {
        id: 6,
        message: "Peer forward",
        date: 1_700_000_006,
        out: false,
        fwdFrom: { fromId: { userId: BigInt(1) } },
        getSender: async () => ({ firstName: "You" }),
      },
      {
        id: 7,
        message: "Plain message",
        date: 1_700_000_007,
        out: false,
        getSender: async () => ({ firstName: "You" }),
      },
    ];

    const page = await coordinator.listMessagePage("chat-1", { limit: 50 });

    expect(page.items.map((message) => message.forwardedFrom)).toEqual([
      "Hidden Author",
      "Mina K",
      null,
    ]);
  });

  it("maps media-only messages to an empty body string", async () => {
    const coordinator = await connectedCoordinator();
    FakeTelegramClient.getMessagesBehavior = async () => [
      {
        id: 8,
        date: 1_700_000_008,
        out: false,
        photo: { id: BigInt(8) },
        getSender: async () => ({ firstName: "Lev" }),
      },
    ];

    const page = await coordinator.listMessagePage("chat-1", { limit: 50 });

    expect(page.items[0]).toMatchObject({
      id: "8",
      body: "",
      senderName: "Lev",
    });
  });

  it("reports whether application credentials are configured", async () => {
    const profile = { apiId: 5, apiHash: "profile-hash", phoneNumber: "+1" };
    await expect(
      createCoordinator().coordinator.getLoginConfiguration(),
    ).resolves.toEqual({ applicationCredentialsConfigured: false });
    await expect(
      createCoordinator({ profile }).coordinator.getLoginConfiguration(),
    ).resolves.toEqual({ applicationCredentialsConfigured: true });
    await expect(
      createCoordinator({
        credentials: { apiId: 7, apiHash: "hash" },
      }).coordinator.getLoginConfiguration(),
    ).resolves.toEqual({ applicationCredentialsConfigured: true });
  });

  it.each<[TelegramLoginInput, string]>([
    [{ phoneNumber: "+12025550123" }, "Telegram API id is invalid"],
    [{ phoneNumber: "+12025550123", apiId: 0 }, "Telegram API id is invalid"],
    [{ phoneNumber: "+12025550123", apiId: 1.5 }, "Telegram API id is invalid"],
    [
      { phoneNumber: "+12025550123", apiId: 7 },
      "Telegram API hash is required",
    ],
    [
      { phoneNumber: "+12025550123", apiId: 7, apiHash: "   " },
      "Telegram API hash is required",
    ],
    [
      { phoneNumber: "  ", apiId: 7, apiHash: "hash" },
      "Phone number is required",
    ],
  ])("rejects invalid login input %j", async (input, message) => {
    const { coordinator } = createCoordinator();
    await expect(coordinator.beginLogin(input)).rejects.toThrow(message);
    expect(FakeTelegramClient.instances).toHaveLength(0);
  });

  it.each<{
    credentials: { apiId: number; apiHash: string } | null;
    profile: TelegramConnectionProfile | null;
    expected: { apiId: number; apiHash: string };
  }>([
    {
      credentials: { apiId: 9, apiHash: "app-hash" },
      profile: { apiId: 5, apiHash: "profile-hash", phoneNumber: "+1" },
      expected: { apiId: 9, apiHash: "app-hash" },
    },
    {
      credentials: null,
      profile: { apiId: 5, apiHash: "profile-hash", phoneNumber: "+1" },
      expected: { apiId: 5, apiHash: "profile-hash" },
    },
    {
      credentials: null,
      profile: null,
      expected: { apiId: 1, apiHash: "input-hash" },
    },
  ])(
    "resolves credentials with priority app > profile > input",
    async ({ credentials, profile, expected }) => {
      FakeTelegramClient.startBehavior = async () => undefined;
      const { coordinator } = createCoordinator({ credentials, profile });

      await coordinator.beginLogin({
        phoneNumber: "+12025550123",
        apiId: 1,
        apiHash: "input-hash",
      });

      const client = FakeTelegramClient.instances[0];
      expect(client?.apiId).toBe(expected.apiId);
      expect(client?.apiHash).toBe(expected.apiHash);
    },
  );

  it("rejects challenge submission when no challenge is pending", async () => {
    const { coordinator } = createCoordinator();
    await expect(coordinator.submitChallenge("12345")).rejects.toThrow(
      "Telegram is not waiting for a login challenge",
    );
  });

  it("rejects an empty challenge value and keeps the challenge pending", async () => {
    FakeTelegramClient.startBehavior = async (params) => {
      await params.phoneCode();
    };
    const { coordinator } = createCoordinator({
      credentials: { apiId: 7, apiHash: "hash" },
    });

    await coordinator.beginLogin({ phoneNumber: "+12025550123" });
    await waitForState(coordinator, { status: "code-required" });

    await expect(coordinator.submitChallenge("   ")).rejects.toThrow(
      "Telegram login value is required",
    );
    expect(coordinator.getAuthState()).toEqual({ status: "code-required" });
  });

  it("walks through the code and password challenges in sequence", async () => {
    const received: { code?: string; password?: string } = {};
    FakeTelegramClient.startBehavior = async (params) => {
      received.code = await params.phoneCode();
      received.password = await params.password("Two-factor hint");
    };
    const { coordinator, sessions, profiles, states } = createCoordinator({
      credentials: { apiId: 7, apiHash: "hash" },
    });

    await coordinator.beginLogin({ phoneNumber: " +12025550123 " });
    await waitForState(coordinator, { status: "code-required" });

    await coordinator.submitChallenge(" 12345 ");
    await waitForState(coordinator, {
      status: "password-required",
      hint: "Two-factor hint",
    });

    await coordinator.submitChallenge("secret");
    await waitForState(coordinator, { status: "ready" });

    expect(received).toEqual({ code: "12345", password: "secret" });
    expect(sessions.saved).toEqual(["restored-session"]);
    expect(profiles.saved).toEqual([
      { apiId: 7, apiHash: "hash", phoneNumber: "+12025550123" },
    ]);
    expect(states[0]).toEqual({ status: "connecting" });
  });

  it("moves to the error state when the login run fails", async () => {
    FakeTelegramClient.startBehavior = async () => {
      throw new Error("network down");
    };
    const { coordinator } = createCoordinator({
      credentials: { apiId: 7, apiHash: "hash" },
    });

    await coordinator.beginLogin({ phoneNumber: "+12025550123" });
    await waitForState(coordinator, {
      status: "error",
      message: "network down",
    });
  });

  it("logout() disconnects the client, clears the session, and returns to idle", async () => {
    const { coordinator, sessions, states } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });
    await coordinator.initialize();
    await waitForState(coordinator, { status: "ready" });

    await coordinator.logout();

    expect(FakeTelegramClient.instances[0]?.disconnectCalls).toBe(1);
    expect(sessions.clearCalls()).toBe(1);
    expect(states.at(-1)).toEqual({ status: "idle" });
    // The workspace falls back to the demo repository after logout.
    await expect(coordinator.getCurrentUser()).resolves.toMatchObject({
      id: "demo-user",
    });
  });

  it("logout() without a client still clears the session and stays idle", async () => {
    const { coordinator, sessions, states } = createCoordinator();

    await coordinator.logout();

    expect(sessions.clearCalls()).toBe(1);
    expect(states).toEqual([{ status: "idle" }]);
  });

  it("uploads a single file with progress events and returns the mapped message", async () => {
    const coordinator = await connectedCoordinator();
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    FakeTelegramClient.sendFileBehavior = async (_entity, params) => {
      params.progressCallback?.(0.4);
      params.progressCallback?.(1);
      return fakeSentMessage(101, { body: "Look at this" });
    };

    const sent = await coordinator.sendMedia(
      "chat-1",
      [photoFile],
      "Look at this",
      undefined,
      "client-1",
      "upload-1",
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      id: "101",
      chatId: "chat-1",
      body: "Look at this",
      groupedId: null,
      outgoing: true,
      status: "sent",
      clientId: "client-1",
      media: { kind: "photo", fileName: "file-101.jpg", size: 1234 },
    });
    const call = FakeTelegramClient.instances[0]?.sendFileCalls[0];
    expect(call?.entity).toBe("chat-1");
    expect(call?.params.caption).toBe("Look at this");
    expect(call?.params.parseMode).toBe(false);
    expect(call?.params.supportsStreaming).toBe(false);
    expect(call?.params.file).toMatchObject({
      name: "photo.jpg",
      size: 1234,
    });
    expect(events).toEqual([
      {
        type: "media-upload",
        uploadId: "upload-1",
        state: "uploading",
        progress: 0,
        error: null,
      },
      {
        type: "media-upload",
        uploadId: "upload-1",
        state: "uploading",
        progress: 0.4,
        error: null,
      },
      {
        type: "media-upload",
        uploadId: "upload-1",
        state: "uploading",
        progress: 1,
        error: null,
      },
      {
        type: "media-upload",
        uploadId: "upload-1",
        state: "ready",
        progress: 1,
        error: null,
      },
    ]);
  });

  it("sends multiple files as one album with folded progress and a shared groupedId", async () => {
    const coordinator = await connectedCoordinator();
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    FakeTelegramClient.sendFileBehavior = async (_entity, params) => {
      // teleproto restarts the 0→1 progress callback for every album file.
      params.progressCallback?.(0.5);
      params.progressCallback?.(1);
      params.progressCallback?.(0.5);
      params.progressCallback?.(1);
      return [
        fakeSentMessage(201, { groupedId: BigInt(42), body: "album caption" }),
        fakeSentMessage(202, { groupedId: BigInt(42) }),
      ];
    };

    const sent = await coordinator.sendMedia(
      "chat-1",
      [photoFile, { ...photoFile, name: "second.jpg" }],
      "album caption",
      undefined,
      undefined,
      "upload-2",
    );

    expect(sent.map((message) => message.groupedId)).toEqual(["42", "42"]);
    expect(sent.map((message) => message.body)).toEqual(["album caption", ""]);
    const call = FakeTelegramClient.instances[0]?.sendFileCalls[0];
    expect(Array.isArray(call?.params.file)).toBe(true);
    expect(call?.params.file).toHaveLength(2);
    expect(call?.params.caption).toEqual(["album caption", ""]);
    const uploadEvents = events.filter(
      (event): event is { type: string; state: string; progress: number } =>
        (event as { type: string }).type === "media-upload",
    );
    expect(uploadEvents.map((event) => event.progress)).toEqual([
      0, 0.25, 0.5, 0.75, 1, 1,
    ]);
    expect(uploadEvents.at(-1)?.state).toBe("ready");
  });

  it("aborts the transfer and rejects when the upload is cancelled", async () => {
    const coordinator = await connectedCoordinator();
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    FakeTelegramClient.sendFileBehavior = async (_entity, params) => {
      params.progressCallback?.(0.2);
      // teleproto aborts the transfer once the callback is flagged isCanceled.
      await vi.waitFor(() => {
        if (!params.progressCallback?.isCanceled) {
          throw new Error("upload not cancelled yet");
        }
      });
      throw new Error("USER_CANCELED");
    };

    const pending = coordinator.sendMedia(
      "chat-1",
      [photoFile],
      "",
      undefined,
      undefined,
      "upload-3",
    );
    const assertion = expect(pending).rejects.toThrow(
      "Media upload was cancelled",
    );
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "media-upload",
        uploadId: "upload-3",
        state: "uploading",
        progress: 0.2,
        error: null,
      });
    });

    await coordinator.cancelMediaUpload("upload-3");
    await assertion;

    expect(events.at(-1)).toEqual({
      type: "media-upload",
      uploadId: "upload-3",
      state: "cancelled",
      progress: 0,
      error: null,
    });
    // Cancelling an unknown or finished upload is a no-op.
    await expect(
      coordinator.cancelMediaUpload("missing"),
    ).resolves.toBeUndefined();
  });

  it("emits a failed event and rethrows when the upload fails", async () => {
    const coordinator = await connectedCoordinator();
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    FakeTelegramClient.sendFileBehavior = async () => {
      throw new Error("flood wait");
    };

    await expect(
      coordinator.sendMedia(
        "chat-1",
        [photoFile],
        "",
        undefined,
        undefined,
        "upload-4",
      ),
    ).rejects.toThrow("flood wait");

    expect(events.at(-1)).toEqual({
      type: "media-upload",
      uploadId: "upload-4",
      state: "failed",
      progress: 0,
      error: "flood wait",
    });
  });

  it("rejects a second send while an upload id is still active", async () => {
    const coordinator = await connectedCoordinator();
    let finishUpload: (() => void) | undefined;
    let sendFileCalls = 0;
    FakeTelegramClient.sendFileBehavior = () => {
      sendFileCalls += 1;
      if (sendFileCalls > 1) return Promise.resolve(fakeSentMessage(302));
      return new Promise((resolve) => {
        finishUpload = () => resolve(fakeSentMessage(301));
      });
    };

    const first = coordinator.sendMedia(
      "chat-1",
      [photoFile],
      "",
      undefined,
      undefined,
      "upload-5",
    );
    await expect(
      coordinator.sendMedia(
        "chat-1",
        [photoFile],
        "",
        undefined,
        undefined,
        "upload-5",
      ),
    ).rejects.toThrow("Upload is already active");

    finishUpload?.();
    await expect(first).resolves.toHaveLength(1);
    // The id is free again once the upload settles.
    await expect(
      coordinator.sendMedia(
        "chat-1",
        [photoFile],
        "",
        undefined,
        undefined,
        "upload-5",
      ),
    ).resolves.toHaveLength(1);
  });
});
