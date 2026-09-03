import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  CurrentUserDto,
  TelegramAuthState,
  TelegramLoginInput,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";
import type { TelegramAccountRecord } from "../../domain/telegram/telegram-account-registry";
import { FileTelegramAccountRegistry } from "./file-telegram-account-registry";
import { FileTelegramDialogSnapshotRepository } from "./file-telegram-dialog-snapshot-repository";
import {
  TelegramAccountCoordinator,
  type TelegramAccountClient,
  type TelegramAccountPaths,
} from "./telegram-account-coordinator";

/**
 * Stubbed per-account coordinator: session-file existence stands in for a
 * restorable Teleproto session, and logins complete only when the test
 * calls `completeLogin`. State changes are pushed through the same
 * callback the real coordinator gets.
 */
class StubAccountClient {
  state: TelegramAuthState = { status: "idle" };
  initializeCalls = 0;
  disconnectCalls = 0;
  logoutCalls = 0;
  beginLoginCalls: TelegramLoginInput[] = [];
  private readonly listeners = new Set<
    (event: TelegramWorkspaceEvent) => void
  >();

  constructor(
    private readonly sessionFile: string,
    private readonly onState: (state: TelegramAuthState) => void,
    readonly user: CurrentUserDto,
  ) {}

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getAuthState(): TelegramAuthState {
    return this.state;
  }

  async getLoginConfiguration(): Promise<{
    applicationCredentialsConfigured: boolean;
  }> {
    return { applicationCredentialsConfigured: true };
  }

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
    if (!(await fileExists(this.sessionFile))) return;
    this.setState({ status: "restoring" });
    this.setState({ status: "ready" });
  }

  async beginLogin(input: TelegramLoginInput): Promise<void> {
    this.beginLoginCalls.push(input);
    this.setState({ status: "code-required" });
  }

  async submitChallenge(): Promise<void> {
    this.setState({ status: "connecting" });
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.setState({ status: "idle" });
  }

  async logout(): Promise<void> {
    this.logoutCalls += 1;
    this.setState({ status: "idle" });
  }

  async getCurrentUser(): Promise<CurrentUserDto> {
    return this.user;
  }

  completeLogin(): void {
    this.setState({ status: "ready" });
  }

  emit(event: TelegramWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private setState(state: TelegramAuthState): void {
    this.state = state;
    this.onState(state);
  }
}

function record(
  id: string,
  overrides: Partial<TelegramAccountRecord> = {},
): TelegramAccountRecord {
  return {
    id,
    displayName: `User ${id}`,
    username: id,
    avatarDataUrl: null,
    unreadCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    lastActiveAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function chat(id: string, unreadCount: number): ChatDto {
  return {
    id,
    title: id,
    preview: "",
    updatedAt: "2026-09-01T00:00:00.000Z",
    unreadCount,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "direct",
    initials: "C",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

interface Harness {
  readonly coordinator: TelegramAccountCoordinator;
  readonly registry: FileTelegramAccountRegistry;
  readonly paths: (accountId: string) => TelegramAccountPaths;
  readonly legacyPaths: {
    readonly session: string;
    readonly profile: string;
    readonly snapshot: string;
  };
  readonly states: TelegramAuthState[];
  readonly clients: Map<string, StubAccountClient>;
}

async function createHarness(options?: {
  demoWorkspace?: boolean;
  accountIds?: string[];
}): Promise<Harness> {
  const directory = await mkdtemp(path.join(tmpdir(), "telo-multi-account-"));
  const registry = new FileTelegramAccountRegistry(
    path.join(directory, "accounts.json"),
  );
  const paths = (accountId: string): TelegramAccountPaths => ({
    session: path.join(directory, `telegram-${accountId}.session`),
    profile: path.join(directory, `telegram-${accountId}.profile`),
    snapshot: path.join(directory, `dialogs-${accountId}.json`),
    mediaCacheDirectory: path.join(directory, "media-cache", accountId),
  });
  const legacyPaths = {
    session: path.join(directory, "telegram.session"),
    profile: path.join(directory, "telegram.profile"),
    snapshot: path.join(directory, "dialogs.json"),
  };
  const states: TelegramAuthState[] = [];
  const clients = new Map<string, StubAccountClient>();
  const ids = options?.accountIds ? [...options.accountIds] : [];
  let generated = 0;
  const coordinator = new TelegramAccountCoordinator({
    registry,
    paths,
    legacyPaths,
    demoWorkspace: options?.demoWorkspace,
    createAccountId: () => ids.shift() ?? `new-${(generated += 1)}`,
    createCoordinator: (accountId, onState) => {
      const client = new StubAccountClient(paths(accountId).session, onState, {
        id: `user-${accountId}`,
        displayName: `User ${accountId}`,
        username: accountId,
        initials: "U",
        avatarDataUrl: null,
      });
      clients.set(accountId, client);
      return client as unknown as TelegramAccountClient;
    },
    onState: (state) => states.push(state),
  });
  return { coordinator, registry, paths, legacyPaths, states, clients };
}

/** Seeds a signed-in account: registry entry plus its on-disk files. */
async function seedAccount(
  harness: Harness,
  id: string,
  options?: { unreadChats?: ReadonlyArray<number>; active?: boolean },
): Promise<void> {
  await writeFile(harness.paths(id).session, `session-${id}`);
  await writeFile(harness.paths(id).profile, `profile-${id}`);
  await new FileTelegramDialogSnapshotRepository(
    harness.paths(id).snapshot,
  ).save({
    version: 1,
    chats: (options?.unreadChats ?? []).map((unread, index) =>
      chat(`chat-${index}`, unread),
    ),
    folders: [],
    nextCursor: null,
  });
  const current = (await harness.registry.get()) ?? {
    accounts: [],
    activeAccountId: null,
  };
  await harness.registry.save({
    accounts: [...current.accounts, record(id)],
    activeAccountId: options?.active ? id : current.activeAccountId,
  });
}

async function waitForAccounts(
  coordinator: TelegramAccountCoordinator,
  count: number,
): Promise<void> {
  await vi.waitFor(async () => {
    expect(await coordinator.listAccounts()).toHaveLength(count);
  });
}

describe("TelegramAccountCoordinator", () => {
  it("migrates the legacy single account on first boot", async () => {
    const harness = await createHarness({ accountIds: ["acc-1"] });
    await writeFile(harness.legacyPaths.session, "legacy-session");
    await writeFile(harness.legacyPaths.profile, "legacy-profile");
    await writeFile(harness.legacyPaths.snapshot, "{}");

    await harness.coordinator.initialize();

    // The registry points at the per-account copies; the legacy files are
    // deleted only after that write landed.
    expect(await harness.registry.get()).toMatchObject({
      activeAccountId: "acc-1",
      accounts: [{ id: "acc-1" }],
    });
    await expect(
      readFile(harness.paths("acc-1").session, "utf8"),
    ).resolves.toBe("legacy-session");
    await expect(
      readFile(harness.paths("acc-1").profile, "utf8"),
    ).resolves.toBe("legacy-profile");
    expect(await fileExists(harness.legacyPaths.session)).toBe(false);
    expect(await fileExists(harness.legacyPaths.profile)).toBe(false);
    expect(await fileExists(harness.legacyPaths.snapshot)).toBe(false);

    // The migrated account restores straight away.
    expect(harness.states).toEqual([
      { status: "restoring" },
      { status: "ready" },
    ]);
    // …and its registry identity refreshes from CurrentUserDto once ready.
    await vi.waitFor(async () => {
      expect((await harness.coordinator.listAccounts())[0]).toMatchObject({
        id: "acc-1",
        displayName: "User acc-1",
        active: true,
      });
    });
  });

  it("starts empty when there is no registry and no legacy session", async () => {
    const harness = await createHarness();

    await harness.coordinator.initialize();

    expect(harness.states).toEqual([]);
    expect(harness.coordinator.getAuthState()).toEqual({ status: "idle" });
    await expect(harness.coordinator.listAccounts()).resolves.toEqual([]);
  });

  it("beginLogin on a ready account adds a new account and parks the old one", async () => {
    const harness = await createHarness({ accountIds: ["acc-2"] });
    await seedAccount(harness, "acc-1", { unreadChats: [3, 4], active: true });
    await harness.coordinator.initialize();
    await waitForAccounts(harness.coordinator, 1);

    await harness.coordinator.beginLogin({ phoneNumber: "+1 555 0100" });

    const pending = harness.clients.get("acc-2");
    expect(pending?.beginLoginCalls).toEqual([{ phoneNumber: "+1 555 0100" }]);
    expect(harness.states.at(-1)).toEqual({ status: "code-required" });

    pending?.completeLogin();

    await waitForAccounts(harness.coordinator, 2);
    const accounts = await harness.coordinator.listAccounts();
    // The new account is registered active-first with its CurrentUserDto
    // identity; the previous one keeps the unread total captured when it
    // was parked (3 + 4 from its dialog snapshot).
    expect(accounts[0]).toMatchObject({
      id: "acc-2",
      displayName: "User acc-2",
      active: true,
    });
    expect(accounts[1]).toMatchObject({
      id: "acc-1",
      active: false,
      unreadCount: 7,
    });
    expect(harness.clients.get("acc-1")?.disconnectCalls).toBe(1);
    expect(harness.states.at(-1)).toEqual({ status: "ready" });
  });

  it("rejects a fourth account, matching tdesktop's free tier", async () => {
    const harness = await createHarness();
    await seedAccount(harness, "acc-1", { active: true });
    await seedAccount(harness, "acc-2");
    await seedAccount(harness, "acc-3");
    await harness.coordinator.initialize();
    await waitForAccounts(harness.coordinator, 3);

    await expect(
      harness.coordinator.beginLogin({ phoneNumber: "+1 555 0100" }),
    ).rejects.toThrow(/at most 3 Telegram accounts/);
    // No fourth coordinator was even constructed (only the active one is).
    expect(harness.clients.size).toBe(1);
  });

  it("switches accounts: parks the old, restores the new, in that order", async () => {
    const harness = await createHarness();
    await seedAccount(harness, "acc-1", { unreadChats: [5], active: true });
    await seedAccount(harness, "acc-2");
    await harness.coordinator.initialize();
    await waitForAccounts(harness.coordinator, 2);
    harness.states.length = 0;

    await harness.coordinator.setActiveAccount("acc-2");

    // The parked account's own idle never leaks: the renderer sees only the
    // target's restore sequence.
    expect(harness.states).toEqual([
      { status: "restoring" },
      { status: "ready" },
    ]);
    expect(harness.clients.get("acc-1")?.disconnectCalls).toBe(1);
    expect(harness.clients.get("acc-2")?.initializeCalls).toBe(1);
    const accounts = await harness.coordinator.listAccounts();
    expect(accounts.map((account) => account.id)).toEqual(["acc-2", "acc-1"]);
    expect(accounts[1]).toMatchObject({ id: "acc-1", unreadCount: 5 });

    await expect(
      harness.coordinator.setActiveAccount("unknown"),
    ).rejects.toThrow(/Unknown Telegram account/);
  });

  it("passes workspace events through from the active account only", async () => {
    const harness = await createHarness();
    await seedAccount(harness, "acc-1", { active: true });
    await seedAccount(harness, "acc-2");
    await harness.coordinator.initialize();
    const events: TelegramWorkspaceEvent[] = [];
    harness.coordinator.subscribe((event) => events.push(event));
    const event: TelegramWorkspaceEvent = {
      type: "connection-state",
      state: "connected",
    };

    harness.clients.get("acc-1")?.emit(event);
    expect(events).toHaveLength(1);

    await harness.coordinator.setActiveAccount("acc-2");
    harness.clients.get("acc-1")?.emit(event);
    expect(events).toHaveLength(1);
    harness.clients.get("acc-2")?.emit(event);
    expect(events).toHaveLength(2);
  });

  it("logout removes the active account and restores the next one", async () => {
    const harness = await createHarness();
    await seedAccount(harness, "acc-1", { active: true });
    await seedAccount(harness, "acc-2");
    await harness.coordinator.initialize();
    await waitForAccounts(harness.coordinator, 2);
    harness.states.length = 0;

    await harness.coordinator.logout();

    expect(harness.clients.get("acc-1")?.logoutCalls).toBe(1);
    // Every per-account file of the removed account is gone.
    expect(await fileExists(harness.paths("acc-1").session)).toBe(false);
    expect(await fileExists(harness.paths("acc-1").profile)).toBe(false);
    expect(await fileExists(harness.paths("acc-1").snapshot)).toBe(false);
    // The next most recent account becomes active and restores.
    expect(harness.states).toEqual([
      { status: "restoring" },
      { status: "ready" },
    ]);
    const accounts = await harness.coordinator.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: "acc-2", active: true });
  });

  it("logout of the last account goes idle with an empty registry", async () => {
    const harness = await createHarness();
    await seedAccount(harness, "acc-1", { active: true });
    await harness.coordinator.initialize();
    await waitForAccounts(harness.coordinator, 1);
    harness.states.length = 0;

    await harness.coordinator.logout();

    expect(harness.states).toEqual([{ status: "idle" }]);
    expect(harness.coordinator.getAuthState()).toEqual({ status: "idle" });
    await expect(harness.coordinator.listAccounts()).resolves.toEqual([]);
    expect(await fileExists(harness.paths("acc-1").session)).toBe(false);
  });

  it("registers two deterministic accounts in the demo workspace", async () => {
    const harness = await createHarness({ demoWorkspace: true });

    await harness.coordinator.initialize();

    const accounts = await harness.coordinator.listAccounts();
    expect(accounts.map((account) => account.id)).toEqual([
      "demo",
      "demo-second",
    ]);
    expect(accounts[0]).toMatchObject({
      displayName: "Demo User",
      active: true,
      unreadCount: 0,
    });
    expect(accounts[1]).toMatchObject({ active: false, unreadCount: 0 });
    // The second demo account has no session: switching to it activates an
    // idle (disconnected) demo workspace without any auth-state emission.
    await harness.coordinator.setActiveAccount("demo-second");
    expect(harness.states).toEqual([]);
    expect((await harness.coordinator.listAccounts())[0]).toMatchObject({
      id: "demo-second",
      active: true,
    });
  });
});
