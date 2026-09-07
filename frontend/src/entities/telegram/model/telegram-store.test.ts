import { beforeEach, describe, expect, it, vi } from "vitest";

import { installTeloApiMock } from "../../../shared/test/mock-telo";
import { copy } from "../../../shared/config/copy";

import { useTelegramStore } from "./telegram-store";

describe("telegram-store", () => {
  beforeEach(() => {
    useTelegramStore.setState({
      auth: null,
      configuration: null,
      currentUser: null,
      accounts: [],
      addingAccount: false,
      agentSetupPending: false,
    });
  });

  it("beginLogin() keeps the auth state untouched on success", async () => {
    const telo = installTeloApiMock();
    telo.telegram.beginLogin.mockResolvedValue(undefined);

    await useTelegramStore
      .getState()
      .beginLogin({ phoneNumber: "+12025550123" });

    expect(telo.telegram.beginLogin).toHaveBeenCalledWith({
      phoneNumber: "+12025550123",
    });
    expect(useTelegramStore.getState().auth).toBeNull();
    expect(useTelegramStore.getState().agentSetupPending).toBe(true);
  });

  it("beginLogin() maps a rejection to the error auth state", async () => {
    const telo = installTeloApiMock();
    telo.telegram.beginLogin.mockRejectedValue(new Error("Invalid phone"));

    await useTelegramStore.getState().beginLogin({ phoneNumber: "+1" });

    expect(useTelegramStore.getState().auth).toEqual({
      status: "error",
      message: "Invalid phone",
    });
  });

  it("beginLogin() falls back to a generic message for non-Error rejections", async () => {
    const telo = installTeloApiMock();
    telo.telegram.beginLogin.mockRejectedValue("network down");

    await useTelegramStore.getState().beginLogin({ phoneNumber: "+1" });

    expect(useTelegramStore.getState().auth).toEqual({
      status: "error",
      message: copy.loginFailed,
    });
  });

  it("beginLogin() falls back to a generic message for blank error messages", async () => {
    const telo = installTeloApiMock();
    telo.telegram.beginLogin.mockRejectedValue(new Error("   "));

    await useTelegramStore.getState().beginLogin({ phoneNumber: "+1" });

    expect(useTelegramStore.getState().auth).toEqual({
      status: "error",
      message: copy.loginFailed,
    });
  });

  it("beginLogin() maps TDLib error codes to user-facing copy", async () => {
    const telo = installTeloApiMock();
    telo.telegram.beginLogin.mockRejectedValue(
      new Error("400 PHONE_NUMBER_INVALID"),
    );

    await useTelegramStore.getState().beginLogin({ phoneNumber: "+1" });

    expect(useTelegramStore.getState().auth).toEqual({
      status: "error",
      message: copy.loginPhoneInvalid,
    });
  });

  it("beginLogin() hides TDLib jargon from the login form", async () => {
    const telo = installTeloApiMock();
    telo.telegram.beginLogin.mockRejectedValue(
      new Error("TDLib client closed"),
    );

    await useTelegramStore.getState().beginLogin({ phoneNumber: "+1" });

    expect(useTelegramStore.getState().auth).toEqual({
      status: "error",
      message: copy.loginFailed,
    });
  });

  it("submitChallenge() maps a rejection to the error auth state", async () => {
    const telo = installTeloApiMock();
    telo.telegram.submitChallenge.mockRejectedValue(new Error("Wrong code"));

    await useTelegramStore.getState().submitChallenge("12345");

    expect(telo.telegram.submitChallenge).toHaveBeenCalledWith("12345");
    expect(useTelegramStore.getState().auth).toEqual({
      status: "error",
      message: "Wrong code",
    });
  });

  it("submitChallenge() falls back to a generic message for non-Error rejections", async () => {
    const telo = installTeloApiMock();
    telo.telegram.submitChallenge.mockRejectedValue({ reason: "unknown" });

    await useTelegramStore.getState().submitChallenge("12345");

    expect(useTelegramStore.getState().auth).toEqual({
      status: "error",
      message: copy.loginFailed,
    });
  });

  it("start() loads the initial auth state and subscribes to updates", async () => {
    const telo = installTeloApiMock();
    const unsubscribe = vi.fn();
    telo.telegram.onAuthState.mockReturnValue(unsubscribe);
    telo.telegram.getAuthState.mockResolvedValue({ status: "idle" });
    telo.telegram.getLoginConfiguration.mockResolvedValue({
      applicationCredentialsConfigured: true,
    });

    const stop = useTelegramStore.getState().start();

    expect(telo.telegram.onAuthState).toHaveBeenCalled();
    expect(telo.workspace.onEvent).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(useTelegramStore.getState().auth).toEqual({ status: "idle" });
    });
    expect(useTelegramStore.getState().configuration).toEqual({
      applicationCredentialsConfigured: true,
    });

    const listener = telo.telegram.onAuthState.mock.calls[0][0];
    listener({ status: "code-required" });
    expect(useTelegramStore.getState().auth).toEqual({
      status: "code-required",
    });
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("start() hides TDLib jargon from a main-process auth error", async () => {
    const telo = installTeloApiMock();
    telo.telegram.onAuthState.mockReturnValue(() => {});
    telo.telegram.getAuthState.mockResolvedValue({
      status: "error",
      message: "TDLib client closed",
    });
    telo.telegram.getLoginConfiguration.mockResolvedValue({
      applicationCredentialsConfigured: true,
    });

    useTelegramStore.getState().start();

    await vi.waitFor(() => {
      expect(useTelegramStore.getState().auth).toEqual({
        status: "error",
        message: copy.loginFailed,
      });
    });
  });

  it("loadCurrentUser() stores the current user from the preload API", async () => {
    const telo = installTeloApiMock();
    const currentUser = {
      id: "u1",
      displayName: "Ada Lovelace",
      username: "ada",
      initials: "AL",
      avatarDataUrl: null,
    };
    telo.workspace.getCurrentUser.mockResolvedValue(currentUser);

    await useTelegramStore.getState().loadCurrentUser();

    expect(useTelegramStore.getState().currentUser).toEqual(currentUser);
  });

  it("start() applies a later chat-avatar to the current user", () => {
    const telo = installTeloApiMock();
    telo.telegram.onAuthState.mockReturnValue(() => {});
    telo.telegram.getAuthState.mockResolvedValue({ status: "ready" });
    telo.telegram.getLoginConfiguration.mockResolvedValue({
      applicationCredentialsConfigured: true,
    });
    useTelegramStore.setState({
      currentUser: {
        id: "u1",
        displayName: "Ada Lovelace",
        username: "ada",
        initials: "AL",
        avatarDataUrl: null,
        avatarPending: true,
      },
    });

    const stop = useTelegramStore.getState().start();
    telo.emitWorkspaceEvent({
      type: "chat-avatar",
      chatId: "u1",
      avatarDataUrl: "telo-media://cache/avatar_u1.jpg",
    });

    expect(useTelegramStore.getState().currentUser).toMatchObject({
      avatarDataUrl: "telo-media://cache/avatar_u1.jpg",
      avatarPending: false,
    });
    stop();
  });

  it("loadCurrentUser() logs and leaves currentUser null when the preload API rejects", async () => {
    const telo = installTeloApiMock();
    telo.workspace.getCurrentUser.mockRejectedValue(new Error("RPC timeout"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      useTelegramStore.getState().loadCurrentUser(),
    ).resolves.toBeUndefined();

    expect(useTelegramStore.getState().currentUser).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to load the current Telegram user",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("logout() calls the preload API and resets auth to idle and current user", async () => {
    const telo = installTeloApiMock();
    telo.telegram.logout.mockResolvedValue(undefined);
    useTelegramStore.setState({
      auth: { status: "ready" },
      currentUser: {
        id: "u1",
        displayName: "Ada Lovelace",
        username: "ada",
        initials: "AL",
        avatarDataUrl: null,
      },
    });

    await useTelegramStore.getState().logout();

    expect(telo.telegram.logout).toHaveBeenCalledTimes(1);
    expect(useTelegramStore.getState().auth).toEqual({ status: "idle" });
    expect(useTelegramStore.getState().currentUser).toBeNull();
  });

  it("logout() maps a rejection to the error auth state and keeps the user", async () => {
    const telo = installTeloApiMock();
    telo.telegram.logout.mockRejectedValue(new Error("disconnect failed"));
    const currentUser = {
      id: "u1",
      displayName: "Ada Lovelace",
      username: "ada",
      initials: "AL",
      avatarDataUrl: null,
    };
    useTelegramStore.setState({
      auth: { status: "ready" },
      currentUser,
    });

    await useTelegramStore.getState().logout();

    expect(useTelegramStore.getState().auth).toEqual({
      status: "error",
      message: "disconnect failed",
    });
    expect(useTelegramStore.getState().currentUser).toEqual(currentUser);
  });

  it("loadAccounts() stores the account list from the preload API", async () => {
    const telo = installTeloApiMock();
    const accounts = [
      {
        id: "acc-1",
        displayName: "Ada Lovelace",
        username: "ada",
        avatarDataUrl: null,
        active: true,
        unreadCount: 3,
      },
      {
        id: "acc-2",
        displayName: "Grace Hopper",
        username: null,
        avatarDataUrl: null,
        active: false,
        unreadCount: 0,
      },
    ];
    telo.telegram.listAccounts.mockResolvedValue(accounts);

    await useTelegramStore.getState().loadAccounts();

    expect(useTelegramStore.getState().accounts).toEqual(accounts);
  });

  it("loadAccounts() logs and keeps the list empty when the preload API rejects", async () => {
    const telo = installTeloApiMock();
    telo.telegram.listAccounts.mockRejectedValue(new Error("registry locked"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      useTelegramStore.getState().loadAccounts(),
    ).resolves.toBeUndefined();

    expect(useTelegramStore.getState().accounts).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to load the Telegram accounts",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("switchAccount() delegates to the preload API without touching auth", async () => {
    const telo = installTeloApiMock();
    telo.telegram.setActiveAccount.mockResolvedValue(undefined);
    useTelegramStore.setState({ auth: { status: "ready" } });

    await useTelegramStore.getState().switchAccount("acc-2");

    expect(telo.telegram.setActiveAccount).toHaveBeenCalledWith("acc-2");
    // The auth-state flow (restoring → ready) drives the workspace reload;
    // the store does not pre-empt it.
    expect(useTelegramStore.getState().auth).toEqual({ status: "ready" });
  });

  it("switchAccount() maps a rejection to the error auth state", async () => {
    const telo = installTeloApiMock();
    telo.telegram.setActiveAccount.mockRejectedValue(
      new Error("unknown account"),
    );
    useTelegramStore.setState({ auth: { status: "ready" } });

    await useTelegramStore.getState().switchAccount("acc-missing");

    expect(useTelegramStore.getState().auth).toEqual({
      status: "error",
      message: "unknown account",
    });
  });

  it("startAddingAccount()/cancelAddingAccount() toggle the add-account flow", () => {
    useTelegramStore.getState().startAddingAccount();
    expect(useTelegramStore.getState().addingAccount).toBe(true);

    useTelegramStore.getState().cancelAddingAccount();
    expect(useTelegramStore.getState().addingAccount).toBe(false);
  });

  it("does not repeat AI onboarding for another Telegram account", async () => {
    const telo = installTeloApiMock();
    telo.telegram.beginLogin.mockResolvedValue(undefined);
    useTelegramStore.setState({
      accounts: [
        {
          id: "account-1",
          displayName: "Mina",
          username: null,
          avatarDataUrl: null,
          avatarPlaceholder: null,
          unreadCount: 0,
          active: true,
        },
      ],
      addingAccount: true,
    });

    await useTelegramStore
      .getState()
      .beginLogin({ phoneNumber: "+12025550123" });

    expect(useTelegramStore.getState().agentSetupPending).toBe(false);
  });

  it("completes the optional AI setup without changing Telegram auth", () => {
    useTelegramStore.setState({
      auth: { status: "ready" },
      agentSetupPending: true,
    });

    useTelegramStore.getState().completeAgentSetup();

    expect(useTelegramStore.getState().agentSetupPending).toBe(false);
    expect(useTelegramStore.getState().auth).toEqual({ status: "ready" });
  });
});
