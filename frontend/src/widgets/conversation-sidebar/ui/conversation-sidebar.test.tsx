import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  UserPreferencesDto,
} from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

function stubMatchMedia(dark: boolean): void {
  // jsdom does not implement matchMedia, which the preferences slice applies
  // at module scope.
  window.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function preferences(partial: Partial<UserPreferencesDto> = {}) {
  return {
    agentPanelOpen: false,
    demoWorkspace: false,
    theme: "system",
    accentColor: "blue",
    messageTextSize: 14,
    timeFormat: "system",
    sendWithEnter: true,
    notificationsEnabled: true,
    ...partial,
  } satisfies UserPreferencesDto;
}

function chat(partial: Partial<ChatDto> & Pick<ChatDto, "id" | "title">) {
  return {
    preview: "",
    updatedAt: "2026-01-01T10:00:00.000Z",
    unreadCount: 0,
    muted: false,
    pinned: false,
    kind: "direct",
    initials: "AB",
    ...partial,
  } satisfies ChatDto;
}

// The preferences slice is a module-level store that loads once per key, so
// each test imports a fresh module graph after resetting the registry; the
// chat store must come from the same graph as the component.
async function renderSidebar({
  prefs = {},
  chats = [chat({ id: "chat-1", title: "Ada Byron" })],
  activeChatId = null,
}: {
  prefs?: Partial<UserPreferencesDto>;
  chats?: ChatDto[];
  activeChatId?: string | null;
} = {}) {
  const telo = installTeloApiMock();
  telo.preferences.get.mockResolvedValue(preferences(prefs));
  const { useChatStore } = await import("../../../entities/chat");
  useChatStore.setState({
    chats,
    messages: [],
    activeChatId,
    loading: false,
  });
  const { ConversationSidebar } = await import("./conversation-sidebar");
  const onOpenSettings = vi.fn();
  const onSelectChat = vi.fn();
  render(
    <ConversationSidebar
      onOpenSettings={onOpenSettings}
      onSelectChat={onSelectChat}
    />,
  );
  return { telo, useChatStore, onOpenSettings, onSelectChat };
}

describe("ConversationSidebar", () => {
  beforeEach(() => {
    vi.resetModules();
    stubMatchMedia(false);
  });

  it("notifies the parent when a chat is selected", async () => {
    const { telo, useChatStore, onSelectChat } = await renderSidebar();
    telo.workspace.listMessages.mockResolvedValue([]);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Ada Byron/ }));

    expect(onSelectChat).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().activeChatId).toBe("chat-1");
  });

  it("notifies the parent even when the chat is already active", async () => {
    const { onSelectChat } = await renderSidebar({ activeChatId: "chat-1" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Ada Byron/ }));

    expect(onSelectChat).toHaveBeenCalledTimes(1);
  });

  it("shows the empty-search message when no chat matches the query", async () => {
    await renderSidebar();
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("textbox", { name: copy.searchChats }),
      "no-such-chat",
    );

    expect(screen.getByText(copy.noChats)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ada Byron/ })).toBeNull();
  });

  it("hides the empty-search message while chats match the query", async () => {
    await renderSidebar();
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("textbox", { name: copy.searchChats }),
      "Ada",
    );

    expect(screen.queryByText(copy.noChats)).toBeNull();
    expect(screen.getByRole("button", { name: /Ada Byron/ })).toBeTruthy();
  });

  it("marks a chat as read from the row context menu, then offers mark unread", async () => {
    const { telo, useChatStore } = await renderSidebar({
      chats: [chat({ id: "chat-1", title: "Ada Byron", unreadCount: 3 })],
    });
    const user = userEvent.setup();
    const row = screen.getByRole("button", { name: /Ada Byron/ });

    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(row);
    const menu = await screen.findByRole("menu");
    await user.click(
      within(menu).getByRole("menuitem", { name: copy.markAsRead }),
    );

    expect(telo.workspace.setChatRead).toHaveBeenCalledWith("chat-1", true);
    expect(useChatStore.getState().chats[0]?.unreadCount).toBe(0);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(row);
    expect(
      await within(await screen.findByRole("menu")).findByRole("menuitem", {
        name: copy.markAsUnread,
      }),
    ).toBeTruthy();
  });

  it("labels pin and mute items from the current chat state and calls the actions", async () => {
    const { telo, useChatStore } = await renderSidebar({
      chats: [chat({ id: "chat-1", title: "Ada Byron", pinned: true })],
    });
    const user = userEvent.setup();
    const row = screen.getByRole("button", { name: /Ada Byron/ });

    fireEvent.contextMenu(row);
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: copy.unpinChat }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitem", { name: copy.muteChat }),
    ).toBeTruthy();
    expect(
      within(menu).queryByRole("menuitem", { name: copy.pinChat }),
    ).toBeNull();

    await user.click(
      within(menu).getByRole("menuitem", { name: copy.unpinChat }),
    );
    expect(telo.workspace.setChatPinned).toHaveBeenCalledWith("chat-1", false);
    expect(useChatStore.getState().chats[0]?.pinned).toBe(false);

    fireEvent.contextMenu(row);
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: copy.muteChat,
      }),
    );
    expect(telo.workspace.setChatMuted).toHaveBeenCalledWith("chat-1", true);
    expect(useChatStore.getState().chats[0]?.muted).toBe(true);
  });

  it("formats the row timestamp with the 24h preference", async () => {
    await renderSidebar({
      prefs: { timeFormat: "24h" },
      chats: [
        chat({
          id: "chat-1",
          title: "Ada Byron",
          updatedAt: "2026-01-01T23:30:00",
        }),
      ],
    });

    await vi.waitFor(() => {
      expect(screen.getByText(/23:30/)).toBeTruthy();
    });
  });

  it("formats the row timestamp with the 12h preference", async () => {
    await renderSidebar({
      prefs: { timeFormat: "12h" },
      chats: [
        chat({
          id: "chat-1",
          title: "Ada Byron",
          updatedAt: "2026-01-01T23:30:00",
        }),
      ],
    });

    await vi.waitFor(() => {
      expect(screen.queryByText(/23:30/)).toBeNull();
      expect(screen.getByText(/11:30/)).toBeTruthy();
    });
  });
});
