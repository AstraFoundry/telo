import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useTelegramStore } from "entities/telegram";
import { installTeloApiMock } from "shared/test/mock-telo";

import type { App as AppComponent } from "./app";

function stubMatchMedia(): void {
  // jsdom does not implement matchMedia, which the preferences slice applies
  // at module scope and motion's reduced-motion handling consults.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// The routing decisions under test live in App itself; the pages and widgets
// it composes are replaced with markers so this suite stays about *which*
// surface shows, not how each surface renders (their own suites cover that).
vi.mock("pages/onboarding", () => ({
  OnboardingPage: () => <div data-testid="onboarding-page" />,
}));
vi.mock("pages/workspace", () => ({
  WorkspacePage: ({ children }: { readonly children?: ReactNode }) => (
    <div data-testid="workspace-page">{children}</div>
  ),
  useNarrowWorkspace: () => false,
}));
vi.mock("pages/settings", () => ({
  SettingsPage: () => <div data-testid="settings-page" />,
}));
vi.mock("widgets/conversation-view", () => ({
  ConversationView: () => null,
}));
vi.mock("features/chat-search", () => ({
  GlobalSearchPalette: () => null,
}));

describe("App", () => {
  let App: typeof AppComponent;

  beforeAll(async () => {
    stubMatchMedia();
    // The preferences slice reads window.telo at module scope through App's
    // import chain, so both the stub and the preload mock are installed
    // before the module is pulled in.
    installTeloApiMock();
    ({ App } = await import("./app"));
  });

  beforeEach(() => {
    installTeloApiMock();
    useTelegramStore.setState({
      auth: null,
      configuration: null,
      currentUser: null,
      accounts: [],
      addingAccount: false,
    });
  });

  it("shows onboarding when no account is signed in", async () => {
    const telo = installTeloApiMock();
    telo.telegram.getAuthState.mockResolvedValue({ status: "idle" });
    telo.telegram.getLoginConfiguration.mockResolvedValue({
      applicationCredentialsConfigured: true,
    });

    render(<App />);

    expect(await screen.findByTestId("onboarding-page")).toBeTruthy();
    expect(screen.queryByTestId("workspace-page")).toBeNull();
  });

  it("loads the workspace and the account list when auth is ready", async () => {
    const telo = installTeloApiMock();
    telo.telegram.getAuthState.mockResolvedValue({ status: "ready" });
    telo.telegram.getLoginConfiguration.mockResolvedValue({
      applicationCredentialsConfigured: true,
    });

    render(<App />);

    expect(await screen.findByTestId("workspace-page")).toBeTruthy();
    await waitFor(() => {
      expect(telo.workspace.listChatPage).toHaveBeenCalled();
      expect(telo.telegram.listAccounts).toHaveBeenCalled();
    });
  });

  it("keeps onboarding up for the add-account flow while signed in", async () => {
    const telo = installTeloApiMock();
    telo.telegram.getAuthState.mockResolvedValue({ status: "ready" });
    telo.telegram.getLoginConfiguration.mockResolvedValue({
      applicationCredentialsConfigured: true,
    });
    // The switcher only offers "add account" from the workspace, so auth is
    // already ready when the flag flips.
    useTelegramStore.setState({
      auth: { status: "ready" },
      addingAccount: true,
    });

    render(<App />);

    expect(await screen.findByTestId("onboarding-page")).toBeTruthy();
    // The persisted "ready" landing must not end the flow early.
    await waitFor(() => expect(telo.telegram.listAccounts).toHaveBeenCalled());
    expect(screen.queryByTestId("workspace-page")).toBeNull();
    expect(useTelegramStore.getState().addingAccount).toBe(true);
  });

  it("returns to a reloaded workspace when the new account's login reaches ready", async () => {
    const telo = installTeloApiMock();
    telo.telegram.getAuthState.mockResolvedValue({ status: "ready" });
    telo.telegram.getLoginConfiguration.mockResolvedValue({
      applicationCredentialsConfigured: true,
    });
    useTelegramStore.setState({
      auth: { status: "ready" },
      addingAccount: true,
    });
    render(<App />);
    expect(await screen.findByTestId("onboarding-page")).toBeTruthy();
    const authListener = telo.telegram.onAuthState.mock.calls[0]?.[0];
    expect(authListener).toBeDefined();

    // The completed login registers a new account main-side, which answers
    // with the same restoring → ready sequence an account switch produces.
    act(() => authListener?.({ status: "restoring" }));
    const chatsLoaded = telo.workspace.listChatPage.mock.calls.length;
    const accountsLoaded = telo.telegram.listAccounts.mock.calls.length;
    act(() => authListener?.({ status: "ready" }));

    expect(await screen.findByTestId("workspace-page")).toBeTruthy();
    expect(useTelegramStore.getState().addingAccount).toBe(false);
    // The ready transition reloaded the workspace and account list from
    // scratch — the active account may have just changed.
    await waitFor(() => {
      expect(telo.workspace.listChatPage.mock.calls.length).toBeGreaterThan(
        chatsLoaded,
      );
      expect(telo.telegram.listAccounts.mock.calls.length).toBeGreaterThan(
        accountsLoaded,
      );
    });
  });
});
