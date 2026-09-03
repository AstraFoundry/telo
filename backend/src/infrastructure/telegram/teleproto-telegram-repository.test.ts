import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  TelegramAuthState,
  TelegramLoginInput,
  TelegramWorkspaceEvent,
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
    // teleproto exposes the live transport state; the repository reads it to
    // tell a dropped connection apart from a real failure.
    connected = true;
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

    static downloadMediaBehavior:
      | ((media: unknown, params: { outputFile: string }) => Promise<void>)
      | null = null;

    readonly downloadMediaCalls: unknown[] = [];
    async downloadMedia(
      message: unknown,
      params: { outputFile: string },
    ): Promise<Buffer> {
      this.downloadMediaCalls.push(message);
      if (
        message &&
        typeof message === "object" &&
        "className" in message &&
        message.className === "MessageService"
      ) {
        throw new Error("Cannot download media of type MessageService");
      }
      // Teleproto writes the bytes to outputFile; the repository stats that
      // file afterwards, so a stub that downloads nothing must still create it.
      await FakeTelegramClient.downloadMediaBehavior?.(message, params);
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

    static invokeBehavior: ((request: unknown) => Promise<unknown>) | null =
      null;

    readonly invokeCalls: unknown[] = [];

    async invoke(request: unknown): Promise<unknown> {
      this.invokeCalls.push(request);
      const behavior = FakeTelegramClient.invokeBehavior;
      if (!behavior) throw new Error("invoke is not stubbed");
      return behavior(request);
    }
  }

  class FakeUpdateDraftMessage {}
  class FakeDraftMessage {}
  class FakeUser {}
  class FakeChannel {}
  class FakeChat {}
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
  class FakeGetFullUser {
    id: unknown;
    constructor(params: { id: unknown }) {
      this.id = params.id;
    }
  }
  class FakeGetFullChannel {
    channel: unknown;
    constructor(params: { channel: unknown }) {
      this.channel = params.channel;
    }
  }
  class FakeMessageMediaDocument {
    document: unknown;
    constructor(params: { document: unknown }) {
      this.document = params.document;
    }
  }
  class FakeInputStickerSetID {
    id: unknown;
    accessHash: unknown;
    constructor(params: { id: unknown; accessHash: unknown }) {
      this.id = params.id;
      this.accessHash = params.accessHash;
    }
  }
  class FakeInputStickerSetShortName {
    shortName: unknown;
    constructor(params: { shortName: unknown }) {
      this.shortName = params.shortName;
    }
  }
  class FakeGetAllStickers {
    hash: unknown;
    constructor(params: { hash: unknown }) {
      this.hash = params.hash;
    }
  }
  class FakeGetCustomEmojiDocuments {
    documentId: unknown;
    constructor(params: { documentId: unknown }) {
      this.documentId = params.documentId;
    }
  }
  class FakeGetStickerSet {
    stickerset: unknown;
    hash: unknown;
    constructor(params: { stickerset: unknown; hash: unknown }) {
      this.stickerset = params.stickerset;
      this.hash = params.hash;
    }
  }
  class FakeInstallStickerSet {
    stickerset: unknown;
    archived: unknown;
    constructor(params: { stickerset: unknown; archived: unknown }) {
      this.stickerset = params.stickerset;
      this.archived = params.archived;
    }
  }
  class FakeUninstallStickerSet {
    stickerset: unknown;
    constructor(params: { stickerset: unknown }) {
      this.stickerset = params.stickerset;
    }
  }
  // The inline keyboard constructors the message mapper narrows on, plus the
  // request a press sends. Only the fields the adapter reads are modelled.
  class FakeReplyInlineMarkup {
    rows: ReadonlyArray<{ buttons: ReadonlyArray<unknown> }>;
    constructor(params: {
      rows: ReadonlyArray<{ buttons: ReadonlyArray<unknown> }>;
    }) {
      this.rows = params.rows;
    }
  }
  class FakeInlineButtonTypeCallback {
    data: Buffer;
    constructor(params: { data: Buffer }) {
      this.data = params.data;
    }
  }
  class FakeInlineButtonTypeUrl {
    url: string;
    constructor(params: { url: string }) {
      this.url = params.url;
    }
  }
  class FakeInlineButtonTypeCopy {
    copyText: string;
    constructor(params: { copyText: string }) {
      this.copyText = params.copyText;
    }
  }
  class FakeGetBotCallbackAnswer {
    peer: unknown;
    msgId: unknown;
    data: unknown;
    constructor(params: { peer: unknown; msgId: unknown; data: unknown }) {
      this.peer = params.peer;
      this.msgId = params.msgId;
      this.data = params.data;
    }
  }

  return {
    FakeTelegramClient,
    FakeUpdateDraftMessage,
    FakeDraftMessage,
    FakeUser,
    FakeChannel,
    FakeChat,
    FakeUserStatusOnline,
    FakeUpdateUserStatus,
    FakeInputMessagesFilterPhotoVideo,
    FakeInputMessagesFilterDocument,
    FakeInputMessagesFilterPinned,
    FakeUpdatePinnedMessages,
    FakeUpdatePinnedChannelMessages,
    FakePeerChannel,
    FakeGetFullUser,
    FakeGetFullChannel,
    FakeMessageMediaDocument,
    FakeInputStickerSetID,
    FakeGetAllStickers,
    FakeGetCustomEmojiDocuments,
    FakeGetStickerSet,
    FakeInputStickerSetShortName,
    FakeInstallStickerSet,
    FakeUninstallStickerSet,
    FakeReplyInlineMarkup,
    FakeInlineButtonTypeCallback,
    FakeInlineButtonTypeUrl,
    FakeInlineButtonTypeCopy,
    FakeGetBotCallbackAnswer,
  };
});

vi.mock("teleproto", () => ({
  TelegramClient: fake.FakeTelegramClient,
  Api: {
    UpdateDraftMessage: fake.FakeUpdateDraftMessage,
    DraftMessage: fake.FakeDraftMessage,
    User: fake.FakeUser,
    Channel: fake.FakeChannel,
    Chat: fake.FakeChat,
    UserStatusOnline: fake.FakeUserStatusOnline,
    UpdateUserStatus: fake.FakeUpdateUserStatus,
    InputMessagesFilterPhotoVideo: fake.FakeInputMessagesFilterPhotoVideo,
    InputMessagesFilterDocument: fake.FakeInputMessagesFilterDocument,
    InputMessagesFilterPinned: fake.FakeInputMessagesFilterPinned,
    UpdatePinnedMessages: fake.FakeUpdatePinnedMessages,
    UpdatePinnedChannelMessages: fake.FakeUpdatePinnedChannelMessages,
    PeerChannel: fake.FakePeerChannel,
    MessageMediaDocument: fake.FakeMessageMediaDocument,
    InputStickerSetID: fake.FakeInputStickerSetID,
    InputStickerSetShortName: fake.FakeInputStickerSetShortName,
    ReplyInlineMarkup: fake.FakeReplyInlineMarkup,
    InlineButtonTypeCallback: fake.FakeInlineButtonTypeCallback,
    InlineButtonTypeUrl: fake.FakeInlineButtonTypeUrl,
    InlineButtonTypeCopy: fake.FakeInlineButtonTypeCopy,
    users: { GetFullUser: fake.FakeGetFullUser },
    channels: { GetFullChannel: fake.FakeGetFullChannel },
    messages: {
      GetAllStickers: fake.FakeGetAllStickers,
      GetStickerSet: fake.FakeGetStickerSet,
      InstallStickerSet: fake.FakeInstallStickerSet,
      UninstallStickerSet: fake.FakeUninstallStickerSet,
      GetCustomEmojiDocuments: fake.FakeGetCustomEmojiDocuments,
      GetBotCallbackAnswer: fake.FakeGetBotCallbackAnswer,
    },
  },
  // teleproto's own returnBigInt normalises into its big-integer type; the
  // identity keeps the value the adapter computed assertable as a bigint.
  helpers: { returnBigInt: (value: unknown) => value },
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
    mediaCacheDirectory?: string;
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
    options.mediaCacheDirectory ?? "",
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

// A document as messages.GetStickerSet answers it: the emoji lives on the
// sticker attribute and the pixel size on the image or video one, both of
// which a set may leave out.
function fakeStickerDocument(
  id: number,
  options: {
    mimeType: string;
    emoji?: string;
    dimensions?: { w: number; h: number };
    /** PhotoPathSize bytes; a set may ship stickers without one. */
    outlineBytes?: Uint8Array;
  },
) {
  const attributes: object[] = [];
  if (options.emoji) attributes.push({ alt: options.emoji, stickerset: {} });
  if (options.dimensions) attributes.push(options.dimensions);
  return {
    id: BigInt(id),
    accessHash: BigInt(id + 1000),
    mimeType: options.mimeType,
    size: BigInt(2048),
    attributes,
    thumbs: options.outlineBytes
      ? [{ type: "j", bytes: options.outlineBytes }]
      : [],
  };
}

/** Decodes to "MA10z" — see sticker-outline.test.ts. */
const STICKER_OUTLINE_BYTES = Uint8Array.from([192, 10]);

const stickerSetHeader = {
  id: BigInt(9),
  accessHash: BigInt(99),
  title: "Telo Faces",
  shortName: "telofaces",
  // The per-set content hash the list hash is folded from. With a single
  // installed set the fold is `0 mixed to 0, plus this`, so the list hash the
  // next messages.getAllStickers carries is exactly this number.
  hash: 1234,
};

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
    FakeTelegramClient.downloadMediaBehavior = null;
    FakeTelegramClient.getMessagesBehavior = null;
    FakeTelegramClient.entityBehavior = null;
    FakeTelegramClient.invokeBehavior = null;
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
      5,
    );
  });

  it("forwards formatting entities through the coordinator to the repository", async () => {
    const { coordinator } = createCoordinator();

    const message = await coordinator.sendMessage(
      "saved",
      "Hello team",
      undefined,
      undefined,
      undefined,
      [{ type: "bold", offset: 0, length: 5 }],
    );

    // The coordinator is a delegating wrapper; dropping this argument loses
    // every composer format silently, with both ends still passing on their
    // own.
    expect(message.entities).toEqual([{ type: "bold", offset: 0, length: 5 }]);
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

  it("paints the restoring snapshot from the avatar cache without downloading", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "telo-avatars-"));
    try {
      // dialogs.json never carries photo bytes, so a restored chat starts with
      // a null avatar and the disk cache is the only thing that can fill it
      // before the session finishes connecting.
      await writeFile(
        path.join(directory, "avatar_cached.jpg"),
        Buffer.from("cached"),
      );
      const snapshots = new MemoryTelegramDialogSnapshotRepository();
      const base = {
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
      } satisfies Omit<ChatDto, "id" | "title">;
      await snapshots.save({
        version: 1,
        chats: [
          { ...base, id: "cached", title: "Cached" },
          { ...base, id: "uncached", title: "Uncached" },
        ],
        folders: [],
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
        mediaCacheDirectory: directory,
      });
      const init = coordinator.initialize();
      await vi.waitFor(() => {
        expect(coordinator.getAuthState()).toEqual({ status: "restoring" });
      });

      const page = await coordinator.listChatPage();

      expect(page.items[0]).toMatchObject({
        id: "cached",
        avatarDataUrl: "telo-media://cache/avatar_cached.jpg",
        avatarPending: false,
      });
      // No cached file means the photo is still unresolved, not absent: the
      // row keeps its skeleton until the live session settles it.
      expect(page.items[1]).toMatchObject({
        id: "uncached",
        avatarDataUrl: null,
        avatarPending: true,
      });
      // Restore paints from disk only; nothing is fetched before connect.
      expect(FakeTelegramClient.photoRequests).toEqual([]);

      releaseConnect?.();
      await init;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

  it("logs user-facing catch-up failures without publishing a sync-error", async () => {
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
      ]);
      expect(
        events.filter(
          (event) => (event as { type?: string }).type === "sync-error",
        ),
      ).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });

  it("reports a dropped transport as a connection state, not a sync error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // What teleproto throws once its sender is gone. Telegram treats this as
    // ConnectionStateConnecting, so it belongs in the chat list title rather
    // than in an error surface the reader cannot act on.
    FakeTelegramClient.catchUpBehavior = async () => {
      throw new Error(
        "Cannot send requests while disconnected. Please reconnect.",
      );
    };
    const { coordinator } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });
    const events: TelegramWorkspaceEvent[] = [];
    coordinator.subscribe((event) => events.push(event));
    try {
      await coordinator.initialize();
      const client = FakeTelegramClient.instances[0];
      if (client) client.connected = false;

      await client?.emitConnectionState(-1);
      await client?.emitConnectionState(1);

      // Still logged in the main process — the failure is not swallowed.
      expect(logged).toHaveBeenCalledWith(
        "Telegram sync failed",
        expect.any(Error),
      );
      expect(events.filter((event) => event.type === "sync-error")).toEqual([]);
      expect(events.at(-1)).toEqual({
        type: "connection-state",
        state: "offline",
      });
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
    expect(page.items.every((entry) => entry.avatarPending === true)).toBe(
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

  it("emits a null chat-avatar so the slot can leave the skeleton", async () => {
    FakeTelegramClient.dialogs = [
      {
        id: BigInt(1),
        title: "Chat 1",
        name: "Chat 1",
        dialog: { notifySettings: {}, topMessage: 1 },
        isUser: true,
        isChannel: false,
        isGroup: false,
        entity: { id: BigInt(1), accessHash: BigInt(101) },
        message: { message: "Preview" },
        date: 1,
        unreadCount: 0,
        pinned: false,
      },
    ];
    const { coordinator } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    await coordinator.initialize();
    const page = await coordinator.listChatPage({ limit: 1 });
    expect(page.items[0]?.avatarPending).toBe(true);

    FakeTelegramClient.photoRequests[0]?.resolve(null);
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "chat-avatar",
        chatId: "1",
        avatarDataUrl: null,
      });
    });
  });

  it("paints a disk-cached photo without downloading it again", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "telo-avatars-"));
    try {
      await writeFile(
        path.join(directory, "avatar_1.jpg"),
        Buffer.from("cached"),
      );
      FakeTelegramClient.dialogs = [
        {
          id: BigInt(1),
          title: "Chat 1",
          name: "Chat 1",
          dialog: { notifySettings: {}, topMessage: 1 },
          isUser: true,
          isChannel: false,
          isGroup: false,
          entity: { id: BigInt(1), accessHash: BigInt(101) },
          message: { message: "Preview" },
          date: 1,
          unreadCount: 0,
          pinned: false,
        },
        {
          id: BigInt(2),
          title: "Chat 2",
          name: "Chat 2",
          dialog: { notifySettings: {}, topMessage: 2 },
          isUser: true,
          isChannel: false,
          isGroup: false,
          entity: { id: BigInt(2), accessHash: BigInt(102) },
          message: { message: "Preview" },
          date: 1,
          unreadCount: 0,
          pinned: false,
        },
      ];
      const { coordinator } = createCoordinator({
        session: "stored-session",
        credentials: { apiId: 7, apiHash: "hash" },
        mediaCacheDirectory: directory,
      });
      await coordinator.initialize();
      const page = await coordinator.listChatPage({ limit: 2 });
      expect(page.items[0]).toMatchObject({
        id: "1",
        avatarDataUrl: "telo-media://cache/avatar_1.jpg",
        avatarPending: false,
      });
      expect(page.items[1]).toMatchObject({
        id: "2",
        avatarDataUrl: null,
        avatarPending: true,
      });
      await vi.waitFor(() => {
        expect(FakeTelegramClient.photoRequests).toHaveLength(1);
      });
      expect(FakeTelegramClient.photoRequests[0]?.entity).toMatchObject({
        id: BigInt(2),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

  it("resolves the forward target in Telegram's order: savedFrom, channel post, bare peer, name only", async () => {
    const coordinator = await connectedCoordinator();
    FakeTelegramClient.entityBehavior = async (entity) => {
      const peer = entity as { channelId?: unknown; userId?: unknown };
      if (peer?.channelId != null) return { title: "Telo Channel" };
      return { firstName: "Mina", lastName: "K" };
    };
    FakeTelegramClient.getMessagesBehavior = async () => [
      {
        id: 5,
        message: "Saved copy",
        date: 1_700_000_005,
        out: false,
        // The explicit pointer: the copy knows both the chat it was saved
        // out of and the message inside it, while the header still names the
        // original author.
        fwdFrom: {
          fromId: { userId: BigInt(1) },
          savedFromPeer: new fake.FakePeerChannel({ channelId: BigInt(77) }),
          savedFromMsgId: 31,
        },
        getSender: async () => ({ firstName: "You" }),
      },
      {
        id: 6,
        message: "Channel post",
        date: 1_700_000_006,
        out: false,
        // A channel post forwarded elsewhere carries no saved_from_* pair;
        // channelPost plus a channel fromId is the only way back to it.
        fwdFrom: {
          fromId: new fake.FakePeerChannel({ channelId: BigInt(88) }),
          channelPost: 12,
          postAuthor: "Mina K",
        },
        getSender: async () => ({ firstName: "You" }),
      },
      {
        id: 7,
        message: "Peer forward",
        date: 1_700_000_007,
        out: false,
        fwdFrom: { fromId: { userId: BigInt(1) } },
        getSender: async () => ({ firstName: "You" }),
      },
      {
        id: 8,
        message: "Named forward",
        date: 1_700_000_008,
        out: false,
        // fromName only: the author disallowed linking back.
        fwdFrom: { fromName: "Hidden Author" },
        getSender: async () => ({ firstName: "You" }),
      },
      {
        id: 9,
        message: "Plain message",
        date: 1_700_000_009,
        out: false,
        getSender: async () => ({ firstName: "You" }),
      },
    ];

    const page = await coordinator.listMessagePage("chat-1", { limit: 50 });

    expect(page.items.map((message) => message.forwardedFrom)).toEqual([
      {
        senderName: "Mina K",
        senderId: "77",
        messageId: "31",
        postAuthor: null,
      },
      {
        senderName: "Telo Channel",
        senderId: "88",
        messageId: "12",
        postAuthor: "Mina K",
      },
      {
        senderName: "Mina K",
        senderId: "1",
        messageId: null,
        postAuthor: null,
      },
      {
        senderName: "Hidden Author",
        senderId: null,
        messageId: null,
        postAuthor: null,
      },
      null,
    ]);
  });

  it("leaves a forward unattributed when its peer does not resolve", async () => {
    const coordinator = await connectedCoordinator();
    FakeTelegramClient.entityBehavior = async () => {
      throw new Error("Could not find the input entity");
    };
    FakeTelegramClient.getMessagesBehavior = async () => [
      {
        id: 5,
        message: "Peer forward",
        date: 1_700_000_005,
        out: false,
        fwdFrom: { fromId: { userId: BigInt(1) } },
        getSender: async () => ({ firstName: "You" }),
      },
    ];

    const page = await coordinator.listMessagePage("chat-1", { limit: 50 });

    // A header nobody can name is indistinguishable from a hidden sender,
    // and it must not fail the surrounding message mapping.
    expect(page.items[0]?.forwardedFrom).toBeNull();
    expect(page.items[0]?.body).toBe("Peer forward");
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

  it("maps the author peer id and schedules one avatar download per sender", async () => {
    const sender = {
      id: BigInt(42),
      accessHash: BigInt(4242),
      firstName: "Mina",
    };
    const coordinator = await connectedCoordinator();
    FakeTelegramClient.getMessagesBehavior = async () => [
      {
        id: 9,
        message: "Hello",
        date: 1_700_000_009,
        out: false,
        getSender: async () => sender,
      },
    ];

    const page = await coordinator.listMessagePage("chat-1", { limit: 50 });

    expect(page.items[0]).toMatchObject({
      senderId: "42",
      senderName: "Mina",
      senderAvatarUrl: null,
      senderAvatarPending: true,
    });
    await vi.waitFor(() => {
      expect(FakeTelegramClient.photoRequests).toHaveLength(1);
    });
    // The download takes the peer, not the bare id: channels and migrated
    // groups are only addressable with the access hash it carries.
    expect(FakeTelegramClient.photoRequests[0]?.entity).toBe(sender);
  });

  it("reuses the cached author photo for the next message from the same sender", async () => {
    const sender = {
      id: BigInt(42),
      accessHash: BigInt(4242),
      firstName: "Mina",
    };
    const message = (id: number) => ({
      id,
      message: `Message ${id}`,
      date: 1_700_000_000 + id,
      out: false,
      getSender: async () => sender,
    });
    const coordinator = await connectedCoordinator();
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));
    FakeTelegramClient.getMessagesBehavior = async () => [message(9)];
    await coordinator.listMessagePage("chat-1", { limit: 50 });
    await vi.waitFor(() => {
      expect(FakeTelegramClient.photoRequests).toHaveLength(1);
    });

    FakeTelegramClient.photoRequests[0]?.resolve(Buffer.from("photo"));
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "chat-avatar",
        chatId: "42",
        avatarDataUrl: "data:image/jpeg;base64,cGhvdG8=",
      });
    });
    FakeTelegramClient.getMessagesBehavior = async () => [message(10)];
    const second = await coordinator.listMessagePage("chat-1", { limit: 50 });

    expect(second.items[0]).toMatchObject({
      senderId: "42",
      senderAvatarUrl: "data:image/jpeg;base64,cGhvdG8=",
      senderAvatarPending: false,
    });
    expect(FakeTelegramClient.photoRequests).toHaveLength(1);
  });

  it("paints a disk-cached author photo without downloading it again", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "telo-avatars-"));
    try {
      await writeFile(
        path.join(directory, "avatar_42.jpg"),
        Buffer.from("cached"),
      );
      const { coordinator } = createCoordinator({
        session: "stored-session",
        credentials: { apiId: 7, apiHash: "hash" },
        mediaCacheDirectory: directory,
      });
      await coordinator.initialize();
      // The chat list is what hydrates the avatar cache from disk.
      await coordinator.listChatPage({ limit: 1 });
      FakeTelegramClient.getMessagesBehavior = async () => [
        {
          id: 9,
          message: "Hello",
          date: 1_700_000_009,
          out: false,
          getSender: async () => ({
            id: BigInt(42),
            accessHash: BigInt(4242),
            firstName: "Mina",
          }),
        },
      ];

      const page = await coordinator.listMessagePage("chat-1", { limit: 50 });

      expect(page.items[0]).toMatchObject({
        senderId: "42",
        senderAvatarUrl: "telo-media://cache/avatar_42.jpg",
        senderAvatarPending: false,
      });
      expect(FakeTelegramClient.photoRequests).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns the identity card of a peer with no dialog", async () => {
    const coordinator = await connectedCoordinator();
    const peer = Object.assign(new fake.FakeUser(), {
      id: BigInt(42),
      accessHash: BigInt(4242),
      firstName: "Mina",
      lastName: "K",
      username: "mina",
    });
    FakeTelegramClient.entityBehavior = async () => peer;
    FakeTelegramClient.invokeBehavior = async (request) => {
      if (!(request instanceof fake.FakeGetFullUser)) {
        throw new Error("Expected a users.GetFullUser request");
      }
      expect(request.id).toBe(peer);
      return {
        fullUser: { about: "Ships things" },
        users: [Object.assign(new fake.FakeUser(), { phone: "12025550123" })],
      };
    };

    await expect(coordinator.getPeerProfile("42")).resolves.toEqual({
      id: "42",
      title: "Mina K",
      username: "mina",
      kind: "direct",
      avatarDataUrl: null,
      avatarPending: true,
      bio: "Ships things",
      phone: "12025550123",
    });
  });

  it("maps a broadcast channel peer through the full-channel request", async () => {
    const coordinator = await connectedCoordinator();
    const peer = Object.assign(new fake.FakeChannel(), {
      id: BigInt(77),
      accessHash: BigInt(7777),
      broadcast: true,
      title: "Telo News",
      username: "telonews",
    });
    FakeTelegramClient.entityBehavior = async () => peer;
    FakeTelegramClient.invokeBehavior = async (request) => {
      if (!(request instanceof fake.FakeGetFullChannel)) {
        throw new Error("Expected a channels.GetFullChannel request");
      }
      expect(request.channel).toBe(peer);
      return { fullChat: { about: "Release notes" } };
    };

    await expect(coordinator.getPeerProfile("77")).resolves.toMatchObject({
      title: "Telo News",
      username: "telonews",
      kind: "channel",
      bio: "Release notes",
      phone: null,
    });
  });

  it("schedules one shared avatar download for an uncached profile peer", async () => {
    const coordinator = await connectedCoordinator();
    const peer = Object.assign(new fake.FakeUser(), {
      id: BigInt(42),
      accessHash: BigInt(4242),
      firstName: "Mina",
    });
    FakeTelegramClient.entityBehavior = async () => peer;
    FakeTelegramClient.invokeBehavior = async () => ({
      fullUser: {},
      users: [],
    });
    const events: unknown[] = [];
    coordinator.subscribe((event) => events.push(event));

    await coordinator.getPeerProfile("42");
    await coordinator.getPeerProfile("42");

    // The queue is shared with the chat list: the peer already queued keeps
    // one download, and the photo settles through the chat-avatar event.
    await vi.waitFor(() => {
      expect(FakeTelegramClient.photoRequests).toHaveLength(1);
    });
    expect(FakeTelegramClient.photoRequests[0]?.entity).toBe(peer);

    FakeTelegramClient.photoRequests[0]?.resolve(Buffer.from("photo"));
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "chat-avatar",
        chatId: "42",
        avatarDataUrl: "data:image/jpeg;base64,cGhvdG8=",
      });
    });
  });

  it("keeps the profile identity when Telegram hides the peer details", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const coordinator = await connectedCoordinator();
      FakeTelegramClient.entityBehavior = async () =>
        Object.assign(new fake.FakeUser(), {
          id: BigInt(42),
          firstName: "Mina",
          username: "mina",
        });
      FakeTelegramClient.invokeBehavior = async () => {
        throw new Error("USER_PRIVACY_RESTRICTED");
      };

      await expect(coordinator.getPeerProfile("42")).resolves.toMatchObject({
        id: "42",
        title: "Mina",
        username: "mina",
        kind: "direct",
        bio: null,
        phone: null,
      });
      expect(logged).toHaveBeenCalledWith(
        "Telegram peer details failed",
        expect.any(Error),
      );
    } finally {
      logged.mockRestore();
    }
  });

  it("rejects a profile lookup for a peer Telegram cannot resolve", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const coordinator = await connectedCoordinator();
      FakeTelegramClient.entityBehavior = async () => {
        throw new Error("PEER_ID_INVALID");
      };

      await expect(coordinator.getPeerProfile("999")).rejects.toThrow(
        "Telegram peer 999 was not found",
      );
      expect(FakeTelegramClient.photoRequests).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });

  it("maps an installed sticker set into downloadable picker items", async () => {
    const coordinator = await connectedCoordinator();
    const documents = [
      fakeStickerDocument(501, {
        mimeType: "image/webp",
        emoji: "😀",
        dimensions: { w: 512, h: 512 },
        outlineBytes: STICKER_OUTLINE_BYTES,
      }),
      fakeStickerDocument(502, { mimeType: "application/x-tgsticker" }),
      fakeStickerDocument(503, {
        mimeType: "video/webm",
        emoji: "🎉",
        dimensions: { w: 384, h: 384 },
      }),
      // documentEmpty: a sticker Telegram no longer serves, so it has no mime
      // type to draw or send and drops out of the set.
      { id: BigInt(504) },
    ];
    FakeTelegramClient.invokeBehavior = async (request) => {
      if (request instanceof fake.FakeGetAllStickers) {
        return { sets: [stickerSetHeader] };
      }
      if (!(request instanceof fake.FakeGetStickerSet)) {
        throw new Error("Expected a messages.GetStickerSet request");
      }
      expect(request.stickerset).toBeInstanceOf(fake.FakeInputStickerSetID);
      expect(request.stickerset).toMatchObject({
        id: stickerSetHeader.id,
        accessHash: stickerSetHeader.accessHash,
      });
      return { documents };
    };

    await expect(coordinator.listStickerSets()).resolves.toEqual([
      {
        id: "9",
        title: "Telo Faces",
        shortName: "telofaces",
        // The picker lists what the account already has.
        installed: true,
        stickers: [
          {
            id: "sticker/501",
            emoji: "😀",
            format: "static",
            width: 512,
            height: 512,
            // The set's vector thumbnail is decoded main-side, so the picker
            // can draw the silhouette before any document downloads.
            outlinePath: "MA10z",
          },
          {
            id: "sticker/502",
            emoji: null,
            format: "animated",
            width: null,
            height: null,
            outlinePath: null,
          },
          {
            id: "sticker/503",
            emoji: "🎉",
            format: "video",
            width: 384,
            height: 384,
            outlinePath: null,
          },
        ],
      },
    ]);
  });

  it("skips a sticker set Telegram cannot resolve and keeps the rest", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const coordinator = await connectedCoordinator();
      const sets = [
        {
          id: BigInt(1),
          accessHash: BigInt(11),
          title: "Gone",
          shortName: "gone",
        },
        {
          id: BigInt(2),
          accessHash: BigInt(22),
          title: "Kept",
          shortName: "kept",
        },
      ];
      FakeTelegramClient.invokeBehavior = async (request) => {
        if (request instanceof fake.FakeGetAllStickers) return { sets };
        if (!(request instanceof fake.FakeGetStickerSet)) {
          throw new Error("Expected a messages.GetStickerSet request");
        }
        const requested =
          request.stickerset instanceof fake.FakeInputStickerSetID
            ? String(request.stickerset.id)
            : "";
        if (requested === "1") throw new Error("STICKERSET_INVALID");
        return {
          documents: [
            fakeStickerDocument(601, { mimeType: "image/webp", emoji: "👋" }),
          ],
        };
      };

      await expect(coordinator.listStickerSets()).resolves.toEqual([
        {
          id: "2",
          title: "Kept",
          shortName: "kept",
          installed: true,
          stickers: [
            {
              id: "sticker/601",
              emoji: "👋",
              format: "static",
              width: null,
              height: null,
              outlinePath: null,
            },
          ],
        },
      ]);
      expect(logged).toHaveBeenCalledWith(
        "Telegram sticker set gone failed",
        expect.any(Error),
      );
    } finally {
      logged.mockRestore();
    }
  });

  it("sends the computed list hash and skips the set requests when Telegram answers not-modified", async () => {
    const coordinator = await connectedCoordinator();
    const documents = [
      fakeStickerDocument(501, { mimeType: "image/webp", emoji: "😀" }),
    ];
    const listHashes: string[] = [];
    let setRequests = 0;
    let notModified = false;
    FakeTelegramClient.invokeBehavior = async (request) => {
      if (request instanceof fake.FakeGetAllStickers) {
        listHashes.push(String(request.hash));
        // messages.allStickersNotModified carries no `sets` field at all.
        return notModified ? {} : { sets: [stickerSetHeader] };
      }
      if (!(request instanceof fake.FakeGetStickerSet)) {
        throw new Error("Expected a messages.GetStickerSet request");
      }
      setRequests += 1;
      return { documents };
    };

    const first = await coordinator.listStickerSets();
    notModified = true;
    const second = await coordinator.listStickerSets();

    // Nothing is cached for the first call, so it sends the zero hash; the
    // second sends what the answered list folds to.
    expect(listHashes).toEqual(["0", "1234"]);
    // The not-modified answer stands in for the whole list, so not one set is
    // fetched again.
    expect(setRequests).toBe(1);
    expect(second).toEqual(first);
  });

  it("keeps a not-modified list's stickers downloadable after other stickers flood the document cache", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "telo-notmod-"));
    try {
      const { coordinator } = createCoordinator({
        session: "stored-session",
        credentials: { apiId: 7, apiHash: "hash" },
        mediaCacheDirectory: directory,
      });
      await coordinator.initialize();
      const document = fakeStickerDocument(501, {
        mimeType: "image/webp",
        emoji: "😀",
      });
      // As many documents as STICKER_DOCUMENT_CACHE_LIMIT, so caching them
      // all pushes exactly one entry out: the picker's sticker, the oldest.
      const flood = Array.from({ length: 4000 }, (_, index) =>
        fakeStickerDocument(10_000 + index, { mimeType: "image/webp" }),
      );
      let notModified = false;
      FakeTelegramClient.invokeBehavior = async (request) => {
        if (request instanceof fake.FakeGetAllStickers) {
          return notModified ? {} : { sets: [stickerSetHeader] };
        }
        if (request instanceof fake.FakeGetCustomEmojiDocuments) return flood;
        return { documents: [document] };
      };
      FakeTelegramClient.downloadMediaBehavior = async (_media, params) => {
        await writeFile(params.outputFile, "sticker-bytes");
      };

      await coordinator.listStickerSets();
      await coordinator.getCustomEmoji(flood.map((entry) => String(entry.id)));
      notModified = true;
      await coordinator.listStickerSets();

      // Drawing a listed sticker needs the document behind its media id, not
      // the DTO: the id outlived the flood only because the not-modified path
      // put that document back instead of trusting the cached DTOs alone.
      await coordinator.downloadMedia("sticker/501");
      expect(FakeTelegramClient.instances.at(-1)?.downloadMediaCalls).toEqual([
        expect.objectContaining({ document }),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resolves the installed list again after the account installs a set", async () => {
    const coordinator = await connectedCoordinator();
    const documents = [
      fakeStickerDocument(501, { mimeType: "image/webp", emoji: "😀" }),
    ];
    const listHashes: string[] = [];
    let setRequests = 0;
    FakeTelegramClient.invokeBehavior = async (request) => {
      if (request instanceof fake.FakeGetAllStickers) {
        listHashes.push(String(request.hash));
        return { sets: [stickerSetHeader] };
      }
      if (request instanceof fake.FakeInstallStickerSet) return {};
      setRequests += 1;
      return { documents };
    };

    await coordinator.listStickerSets();
    await coordinator.setStickerSetInstalled("teloocto", true);
    await coordinator.listStickerSets();

    // The install falsified the cached list, so the next call asks with the
    // zero hash again and resolves the sets it is answered with.
    expect(listHashes).toEqual(["0", "0"]);
    expect(setRequests).toBe(2);
  });

  it("downloads a set sticker from its cached document, not from a message", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "telo-stickers-"));
    try {
      const { coordinator } = createCoordinator({
        session: "stored-session",
        credentials: { apiId: 7, apiHash: "hash" },
        mediaCacheDirectory: directory,
      });
      await coordinator.initialize();
      const client = FakeTelegramClient.instances.at(-1);
      const document = fakeStickerDocument(501, {
        mimeType: "image/webp",
        emoji: "😀",
      });
      FakeTelegramClient.invokeBehavior = async (request) =>
        request instanceof fake.FakeGetAllStickers
          ? { sets: [stickerSetHeader] }
          : { documents: [document] };
      FakeTelegramClient.downloadMediaBehavior = async (_media, params) => {
        await writeFile(params.outputFile, "sticker-bytes");
      };
      const events: unknown[] = [];
      coordinator.subscribe((event) => events.push(event));

      await coordinator.listStickerSets();
      await coordinator.downloadMedia("sticker/501");

      // A set sticker has no carrying message, so nothing may be fetched.
      expect(client?.getMessagesCalls).toEqual([]);
      expect(client?.downloadMediaCalls).toEqual([
        expect.objectContaining({ document }),
      ]);
      expect(events).toContainEqual({
        type: "media-download",
        mediaId: "sticker/501",
        state: "ready",
        downloadedBytes: 13,
        totalBytes: 13,
        url: "telo-media://cache/sticker_501.webp",
        error: null,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a sticker media id no listed set resolved", async () => {
    const coordinator = await connectedCoordinator();

    await expect(coordinator.downloadMedia("sticker/999")).rejects.toThrow(
      "Telegram sticker sticker/999 was not found",
    );
    await expect(
      coordinator.sendSticker("chat-1", "sticker/999"),
    ).rejects.toThrow("Telegram sticker sticker/999 was not found");
  });

  it("sends a listed sticker as its cached document", async () => {
    const coordinator = await connectedCoordinator();
    const document = fakeStickerDocument(501, {
      mimeType: "image/webp",
      emoji: "😀",
      dimensions: { w: 512, h: 512 },
    });
    FakeTelegramClient.invokeBehavior = async (request) =>
      request instanceof fake.FakeGetAllStickers
        ? { sets: [stickerSetHeader] }
        : { documents: [document] };
    FakeTelegramClient.sendFileBehavior = async () => ({
      id: 77,
      message: "",
      date: 1_700_000_000,
      out: true,
      sticker: document,
      document,
      file: { mimeType: "image/webp", size: 2048 },
      getSender: async () => ({ firstName: "You" }),
    });

    await coordinator.listStickerSets();

    await expect(
      coordinator.sendSticker("chat-1", "sticker/501"),
    ).resolves.toMatchObject({
      id: "77",
      chatId: "chat-1",
      body: "",
      outgoing: true,
      status: "sent",
      media: {
        id: "chat-1/77",
        kind: "sticker",
        sticker: { emoji: "😀", format: "static", setName: null },
      },
    });
    const call = FakeTelegramClient.instances.at(-1)?.sendFileCalls[0];
    expect(call?.entity).toBe("chat-1");
    // Telegram already stores the document, so the send carries it by id
    // instead of uploading the sticker bytes again.
    expect(call?.params.file).toBe(document);
  });

  it("opens a sticker set by short name and reads its installed marker", async () => {
    const coordinator = await connectedCoordinator();
    // The fake reads this when the request runs, and the second call flips it
    // to prove the installed marker is read from Telegram, not assumed.
    let installedDate: number | undefined = undefined;
    FakeTelegramClient.invokeBehavior = async (request) => {
      if (!(request instanceof fake.FakeGetStickerSet)) {
        throw new Error("Expected a messages.GetStickerSet request");
      }
      expect(request.stickerset).toBeInstanceOf(
        fake.FakeInputStickerSetShortName,
      );
      expect(request.stickerset).toMatchObject({ shortName: "teloocto" });
      return {
        set: {
          id: BigInt(12),
          accessHash: BigInt(120),
          title: "Telo Octo",
          shortName: "teloocto",
          installedDate,
        },
        documents: [
          fakeStickerDocument(701, {
            mimeType: "image/webp",
            emoji: "🐙",
            dimensions: { w: 512, h: 512 },
          }),
        ],
      };
    };

    // A set opened from a received sticker is one the account may not have.
    await expect(coordinator.getStickerSet("teloocto")).resolves.toEqual({
      id: "12",
      title: "Telo Octo",
      shortName: "teloocto",
      installed: false,
      stickers: [
        {
          id: "sticker/701",
          emoji: "🐙",
          format: "static",
          width: 512,
          height: 512,
          outlinePath: null,
        },
      ],
    });

    installedDate = 1_700_000_000;
    await expect(coordinator.getStickerSet("teloocto")).resolves.toMatchObject({
      installed: true,
    });
  });

  it("caches an opened set's stickers so they download without a message", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "telo-sheet-"));
    try {
      const { coordinator } = createCoordinator({
        session: "stored-session",
        credentials: { apiId: 7, apiHash: "hash" },
        mediaCacheDirectory: directory,
      });
      await coordinator.initialize();
      const client = FakeTelegramClient.instances.at(-1);
      const document = fakeStickerDocument(702, {
        mimeType: "image/webp",
        emoji: "🐙",
      });
      FakeTelegramClient.invokeBehavior = async () => ({
        set: stickerSetHeader,
        documents: [document],
      });
      FakeTelegramClient.downloadMediaBehavior = async (_media, params) => {
        await writeFile(params.outputFile, "sticker-bytes");
      };

      await coordinator.getStickerSet("telofaces");
      await coordinator.downloadMedia("sticker/702");

      // The sheet's stickers ride the picker's document cache, so they need
      // no carrying message either.
      expect(client?.getMessagesCalls).toEqual([]);
      expect(client?.downloadMediaCalls).toEqual([
        expect.objectContaining({ document }),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a sticker set short name Telegram cannot resolve", async () => {
    const coordinator = await connectedCoordinator();
    FakeTelegramClient.invokeBehavior = async () => {
      throw new Error("STICKERSET_INVALID");
    };

    await expect(coordinator.getStickerSet("gone")).rejects.toThrow(
      "Telegram sticker set gone was not found",
    );
  });

  it("installs and uninstalls a sticker set by short name", async () => {
    const coordinator = await connectedCoordinator();
    FakeTelegramClient.invokeBehavior = async () => ({});
    const client = FakeTelegramClient.instances.at(-1);

    await coordinator.setStickerSetInstalled("telofaces", true);
    await coordinator.setStickerSetInstalled("telofaces", false);

    const requests = client?.invokeCalls ?? [];
    const install = requests.find(
      (request) => request instanceof fake.FakeInstallStickerSet,
    );
    const uninstall = requests.find(
      (request) => request instanceof fake.FakeUninstallStickerSet,
    );
    expect(install).toMatchObject({
      // archived: false adds the set to the active stickers, not the archive.
      archived: false,
      stickerset: { shortName: "telofaces" },
    });
    expect(uninstall).toMatchObject({
      stickerset: { shortName: "telofaces" },
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

  // One bot message carrying every button kind, so mapping and pressing are
  // exercised against the same keyboard the adapter indexed.
  function botMessage() {
    return {
      id: 77,
      message: "Build 482 finished",
      date: 1_700_000_077,
      out: false,
      getSender: async () => ({ firstName: "Telo Bot" }),
      replyMarkup: new fake.FakeReplyInlineMarkup({
        rows: [
          {
            buttons: [
              {
                text: "Approve",
                type: new fake.FakeInlineButtonTypeCallback({
                  data: Buffer.from("approve:482"),
                }),
              },
              {
                text: "Logs",
                type: new fake.FakeInlineButtonTypeUrl({
                  url: "https://example.com/logs",
                }),
              },
            ],
          },
          { buttons: [] },
          {
            buttons: [
              {
                text: "Copy id",
                type: new fake.FakeInlineButtonTypeCopy({
                  copyText: "build-482",
                }),
              },
              { text: "Play", type: {} },
            ],
          },
        ],
      }),
    };
  }

  async function mappedBotKeyboard(): Promise<TelegramClientCoordinator> {
    const coordinator = await connectedCoordinator();
    FakeTelegramClient.getMessagesBehavior = async () => [botMessage()];
    await coordinator.listMessagePage("chat-1", { limit: 50 });
    return coordinator;
  }

  it("maps a bot's inline keyboard onto the message it belongs to", async () => {
    const coordinator = await connectedCoordinator();
    FakeTelegramClient.getMessagesBehavior = async () => [botMessage()];

    const page = await coordinator.listMessagePage("chat-1", { limit: 50 });

    expect(page.items[0]?.keyboard).toEqual({
      rows: [
        [
          { id: "0:0", text: "Approve", kind: "callback" },
          {
            id: "0:1",
            text: "Logs",
            kind: "url",
            url: "https://example.com/logs",
          },
        ],
        [
          {
            id: "1:0",
            text: "Copy id",
            kind: "copy",
            copyText: "build-482",
          },
          { id: "1:1", text: "Play", kind: "unsupported" },
        ],
      ],
    });
    // The callback bytes stay main-side; nothing on the wire carries them.
    expect(JSON.stringify(page.items[0])).not.toContain("approve:482");
  });

  it("leaves messages without an inline keyboard alone", async () => {
    const coordinator = await connectedCoordinator();
    FakeTelegramClient.getMessagesBehavior = async () => [
      {
        id: 78,
        message: "Plain",
        date: 1_700_000_078,
        out: false,
        getSender: async () => ({ firstName: "Mina" }),
      },
    ];

    const page = await coordinator.listMessagePage("chat-1", { limit: 50 });

    expect(page.items[0]?.keyboard).toBeNull();
  });

  it("presses a callback button with the payload it kept for that message", async () => {
    const coordinator = await mappedBotKeyboard();
    FakeTelegramClient.invokeBehavior = async () => ({
      message: "Approved",
      alert: true,
      cacheTime: 0,
    });

    await expect(
      coordinator.answerBotCallback("chat-1", "77", "0:0"),
    ).resolves.toEqual({ kind: "message", text: "Approved", alert: true });

    const request = FakeTelegramClient.instances.at(-1)?.invokeCalls.at(-1);
    expect(request).toBeInstanceOf(fake.FakeGetBotCallbackAnswer);
    expect(request).toMatchObject({
      peer: "chat-1",
      msgId: 77,
      data: Buffer.from("approve:482"),
    });
  });

  it.each([
    [
      { message: "Saved", cacheTime: 0 },
      { kind: "message", text: "Saved", alert: false },
    ],
    [
      // Telegram's own precedence: a message wins over a url.
      { message: "Saved", url: "https://example.com/x", cacheTime: 0 },
      { kind: "message", text: "Saved", alert: false },
    ],
    [
      { url: "https://example.com/open", cacheTime: 30 },
      { kind: "url", url: "https://example.com/open" },
    ],
    [{ cacheTime: 0 }, { kind: "none" }],
  ])("maps the bot answer %j to %j", async (answer, expected) => {
    const coordinator = await mappedBotKeyboard();
    FakeTelegramClient.invokeBehavior = async () => answer;

    await expect(
      coordinator.answerBotCallback("chat-1", "77", "0:0"),
    ).resolves.toEqual(expected);
  });

  it.each(["0:1", "1:0", "1:1", "9:9"])(
    "refuses to press button %s, which has no callback payload",
    async (buttonId) => {
      const coordinator = await mappedBotKeyboard();
      FakeTelegramClient.invokeBehavior = async () => ({ cacheTime: 0 });

      await expect(
        coordinator.answerBotCallback("chat-1", "77", buttonId),
      ).rejects.toThrow(`Telegram callback button ${buttonId} of message 77`);
      expect(FakeTelegramClient.instances.at(-1)?.invokeCalls).toEqual([]);
    },
  );

  it("refuses to press a keyboard it never mapped", async () => {
    const coordinator = await connectedCoordinator();

    await expect(
      coordinator.answerBotCallback("chat-1", "77", "0:0"),
    ).rejects.toThrow("Telegram callback button 0:0 of message 77");
  });
});
