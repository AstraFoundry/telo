import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentConfigurationDto,
  CurrentUserDto,
  UserPreferencesDto,
} from "../../../../../contracts/src/ipc";
import { AGENT_OAUTH_PROVIDERS } from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

const demoUser: CurrentUserDto = {
  id: "demo-user",
  displayName: "Demo User",
  username: "demouser",
  bio: null,
  phone: "+1 202 555 0123",
  initials: "DU",
  avatarDataUrl: null,
};

const AGENT_CONFIGURATION: AgentConfigurationDto = {
  provider: "openai",
  model: "gpt-4.1-mini",
  baseUrl: null,
  // Non-empty: the form marks instructions required, so an empty fixture would
  // block submit and no test could reach saveConfiguration.
  instructions: "Answer from the visible workspace.",
  hasCredential: false,
  authKind: null,
  accountLabel: null,
  configuredOAuthProviders: [...AGENT_OAUTH_PROVIDERS],
  canInspectWorkspace: true,
  temperature: 0.7,
  maxSteps: 4,
  historyLimit: 20,
};

interface RenderOptions {
  readonly preferences?: Partial<UserPreferencesDto>;
  readonly currentUser?: CurrentUserDto;
  readonly connectionState?: "offline" | "synchronizing" | "connected";
  onLoggedOut?(): void;
}

/**
 * The preferences slice is a module-level store that loads once per key, so
 * every test imports a fresh module graph after resetting the registry - and
 * the stores have to come from that same graph as the component, or setState
 * lands on a different instance than the page reads.
 */
async function renderPage(options: RenderOptions = {}) {
  const telo = installTeloApiMock();
  const defaults = await telo.preferences.get();
  const preferences: UserPreferencesDto = {
    ...defaults,
    ...options.preferences,
  };
  telo.preferences.get.mockResolvedValue(preferences);
  telo.preferences.update.mockImplementation((input) =>
    Promise.resolve({ ...preferences, ...input }),
  );
  telo.agent.getConfiguration.mockResolvedValue(AGENT_CONFIGURATION);

  const { useTelegramStore } = await import("../../../entities/telegram");
  const { useChatStore } = await import("../../../entities/chat");
  const { useAgentStore } = await import("../../../entities/agent");
  // Auth stays idle: the account pane keys off currentUser, and a "ready"
  // auth state makes the connection form render its post-login branch.
  useTelegramStore.setState({
    auth: null,
    configuration: null,
    currentUser: options.currentUser ?? null,
  });
  useChatStore.setState({
    connectionState: options.connectionState ?? "connected",
  });
  useAgentStore.setState({ configuration: null });

  const { SettingsPage } = await import("./settings-page");
  const view = render(
    <SettingsPage onBack={vi.fn()} onLoggedOut={options.onLoggedOut} />,
  );
  return { ...view, telo, preferences };
}

/** Rail navigation, so a test can reach the pane that owns its setting. */
async function openSection(user: UserEvent, name: string) {
  await user.click(screen.getByRole("button", { name }));
}

/** Preferences hydrate asynchronously; a dependent row is inert until they do. */
async function enabledSwitch(name: string): Promise<HTMLElement> {
  const control = screen.getByRole("switch", { name });
  await waitFor(() => {
    expect(control.hasAttribute("disabled")).toBe(false);
  });
  return control;
}

describe("SettingsPage", () => {
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
    // jsdom does not implement scrollIntoView, which both the search cursor
    // and the arrived-at settings row call to bring themselves into view.
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    vi.resetModules();
  });

  it("bounds its own height so the pane can scroll", async () => {
    const { container } = await renderPage();

    // The workspace shell hands this surface a grid cell with clipped
    // overflow. Without these the settings body grows past the viewport and
    // the bottom becomes unreachable instead of scrollable.
    const main = container.querySelector("main");
    expect(main?.className).toContain("h-full");
    expect(main?.className).toContain("min-h-0");
    expect(main?.className).toContain("overflow-hidden");
    expect(container.querySelector(".overflow-y-auto")).toBeTruthy();
  });

  it("lists every section in the rail and marks the open one", async () => {
    await renderPage();

    const rail = screen.getByRole("navigation", { name: copy.settings });
    for (const title of [
      copy.settingsAccount,
      copy.appearance,
      copy.chatSettings,
      copy.notifications,
      copy.folders,
      copy.agentSettings,
      copy.dataAndStorage,
    ]) {
      expect(screen.getByRole("button", { name: title })).toBeTruthy();
    }
    // Account is the landing pane, the way every Telegram client opens its
    // settings on the identity rather than on a preference.
    expect(rail.querySelector('[aria-current="page"]')?.textContent).toContain(
      copy.settingsAccount,
    );
  });

  it("finds a setting by a word its label does not contain", async () => {
    const user = userEvent.setup();
    await renderPage();

    fireEvent.change(screen.getByLabelText(copy.settingsSearch), {
      target: { value: "dark" },
    });

    // "dark" appears nowhere in "Theme"; the alias index is what makes the
    // search useful rather than a filter over text already on screen.
    await user.click(screen.getByRole("button", { name: /Theme/ }));

    expect(
      screen.getByRole("heading", { level: 2, name: copy.appearance }),
    ).toBeTruthy();
  });

  it("finds a provider by a product name the label does not contain", async () => {
    const user = userEvent.setup();
    await renderPage();

    fireEvent.change(screen.getByLabelText(copy.settingsSearch), {
      target: { value: "claude" },
    });

    await user.click(screen.getByRole("button", { name: /Provider/ }));

    expect(
      screen.getByRole("heading", { level: 2, name: copy.agentSettings }),
    ).toBeTruthy();
  });

  it("lands on the matched row rather than at the top of its pane", async () => {
    const user = userEvent.setup();
    const { container } = await renderPage();

    fireEvent.change(screen.getByLabelText(copy.settingsSearch), {
      target: { value: "wallpaper" },
    });
    await user.click(screen.getByRole("button", { name: /Chat background/ }));

    // The pane opens and the row that answered the search is the one marked,
    // which is the difference between "it lives here" and "here it is".
    const marked = container.querySelector('[data-settings-focus="true"]');
    expect(marked?.textContent).toContain(copy.chatWallpaper);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("walks search results with the arrow keys and opens one with Enter", async () => {
    const user = userEvent.setup();
    await renderPage();

    const field = screen.getByLabelText(copy.settingsSearch);
    fireEvent.change(field, { target: { value: "auto download" } });

    const results = screen.getByRole("list", {
      name: copy.settingsSearchResults,
    });
    const rows = within(results).getAllByRole("button");
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].dataset.active).toBe("true");

    field.focus();
    await user.keyboard("{ArrowDown}");
    expect(
      within(
        screen.getByRole("list", { name: copy.settingsSearchResults }),
      ).getAllByRole("button")[1].dataset.active,
    ).toBe("true");

    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", { level: 2, name: copy.dataAndStorage }),
    ).toBeTruthy();
  });

  it("persists a chat background and previews it with the transcript's own tokens", async () => {
    const user = userEvent.setup();
    const { telo, container } = await renderPage();
    await openSection(user, copy.appearance);

    // The preview is not a mock-up: it is the same backdrop custom property
    // the conversation column paints from.
    expect(
      container.querySelector(`[aria-label="${copy.appearancePreview}"]`)
        ?.className,
    ).toContain("conversation-backdrop");

    await user.click(screen.getByRole("radio", { name: copy.wallpaperDots }));

    await waitFor(() =>
      expect(telo.preferences.update).toHaveBeenCalledWith({
        chatWallpaper: "dots",
      }),
    );
    expect(document.documentElement.dataset.chatWallpaper).toBe("dots");
  });

  it("shapes the notification preview from the switches that shape the banner", async () => {
    const user = userEvent.setup();
    await renderPage();
    await openSection(user, copy.notifications);

    const banner = screen.getByRole("img", { name: copy.notificationBanner });
    expect(banner.textContent).toContain(copy.previewIncomingMessage);

    await user.click(await enabledSwitch(copy.notificationPreview));

    // Turning the body off has to change the banner, not just the switch:
    // the preview is the payload.
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: copy.notificationBanner }).textContent,
      ).toContain(copy.notifyIncomingMessageBody),
    );
  });

  it("persists the per-chat-kind notification switches", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    await openSection(user, copy.notifications);

    await user.click(await enabledSwitch(copy.notifyChannels));

    await waitFor(() =>
      expect(telo.preferences.update).toHaveBeenCalledWith({
        notifyChannels: false,
      }),
    );
  });

  it("persists an auto-download switch", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    await openSection(user, copy.dataAndStorage);

    await user.click(
      screen.getByRole("switch", { name: copy.autoDownloadFiles }),
    );

    await waitFor(() =>
      expect(telo.preferences.update).toHaveBeenCalledWith({
        autoDownloadFiles: true,
      }),
    );
  });

  it("says so when nothing matches instead of showing an empty rail", async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText(copy.settingsSearch), {
      target: { value: "zzzzz" },
    });

    expect(screen.getByText(copy.settingsNoResults)).toBeTruthy();
  });

  it("keeps the section heading one step below the page title", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: copy.settings }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: copy.settingsAccount }),
    ).toBeTruthy();
  });

  it("renders the connection form directly when no account is connected", async () => {
    await renderPage();

    expect(screen.getByLabelText(copy.phoneNumber)).toBeTruthy();
  });

  it("shows the account cover with a collapsed reconnect entry when connected", async () => {
    const user = userEvent.setup();
    await renderPage({ currentUser: demoUser });

    // The cover and the editing rows both carry the identity, the way
    // tdesktop's My Profile repeats the name and handle as its rows.
    expect(screen.getAllByText(demoUser.displayName).length).toBe(2);
    expect(screen.getAllByText(`@${demoUser.username}`).length).toBe(2);
    expect(screen.queryByLabelText(copy.phoneNumber)).toBeNull();

    await user.click(
      screen.getByRole("button", { name: copy.reconnectTelegram }),
    );
    expect(screen.getByLabelText(copy.phoneNumber)).toBeTruthy();
  });

  it("shows the live connection state on the account pane", async () => {
    await renderPage({
      currentUser: demoUser,
      connectionState: "synchronizing",
    });

    expect(screen.getByText(copy.connectionConnecting)).toBeTruthy();
  });

  it("shows the phone number and the inline bio field on the account pane", async () => {
    await renderPage({ currentUser: demoUser });

    expect(screen.getByText(String(demoUser.phone))).toBeTruthy();
    expect(screen.getByLabelText(copy.peerBio)).toBeTruthy();
  });

  it("edits the account name through the Name row dialog", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage({ currentUser: demoUser });
    const updated: CurrentUserDto = {
      ...demoUser,
      displayName: "Ada User",
      initials: "AU",
    };
    telo.workspace.updateProfileName.mockResolvedValue(updated);

    await user.click(screen.getByRole("button", { name: copy.profileName }));
    const dialog = await screen.findByRole("dialog", {
      name: copy.profileName,
    });

    // Prefilled from the display name, tdesktop's EditNameBox behaviour.
    const firstName = within(dialog).getByLabelText(copy.contactFirstName);
    expect(firstName).toHaveProperty("value", "Demo");
    expect(within(dialog).getByLabelText(copy.contactLastName)).toHaveProperty(
      "value",
      "User",
    );

    await user.clear(firstName);
    await user.type(firstName, "Ada");
    await user.click(within(dialog).getByRole("button", { name: copy.save }));

    await waitFor(() => {
      expect(telo.workspace.updateProfileName).toHaveBeenCalledWith({
        firstName: "Ada",
        lastName: "User",
      });
    });
    // The store takes the returned identity, so the cover follows the save.
    await waitFor(() => {
      expect(screen.getAllByText("Ada User").length).toBe(2);
    });
  });

  it("requires a first name before the name dialog can save", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage({ currentUser: demoUser });

    await user.click(screen.getByRole("button", { name: copy.profileName }));
    const dialog = await screen.findByRole("dialog", {
      name: copy.profileName,
    });

    await user.clear(within(dialog).getByLabelText(copy.contactFirstName));

    // Telegram's setName rejects an empty first name; the field says so and
    // the save never leaves the dialog.
    expect(
      await within(dialog).findByText(copy.firstNameRequired),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: copy.save }),
    ).toHaveProperty("disabled", true);
    await user.keyboard("{Enter}");
    expect(telo.workspace.updateProfileName).not.toHaveBeenCalled();
  });

  it("checks username availability live and saves an available name", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage({ currentUser: demoUser });
    telo.workspace.checkUsernameAvailability.mockResolvedValue("available");
    telo.workspace.setUsername.mockResolvedValue({
      ...demoUser,
      username: "ada_lovelace",
    });

    await user.click(screen.getByRole("button", { name: copy.peerUsername }));
    const dialog = await screen.findByRole("dialog", {
      name: copy.peerUsername,
    });
    const field = within(dialog).getByLabelText(copy.peerUsername);
    expect(field).toHaveProperty("value", "demouser");

    await user.clear(field);
    await user.type(field, "ada_lovelace");

    expect(
      await within(dialog).findByText(copy.usernameAvailable, undefined, {
        timeout: 3000,
      }),
    ).toBeTruthy();
    expect(telo.workspace.checkUsernameAvailability).toHaveBeenCalledWith(
      "ada_lovelace",
    );

    await user.click(within(dialog).getByRole("button", { name: copy.save }));
    await waitFor(() => {
      expect(telo.workspace.setUsername).toHaveBeenCalledWith("ada_lovelace");
    });
  });

  it("blocks saving a username that Telegram reports as taken", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage({ currentUser: demoUser });
    telo.workspace.checkUsernameAvailability.mockResolvedValue("taken");

    await user.click(screen.getByRole("button", { name: copy.peerUsername }));
    const dialog = await screen.findByRole("dialog", {
      name: copy.peerUsername,
    });
    const field = within(dialog).getByLabelText(copy.peerUsername);
    await user.clear(field);
    await user.type(field, "taken_name");

    expect(
      await within(dialog).findByText(copy.usernameTaken, undefined, {
        timeout: 3000,
      }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: copy.save }),
    ).toHaveProperty("disabled", true);
    expect(telo.workspace.setUsername).not.toHaveBeenCalled();
  });

  it("explains the username rules instead of checking an invalid candidate", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage({ currentUser: demoUser });

    await user.click(screen.getByRole("button", { name: copy.peerUsername }));
    const dialog = await screen.findByRole("dialog", {
      name: copy.peerUsername,
    });
    const field = within(dialog).getByLabelText(copy.peerUsername);
    await user.clear(field);
    await user.type(field, "ab");

    expect(await within(dialog).findByText(copy.usernameInvalid)).toBeTruthy();
    // Past the debounce: an invalid candidate must never reach the RPC.
    // The tsconfig lib predates Promise.withResolvers; hand-roll the wait.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 600);
    });
    expect(telo.workspace.checkUsernameAvailability).not.toHaveBeenCalled();
    expect(
      within(dialog).getByRole("button", { name: copy.save }),
    ).toHaveProperty("disabled", true);
  });

  it("shows the checking state while the availability RPC is pending", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage({ currentUser: demoUser });
    telo.workspace.checkUsernameAvailability.mockReturnValue(
      // Never settles: the dialog must stay in its checking state.
      new Promise<never>(() => {}),
    );

    await user.click(screen.getByRole("button", { name: copy.peerUsername }));
    const dialog = await screen.findByRole("dialog", {
      name: copy.peerUsername,
    });
    const field = within(dialog).getByLabelText(copy.peerUsername);
    await user.clear(field);
    await user.type(field, "pending_name");

    expect(
      await within(dialog).findByText(copy.usernameChecking, undefined, {
        timeout: 3000,
      }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: copy.save }),
    ).toHaveProperty("disabled", true);
  });

  it("removes the username when the field is saved empty", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage({ currentUser: demoUser });
    telo.workspace.setUsername.mockResolvedValue({
      ...demoUser,
      username: null,
    });

    await user.click(screen.getByRole("button", { name: copy.peerUsername }));
    const dialog = await screen.findByRole("dialog", {
      name: copy.peerUsername,
    });
    await user.clear(within(dialog).getByLabelText(copy.peerUsername));

    await user.click(within(dialog).getByRole("button", { name: copy.save }));
    await waitFor(() => {
      expect(telo.workspace.setUsername).toHaveBeenCalledWith("");
    });
  });

  it("autosaves the bio once typing stops, not per keystroke", async () => {
    const { telo } = await renderPage({ currentUser: demoUser });

    fireEvent.change(screen.getByLabelText(copy.peerBio), {
      target: { value: "Countess of Lovelace" },
    });

    expect(telo.workspace.updateBio).not.toHaveBeenCalled();
    await waitFor(
      () => {
        expect(telo.workspace.updateBio).toHaveBeenCalledWith(
          "Countess of Lovelace",
        );
      },
      { timeout: 3000 },
    );
  });

  it("collapses newlines in the bio before saving", async () => {
    const { telo } = await renderPage({ currentUser: demoUser });

    fireEvent.change(screen.getByLabelText(copy.peerBio), {
      target: { value: "line one\nline two" },
    });

    await waitFor(
      () => {
        expect(telo.workspace.updateBio).toHaveBeenCalledWith(
          "line one line two",
        );
      },
      { timeout: 3000 },
    );
  });

  it("counts down the bio budget and turns destructive at zero", async () => {
    await renderPage({ currentUser: demoUser });

    expect(screen.getByText("70")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(copy.peerBio), {
      target: { value: "x".repeat(70) },
    });

    const counter = screen.getByText("0");
    expect(counter.className).toContain("tabular-nums");
    expect(counter.className).toContain("text-destructive");
  });

  it("uploads a new profile photo picked from the cover", async () => {
    const { telo, container } = await renderPage({ currentUser: demoUser });
    telo.workspace.setProfilePhoto.mockResolvedValue({
      ...demoUser,
      avatarDataUrl: "telo-media://cache/avatar_new.jpg",
    });
    const photo = new File(["pixels"], "photo.png", { type: "image/png" });

    const picker = container.querySelector('input[type="file"]');
    expect(picker).toBeTruthy();
    fireEvent.change(picker as Element, { target: { files: [photo] } });

    await waitFor(() => {
      expect(telo.workspace.setProfilePhoto).toHaveBeenCalledWith(photo);
    });
  });

  it("persists the accent color picked from the radio group", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    await openSection(user, copy.appearance);

    await user.click(screen.getByRole("radio", { name: copy.accentGreen }));

    await waitFor(() => {
      expect(telo.preferences.update).toHaveBeenCalledWith({
        accentColor: "green",
      });
    });
  });

  it("persists the message text size from the slider keyboard control", async () => {
    const user = userEvent.setup();
    const { telo, preferences } = await renderPage();
    await openSection(user, copy.appearance);

    fireEvent.keyDown(
      screen.getByRole("slider", { name: copy.messageTextSize }),
      { key: "ArrowRight" },
    );

    await waitFor(() => {
      expect(telo.preferences.update).toHaveBeenCalledWith({
        messageTextSize: preferences.messageTextSize + 1,
      });
    });
  });

  it("persists the reduce-motion override", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    await openSection(user, copy.appearance);

    await user.click(screen.getByRole("switch", { name: copy.reduceMotion }));

    await waitFor(() => {
      expect(telo.preferences.update).toHaveBeenCalledWith({
        reduceMotion: true,
      });
    });
  });

  it("persists the time format choice", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    await openSection(user, copy.chatSettings);

    await user.click(screen.getByRole("radio", { name: copy.timeFormat24h }));

    await waitFor(() => {
      expect(telo.preferences.update).toHaveBeenCalledWith({
        timeFormat: "24h",
      });
    });
  });

  it("persists the send-with-enter choice", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    await openSection(user, copy.chatSettings);

    await user.click(
      screen.getByRole("radio", { name: copy.sendWithEnterCmdEnter }),
    );

    await waitFor(() => {
      expect(telo.preferences.update).toHaveBeenCalledWith({
        sendWithEnter: false,
      });
    });
  });

  it("persists the sticker looping choice", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    await openSection(user, copy.chatSettings);

    await user.click(screen.getByRole("switch", { name: copy.loopStickers }));

    await waitFor(() => {
      expect(telo.preferences.update).toHaveBeenCalledWith({
        loopStickers: false,
      });
    });
  });

  it("toggles desktop notifications from the switch", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    await openSection(user, copy.notifications);

    await user.click(
      screen.getByRole("switch", { name: copy.notificationsDesktop }),
    );

    await waitFor(() => {
      expect(telo.preferences.update).toHaveBeenCalledWith({
        notificationsEnabled: false,
      });
    });
  });

  it("persists the notification content choices", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    await openSection(user, copy.notifications);

    await user.click(await enabledSwitch(copy.notificationPreview));

    await waitFor(() => {
      expect(telo.preferences.update).toHaveBeenCalledWith({
        notificationPreview: false,
      });
    });
  });

  it("disables the notification content rows while notifications are off", async () => {
    const user = userEvent.setup();
    await renderPage({ preferences: { notificationsEnabled: false } });
    await openSection(user, copy.notifications);

    // What a notification says is meaningless while none are sent, but the
    // rows stay put and go inert - vanishing rows read as a missing feature.
    await waitFor(() => {
      expect(
        screen
          .getByRole("switch", { name: copy.notificationPreview })
          .hasAttribute("disabled"),
      ).toBe(true);
    });
    expect(
      screen.getByRole("switch", { name: copy.notificationSenderName }),
    ).toBeTruthy();
  });

  it("persists the muted-chat badge choice", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    await openSection(user, copy.notifications);

    await user.click(
      screen.getByRole("switch", { name: copy.countMutedChats }),
    );

    await waitFor(() => {
      expect(telo.preferences.update).toHaveBeenCalledWith({
        countMutedChats: true,
      });
    });
  });

  it("reports the media cache size and clears it on demand", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    telo.storage.mediaCacheUsage.mockResolvedValue(2 * 1024 * 1024);
    await openSection(user, copy.dataAndStorage);

    expect(await screen.findByText("2.0 MB")).toBeTruthy();

    telo.storage.mediaCacheUsage.mockResolvedValue(0);
    await user.click(screen.getByRole("button", { name: copy.clearCache }));

    await waitFor(() => {
      expect(telo.storage.clearMediaCache).toHaveBeenCalled();
    });
    // The row re-reads rather than assuming zero, so a partial clear is never
    // reported as an empty cache.
    expect(await screen.findByText("0 B")).toBeTruthy();
  });

  it("persists the media cache ceiling", async () => {
    const user = userEvent.setup();
    const { telo, preferences } = await renderPage();
    await openSection(user, copy.dataAndStorage);

    fireEvent.keyDown(
      screen.getByRole("slider", { name: copy.mediaCacheLimit }),
      { key: "ArrowRight" },
    );

    await waitFor(() => {
      expect(telo.preferences.update).toHaveBeenCalledWith({
        mediaCacheLimitMb: preferences.mediaCacheLimitMb + 64,
      });
    });
  });

  it("saves the agent tuning fields with the rest of the form", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage();
    await openSection(user, copy.agentSettings);

    const steps = await screen.findByRole("slider", {
      name: copy.agentMaxSteps,
    });
    await waitFor(() => {
      expect(steps.getAttribute("aria-valuenow")).toBe("4");
    });
    fireEvent.keyDown(steps, { key: "ArrowRight" });
    await user.click(screen.getByRole("button", { name: copy.save }));

    await waitFor(() => {
      expect(telo.agent.saveConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          maxSteps: 5,
          historyLimit: 20,
        }),
      );
    });
  });

  it("logs out a connected account only after the two-step confirm", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage({ currentUser: demoUser });

    await user.click(screen.getByRole("button", { name: copy.logOut }));
    expect(telo.telegram.logout).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: copy.logOutConfirm }));
    await waitFor(() => {
      expect(telo.telegram.logout).toHaveBeenCalled();
    });
  });

  it("clears the demoWorkspace preference when leaving the demo workspace", async () => {
    const user = userEvent.setup();
    const { telo } = await renderPage({
      currentUser: demoUser,
      preferences: { demoWorkspace: true },
    });

    await user.click(screen.getByRole("button", { name: copy.logOut }));
    await user.click(screen.getByRole("button", { name: copy.logOutConfirm }));

    await waitFor(() => {
      expect(telo.preferences.update).toHaveBeenCalledWith({
        demoWorkspace: false,
      });
    });
  });
});
