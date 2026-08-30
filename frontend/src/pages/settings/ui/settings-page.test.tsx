import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentUserDto } from "../../../../../contracts/src/ipc";
import { useAgentStore } from "../../../entities/agent";
import { useTelegramStore } from "../../../entities/telegram";
import { copy } from "../../../shared/config/copy";
import {
  installTeloApiMock,
  type TeloApiMock,
} from "../../../shared/test/mock-telo";

import type { SettingsPage as SettingsPageComponent } from "./settings-page";

const demoUser: CurrentUserDto = {
  id: "demo-user",
  displayName: "Demo User",
  username: "demouser",
  initials: "DU",
  avatarDataUrl: null,
};

describe("SettingsPage", () => {
  let SettingsPage: typeof SettingsPageComponent;
  let telo: TeloApiMock;

  beforeAll(() => {
    // jsdom does not implement matchMedia, which the theme model and motion's
    // useReducedMotion need.
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
    // jsdom does not implement ResizeObserver, which the select primitive uses
    // to re-measure its panel.
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  beforeEach(async () => {
    telo = installTeloApiMock();
    // The theme model reads preferences at module scope, so the mock must be
    // installed before the page module is imported.
    telo.preferences.get.mockResolvedValue({
      agentPanelOpen: false,
      accentColor: "blue",
      messageTextSize: 14,
      timeFormat: "system",
      sendWithEnter: true,
      notificationsEnabled: true,
      sidebarWidth: 280,
      agentPanelWidth: 380,
      recentEmojis: [],
      demoWorkspace: false,
      theme: "system",
    });
    telo.preferences.update.mockImplementation((input) =>
      Promise.resolve({
        agentPanelOpen: false,
        accentColor: "blue",
        messageTextSize: 14,
        timeFormat: "system",
        sendWithEnter: true,
        notificationsEnabled: true,
        sidebarWidth: 280,
        agentPanelWidth: 380,
        recentEmojis: [],
        demoWorkspace: false,
        theme: "system",
        ...input,
      }),
    );
    telo.agent.getConfiguration.mockResolvedValue({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: null,
      instructions: "",
      hasApiKey: false,
      canInspectWorkspace: true,
    });
    useTelegramStore.setState({
      auth: null,
      configuration: null,
      currentUser: null,
    });
    useAgentStore.setState({ configuration: null });
    ({ SettingsPage } = await import("./settings-page"));
  });

  it("renders the connection form directly when no account is connected", () => {
    render(<SettingsPage onBack={vi.fn()} />);

    expect(screen.getByLabelText(copy.phoneNumber)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: copy.reconnectTelegram }),
    ).toBeNull();
  });

  it("shows only the account card with a collapsed reconnect entry when connected", async () => {
    const user = userEvent.setup();
    useTelegramStore.setState({ currentUser: demoUser });
    render(<SettingsPage onBack={vi.fn()} />);

    expect(screen.getByText(demoUser.displayName)).toBeTruthy();
    expect(screen.queryByLabelText(copy.phoneNumber)).toBeNull();

    const reconnect = screen.getByRole("button", {
      name: copy.reconnectTelegram,
    });
    expect(reconnect.getAttribute("aria-expanded")).toBe("false");

    await user.click(reconnect);

    expect(reconnect.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText(copy.phoneNumber)).toBeTruthy();
  });

  it("keeps section headings one step below the page title", () => {
    render(<SettingsPage onBack={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: copy.settings }).className,
    ).toContain("text-base");
    for (const name of [
      copy.appearance,
      copy.messages,
      copy.notifications,
      copy.telegramAccount,
      copy.agentSettings,
    ]) {
      expect(screen.getByRole("heading", { name }).className).toContain(
        "text-sm",
      );
    }
  });

  it("persists the accent color picked from the radio group", async () => {
    const user = userEvent.setup();
    render(<SettingsPage onBack={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: copy.accentGreen }));

    expect(telo.preferences.update).toHaveBeenCalledWith({
      accentColor: "green",
    });
  });

  it("persists the message text size from the slider keyboard control", async () => {
    render(<SettingsPage onBack={vi.fn()} />);
    const slider = screen.getByRole("slider", {
      name: copy.messageTextSize,
    });

    fireEvent.keyDown(slider, { key: "ArrowRight" });

    expect(telo.preferences.update).toHaveBeenCalledWith({
      messageTextSize: 15,
    });
  });

  it("persists the time format choice", async () => {
    const user = userEvent.setup();
    render(<SettingsPage onBack={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: copy.timeFormat24h }));

    expect(telo.preferences.update).toHaveBeenCalledWith({
      timeFormat: "24h",
    });
  });

  it("persists the send-with-enter choice", async () => {
    const user = userEvent.setup();
    render(<SettingsPage onBack={vi.fn()} />);

    await user.click(
      screen.getByRole("radio", { name: copy.sendWithEnterCmdEnter }),
    );

    expect(telo.preferences.update).toHaveBeenCalledWith({
      sendWithEnter: false,
    });
  });

  it("toggles desktop notifications from the switch", async () => {
    const user = userEvent.setup();
    render(<SettingsPage onBack={vi.fn()} />);

    await user.click(
      screen.getByRole("switch", { name: copy.notificationsDesktop }),
    );

    expect(telo.preferences.update).toHaveBeenCalledWith({
      notificationsEnabled: false,
    });
  });

  it("logs out a connected account only after the two-step confirm", async () => {
    const user = userEvent.setup();
    useTelegramStore.setState({
      auth: { status: "ready" },
      currentUser: demoUser,
    });
    render(<SettingsPage onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: copy.logOut }));

    expect(telo.telegram.logout).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: copy.logOutConfirm }));

    await vi.waitFor(() => {
      expect(telo.telegram.logout).toHaveBeenCalledTimes(1);
    });
    expect(telo.preferences.update).not.toHaveBeenCalledWith({
      demoWorkspace: false,
    });
  });

  it("clears the demoWorkspace preference when leaving the demo workspace", async () => {
    const user = userEvent.setup();
    telo.preferences.get.mockResolvedValue({
      agentPanelOpen: false,
      accentColor: "blue",
      messageTextSize: 14,
      timeFormat: "system",
      sendWithEnter: true,
      notificationsEnabled: true,
      sidebarWidth: 280,
      agentPanelWidth: 380,
      recentEmojis: [],
      demoWorkspace: true,
      theme: "system",
    });
    useTelegramStore.setState({ currentUser: demoUser });
    render(<SettingsPage onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: copy.logOut }));
    await user.click(screen.getByRole("button", { name: copy.logOutConfirm }));

    await vi.waitFor(() => {
      expect(telo.telegram.logout).toHaveBeenCalledTimes(1);
    });
    expect(telo.preferences.update).toHaveBeenCalledWith({
      demoWorkspace: false,
    });
  });
});
