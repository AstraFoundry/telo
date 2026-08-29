import { beforeEach, describe, expect, it, vi } from "vitest";

import { installTeloApiMock } from "../../../shared/test/mock-telo";

import { useTelegramStore } from "./telegram-store";

describe("telegram-store", () => {
  beforeEach(() => {
    useTelegramStore.setState({
      auth: null,
      configuration: null,
      currentUser: null,
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
      message: "Telegram authentication failed",
    });
  });

  it("beginLogin() falls back to a generic message for blank error messages", async () => {
    const telo = installTeloApiMock();
    telo.telegram.beginLogin.mockRejectedValue(new Error("   "));

    await useTelegramStore.getState().beginLogin({ phoneNumber: "+1" });

    expect(useTelegramStore.getState().auth).toEqual({
      status: "error",
      message: "Telegram authentication failed",
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
      message: "Telegram authentication failed",
    });
  });

  it("start() loads the initial auth state and subscribes to updates", async () => {
    const telo = installTeloApiMock();
    const unsubscribe = () => {};
    telo.telegram.onAuthState.mockReturnValue(unsubscribe);
    telo.telegram.getAuthState.mockResolvedValue({ status: "idle" });
    telo.telegram.getLoginConfiguration.mockResolvedValue({
      applicationCredentialsConfigured: true,
    });

    const stop = useTelegramStore.getState().start();

    expect(stop).toBe(unsubscribe);
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
});
