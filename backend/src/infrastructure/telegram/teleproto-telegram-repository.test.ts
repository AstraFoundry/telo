import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  TelegramAuthState,
  TelegramLoginInput,
} from "../../../../contracts/src/ipc";
import type {
  TelegramConnectionProfile,
  TelegramSessionRepository,
} from "../../domain/telegram/telegram-ports";
import { TelegramClientCoordinator } from "./teleproto-telegram-repository";

const fake = vi.hoisted(() => {
  interface FakeStartParams {
    readonly phoneNumber: string;
    readonly phoneCode: () => Promise<string>;
    readonly password: (hint: string) => Promise<string>;
    readonly onError: (error: unknown) => void;
  }

  type StartBehavior = (params: FakeStartParams) => Promise<void>;

  class FakeTelegramClient {
    static instances: FakeTelegramClient[] = [];
    static authorized = true;
    static startBehavior: StartBehavior | null = null;

    connectCalls = 0;
    disconnectCalls = 0;
    readonly session = { save: (): string => "restored-session" };

    constructor(
      readonly stringSession: unknown,
      readonly apiId: number,
      readonly apiHash: string,
    ) {
      FakeTelegramClient.instances.push(this);
    }

    async connect(): Promise<void> {
      this.connectCalls += 1;
    }

    async disconnect(): Promise<void> {
      this.disconnectCalls += 1;
    }

    async checkAuthorization(): Promise<boolean> {
      return FakeTelegramClient.authorized;
    }

    async start(params: FakeStartParams): Promise<void> {
      await FakeTelegramClient.startBehavior?.(params);
    }
  }

  return { FakeTelegramClient };
});

vi.mock("teleproto", () => ({ TelegramClient: fake.FakeTelegramClient }));
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

function createCoordinator(
  options: {
    session?: string;
    profile?: TelegramConnectionProfile | null;
    credentials?: { apiId: number; apiHash: string } | null;
    sessions?: TelegramSessionRepository;
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

describe("TelegramClientCoordinator", () => {
  beforeEach(() => {
    FakeTelegramClient.instances.length = 0;
    FakeTelegramClient.authorized = true;
    FakeTelegramClient.startBehavior = null;
  });

  it("serves demo data until a client is connected", async () => {
    const { coordinator } = createCoordinator();
    await expect(coordinator.getCurrentUser()).resolves.toMatchObject({
      id: "demo-user",
      displayName: "Demo User",
    });
    await expect(coordinator.listChats()).resolves.toHaveLength(3);
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

    expect(states).toEqual([{ status: "connecting" }, { status: "ready" }]);
    const client = FakeTelegramClient.instances[0];
    expect(client?.apiId).toBe(7);
    expect(client?.apiHash).toBe("hash");
    expect(client?.connectCalls).toBe(1);
    expect(client?.disconnectCalls).toBe(0);
  });

  it("disconnects and returns to idle when the session is no longer authorized", async () => {
    FakeTelegramClient.authorized = false;
    const { coordinator, states } = createCoordinator({
      session: "stored-session",
      credentials: { apiId: 7, apiHash: "hash" },
    });

    await coordinator.initialize();

    expect(states).toEqual([{ status: "connecting" }, { status: "idle" }]);
    expect(FakeTelegramClient.instances[0]?.disconnectCalls).toBe(1);
    await expect(coordinator.getCurrentUser()).resolves.toMatchObject({
      id: "demo-user",
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
});
