import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Td from "tdlib-types";

import { createTdlibBridge } from "./tdlib-client";
import { TdlibClientCoordinator } from "./tdlib-telegram-repository";

vi.mock("./tdlib-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tdlib-client")>();
  return {
    ...actual,
    configureTdlib: vi.fn(() => "/tdjson"),
    createTdlibBridge: vi.fn(),
  };
});

class FakeBridge {
  readonly listeners = new Set<(update: Td.Update) => void>();
  readonly invokes: object[] = [];
  closed = false;

  invoke(request: object): Promise<unknown> {
    this.invokes.push(request);
    const typed = request as { _: string };
    if (typed._ === "getMe") {
      return Promise.resolve({
        _: "user",
        id: 1,
        first_name: "Ada",
        last_name: "",
      });
    }
    if (typed._ === "loadChats" || typed._ === "getChats") {
      return Promise.resolve({ _: "chats", chat_ids: [], total_count: 0 });
    }
    return Promise.resolve({ _: "ok" });
  }

  onUpdate(listener: (update: Td.Update) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(state: string): void {
    const authorization_state = { _: state } as Td.AuthorizationState;
    for (const listener of this.listeners) {
      listener({
        _: "updateAuthorizationState",
        authorization_state,
      } as Td.Update);
    }
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  isClosed(): boolean {
    return this.closed;
  }
}

describe("TdlibClientCoordinator", () => {
  const bridge = new FakeBridge();
  const states: string[] = [];
  const database = {
    directory: "/tmp/tdlib-account",
    encryptionKey: vi.fn(async () => "key"),
    clear: vi.fn(async () => undefined),
  };
  const profiles = {
    get: vi.fn(async () => ({
      apiId: 1,
      apiHash: "hash",
      phoneNumber: "+1555",
    })),
    save: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    states.length = 0;
    bridge.invokes.length = 0;
    vi.mocked(createTdlibBridge).mockReturnValue(bridge as never);
  });

  function coordinator() {
    return new TdlibClientCoordinator({
      database,
      profiles,
      applicationCredentials: { apiId: 1, apiHash: "hash" },
      onState: (state) => states.push(state.status),
      mediaCacheDirectory: "/tmp/media",
      mediaCacheLimitBytes: async () => 1024,
      resolveTdjson: () => ({ isPackaged: false, resourcesPath: "" }),
    });
  }

  it("begins login, accepts a code, and hydrates when TDLib is ready", async () => {
    const client = coordinator();
    await client.beginLogin({ phoneNumber: "+15550001" });
    expect(bridge.invokes).toContainEqual(
      expect.objectContaining({
        _: "setAuthenticationPhoneNumber",
        phone_number: "+15550001",
      }),
    );
    bridge.emit("authorizationStateWaitCode");
    await vi.waitFor(() => expect(states.at(-1)).toBe("code-required"));
    await client.submitChallenge("12345");
    bridge.emit("authorizationStateReady");
    await vi.waitFor(() => expect(states.at(-1)).toBe("ready"));
    expect(client.getAuthState().status).toBe("ready");
  });

  it("clears the account database on logout", async () => {
    const client = coordinator();
    await client.beginLogin({ phoneNumber: "+15550001" });
    bridge.emit("authorizationStateReady");
    await vi.waitFor(() => expect(states.at(-1)).toBe("ready"));
    await client.logout();
    expect(database.clear).toHaveBeenCalled();
    expect(bridge.closed).toBe(true);
  });
});
