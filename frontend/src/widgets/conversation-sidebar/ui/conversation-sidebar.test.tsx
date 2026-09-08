import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionConfig } from "motion/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  ChatFolderDto,
  UserPreferencesDto,
} from "../../../../../contracts/src/ipc";
import { ARCHIVE_FOLDER_ID } from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";
import {
  installTeloApiMock,
  testPreferences,
} from "../../../shared/test/mock-telo";

function stubMatchMedia(dark: boolean, reducedMotion = false): void {
  // jsdom does not implement matchMedia, which the preferences slice applies
  // at module scope.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion")
      ? reducedMotion
      : query.includes("prefers-color-scheme: dark") && dark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

type IntersectionCallback = (
  entries: Array<{ isIntersecting: boolean }>,
) => void;

let intersectionCallbacks: IntersectionCallback[] = [];

// jsdom does not implement IntersectionObserver, which the paging sentinel
// uses to trigger lazy loading.
function stubIntersectionObserver(): void {
  intersectionCallbacks = [];
  window.IntersectionObserver = class {
    private readonly callback: IntersectionCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback as unknown as IntersectionCallback;
      intersectionCallbacks.push(this.callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      // Real observers stop reporting after disconnect; mirror that so
      // unmounted sentinels cannot fire.
      intersectionCallbacks = intersectionCallbacks.filter(
        (callback) => callback !== this.callback,
      );
    }
  } as unknown as typeof IntersectionObserver;
}

function intersectAll(): void {
  for (const callback of intersectionCallbacks) {
    callback([{ isIntersecting: true }]);
  }
}

function chatCursor(chatId: string) {
  return chatId;
}

function chat(partial: Partial<ChatDto> & Pick<ChatDto, "id" | "title">) {
  return {
    preview: "",
    updatedAt: "2026-01-01T10:00:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "direct",
    initials: "AB",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    ...partial,
  } satisfies ChatDto;
}

// The preferences slice is a module-level store that loads once per key, so
// each test imports a fresh module graph after resetting the registry; the
// chat store must come from the same graph as the component.
async function renderSidebar({
  prefs = {},
  chats = [chat({ id: "chat-1", title: "Ada Byron" })],
  folders = [],
  activeFolderId = null,
  activeChatId = null,
  loading = false,
  frameless = false,
}: {
  prefs?: Partial<UserPreferencesDto>;
  chats?: ChatDto[];
  folders?: ChatFolderDto[];
  activeFolderId?: number | null;
  activeChatId?: string | null;
  loading?: boolean;
  frameless?: boolean;
} = {}) {
  const telo = installTeloApiMock();
  telo.shell.frameless = frameless;
  telo.preferences.get.mockResolvedValue(testPreferences(prefs));
  telo.preferences.update.mockResolvedValue(testPreferences(prefs));
  const { useChatStore } = await import("../../../entities/chat");
  useChatStore.setState({
    chats,
    folders,
    activeFolderId,
    messages: [],
    activeChatId,
    loading,
  });
  const { ConversationSidebar } = await import("./conversation-sidebar");
  const onOpenSettings = vi.fn();
  const onSelectChat = vi.fn();
  // The real tree mounts the sidebar under the app's MotionConfig, which is
  // where `useReducedMotionConfig` gets its value from; rendering bare would
  // make every reduced-motion branch read as "unset".
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  render(
    <MotionConfig reducedMotion={reduceMotion ? "always" : "never"}>
      <ConversationSidebar
        onOpenSettings={onOpenSettings}
        onSelectChat={onSelectChat}
      />
    </MotionConfig>,
  );
  return { telo, useChatStore, onOpenSettings, onSelectChat };
}

describe("ConversationSidebar", () => {
  beforeEach(() => {
    vi.resetModules();
    stubMatchMedia(false);
    stubIntersectionObserver();
  });

  it("notifies the parent when a chat is selected", async () => {
    const { telo, useChatStore, onSelectChat } = await renderSidebar();
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Ada Byron/ }));

    expect(onSelectChat).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().activeChatId).toBe("chat-1");
  });

  it("paints a bookmark disc for Saved Messages instead of an empty photo slot", async () => {
    await renderSidebar({
      chats: [
        chat({
          id: "saved",
          title: "Rafa K93",
          kind: "saved",
          avatarDataUrl: null,
        }),
      ],
    });

    const row = screen.getByRole("button", { name: /Saved Messages/ });
    expect(row.querySelector("svg")).not.toBeNull();
    expect(row.querySelector("img")).toBeNull();
  });

  it("paints a letter on the accent fill when a chat has no photo", async () => {
    await renderSidebar({
      chats: [
        chat({
          id: "chat-test",
          title: "test",
          avatarDataUrl: null,
          avatarPlaceholder: {
            glyph: "T",
            lightColors: ["#7BC862", "#6EC96C"],
            darkColors: ["#7BC862", "#6EC96C"],
          },
        }),
      ],
    });

    const row = screen.getByRole("button", { name: /test/ });
    expect(row.querySelector("img")).toBeNull();
    expect(row.textContent).toContain("T");
  });

  it("replaces the app title with connection status, never a transcript banner", async () => {
    const { useChatStore } = await renderSidebar();

    const title = screen.getByText(copy.appName);
    expect(title).toBeTruthy();
    expect(title.closest("header")?.className).toContain(
      "window-titlebar-safe",
    );

    act(() => useChatStore.setState({ connectionState: "offline" }));
    expect(screen.getByText(copy.connectionOffline)).toBeTruthy();
    expect(screen.queryByText(copy.appName)).toBeNull();

    act(() => useChatStore.setState({ connectionState: "synchronizing" }));
    expect(screen.getByText(copy.connectionSynchronizing)).toBeTruthy();
    expect(screen.queryByText(copy.connectionOffline)).toBeNull();

    act(() => useChatStore.setState({ connectionState: "connected" }));
    expect(screen.getByText(copy.appName)).toBeTruthy();
  });

  it("places frameless window controls in the header before the app title", async () => {
    await renderSidebar({ frameless: true });

    const header = screen.getByText(copy.appName).closest("header");
    expect(header).not.toBeNull();
    const close = within(header!).getByRole("button", {
      name: copy.windowClose,
    });
    const title = within(header!).getByText(copy.appName);
    expect(
      close.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("notifies the parent even when the chat is already active", async () => {
    const { onSelectChat } = await renderSidebar({ activeChatId: "chat-1" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Ada Byron/ }));

    expect(onSelectChat).toHaveBeenCalledTimes(1);
  });

  it("shows chat-list skeletons instead of the empty state while the first page loads", async () => {
    await renderSidebar({ chats: [], loading: true });

    expect(
      screen.getByRole("status", { name: copy.loadingChatList }),
    ).toBeTruthy();
    // An empty result and a pending one must not read identically.
    expect(screen.queryByText(copy.noChats)).toBeNull();
  });

  it("swaps the list for search history while the field is focused and empty", async () => {
    await renderSidebar({
      prefs: { recentSearches: ["chat-2"] },
      chats: [
        chat({ id: "chat-1", title: "Ada Byron" }),
        chat({ id: "chat-2", title: "Mina Loy" }),
      ],
    });
    const user = userEvent.setup();
    const list = screen.getByRole("navigation", { name: copy.chats });

    await user.click(screen.getByRole("textbox", { name: copy.searchChats }));

    // The whole area under the field becomes the history: recent rows and
    // the section header, with the chat list and folder tabs gone.
    expect(screen.getByText(copy.recentSearches)).toBeTruthy();
    expect(within(list).getByRole("button", { name: /Mina Loy/ })).toBeTruthy();
    expect(
      within(list).queryByRole("button", { name: /Ada Byron/ }),
    ).toBeNull();
  });

  it("returns to the chat list when focus leaves the search surface", async () => {
    await renderSidebar({
      prefs: { recentSearches: ["chat-2"] },
      chats: [
        chat({ id: "chat-1", title: "Ada Byron" }),
        chat({ id: "chat-2", title: "Mina Loy" }),
      ],
    });
    const user = userEvent.setup();
    const field = screen.getByRole("textbox", { name: copy.searchChats });
    const list = screen.getByRole("navigation", { name: copy.chats });

    await user.click(field);
    expect(screen.getByText(copy.recentSearches)).toBeTruthy();

    // Blurring to nowhere — the reader left the search entirely.
    fireEvent.blur(field, { relatedTarget: null });
    expect(screen.queryByText(copy.recentSearches)).toBeNull();
    expect(
      within(list).getByRole("button", { name: /Ada Byron/ }),
    ).toBeTruthy();
  });

  it("opens a history row, records it at the front, and closes the surface", async () => {
    const { useChatStore, telo } = await renderSidebar({
      prefs: { recentSearches: ["chat-2", "chat-1"] },
      chats: [
        chat({ id: "chat-1", title: "Ada Byron" }),
        chat({ id: "chat-2", title: "Mina Loy" }),
      ],
    });
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const user = userEvent.setup();
    const list = screen.getByRole("navigation", { name: copy.chats });

    await user.click(screen.getByRole("textbox", { name: copy.searchChats }));
    await user.click(within(list).getByRole("button", { name: /Mina Loy/ }));

    expect(useChatStore.getState().activeChatId).toBe("chat-2");
    // History is written on selection, never on focusing or typing.
    expect(useChatStore.getState().searchQuery).toBe("");
  });

  it("records a search result the reader opened", async () => {
    const { useChatStore } = await renderSidebar({
      chats: [
        chat({ id: "chat-1", title: "Ada Byron" }),
        chat({ id: "chat-2", title: "Mina Loy" }),
      ],
    });
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("textbox", { name: copy.searchChats }),
      "mina",
    );
    act(() => {
      useChatStore.setState({
        globalSearchResults: {
          chats: [chat({ id: "chat-2", title: "Mina Loy" })],
          messages: [],
        },
      });
    });
    await user.click(screen.getByRole("button", { name: /Mina Loy/ }));

    expect(useChatStore.getState().activeChatId).toBe("chat-2");
  });

  it("clears the whole history behind a danger confirmation", async () => {
    await renderSidebar({
      prefs: { recentSearches: ["chat-2"] },
      chats: [chat({ id: "chat-2", title: "Mina Loy" })],
    });
    const user = userEvent.setup();
    const list = screen.getByRole("navigation", { name: copy.chats });

    await user.click(screen.getByRole("textbox", { name: copy.searchChats }));
    await user.click(
      screen.getByRole("button", { name: copy.clearSearchHistory }),
    );
    expect(screen.getByText(copy.clearSearchHistoryConfirm)).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: copy.clearSearchHistoryAction }),
    );

    expect(within(list).queryByRole("button", { name: /Mina Loy/ })).toBeNull();
    expect(screen.getByText(copy.noRecentSearches)).toBeTruthy();
  });

  it("keeps the empty state once the first page settles empty", async () => {
    await renderSidebar({ chats: [], loading: false });

    expect(screen.getByText(copy.noChats)).toBeTruthy();
    expect(
      screen.queryByRole("status", { name: copy.loadingChatList }),
    ).toBeNull();
  });

  it("shows the empty-search message when the server finds nothing", async () => {
    await renderSidebar();
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("textbox", { name: copy.searchChats }),
      "no-such-chat",
    );

    expect(await screen.findByText(copy.noChats)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ada Byron/ })).toBeNull();
  });

  it("queries the server and shows matching chats", async () => {
    const { telo } = await renderSidebar();
    telo.workspace.searchGlobal.mockResolvedValue({
      chats: [chat({ id: "chat-1", title: "Ada Byron" })],
      messages: [],
    });
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("textbox", { name: copy.searchChats }),
      "Ada",
    );

    expect(
      await screen.findByRole("button", { name: /Ada Byron/ }),
    ).toBeTruthy();
    expect(screen.queryByText(copy.noChats)).toBeNull();
    expect(telo.workspace.searchGlobal).toHaveBeenCalledWith("Ada");
  });

  it("shows server message results and jumps to the match on click", async () => {
    const { telo, useChatStore, onSelectChat } = await renderSidebar();
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    telo.workspace.searchGlobal.mockResolvedValue({
      chats: [],
      messages: [
        {
          id: "m9",
          chatId: "chat-2",
          senderName: "Grace Hopper",
          senderId: "peer-grace",
          senderAvatarUrl: null,
          body: "The compiler notes are ready.",
          entities: [],
          media: null,
          groupedId: null,
          sentAt: "2026-01-01T10:00:00.000Z",
          outgoing: false,
          status: "read",
        },
      ],
    });
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("textbox", { name: copy.searchChats }),
      "compiler",
    );

    const result = await screen.findByRole("button", {
      name: /Grace Hopper/,
    });
    expect(within(result).getByText(/compiler notes/)).toBeTruthy();
    expect(screen.getByText(copy.messages)).toBeTruthy();

    await user.click(result);

    expect(onSelectChat).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().activeChatId).toBe("chat-2");
    expect(useChatStore.getState().jumpTarget).toMatchObject({
      chatId: "chat-2",
      messageId: "m9",
    });
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

    // Unpinning moves the chat out of the Pinned group, which remounts the
    // row — re-query it before opening the menu again.
    fireEvent.contextMenu(screen.getByRole("button", { name: /Ada Byron/ }));
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: copy.muteChat,
      }),
    );
    expect(telo.workspace.setChatMuted).toHaveBeenCalledWith("chat-1", true);
    expect(useChatStore.getState().chats[0]?.muted).toBe(true);
  });

  it("groups pinned chats under a Pinned section above the rest", async () => {
    await renderSidebar({
      chats: [
        chat({ id: "chat-1", title: "Ada Byron" }),
        chat({ id: "chat-2", title: "Grace Hopper", pinned: true }),
      ],
    });

    const nav = screen.getByRole("navigation", { name: copy.chats });
    const text = nav.textContent ?? "";
    expect(text).toContain(copy.pinnedChats);
    expect(text.indexOf(copy.pinnedChats)).toBeLessThan(
      text.indexOf("Grace Hopper"),
    );
    // The pinned chat leads the list even though the store order has it last.
    expect(text.indexOf("Grace Hopper")).toBeLessThan(
      text.indexOf("Ada Byron"),
    );
  });

  it("groups pinned chats inside the active folder only", async () => {
    const { useChatStore } = await renderSidebar({
      chats: [
        chat({ id: "chat-1", title: "Ada Byron", folderId: 2 }),
        chat({ id: "chat-2", title: "Grace Hopper", pinned: true }),
      ],
      folders: [{ id: 2, title: "Work", unreadCount: 0 }],
    });

    // The All view keeps the pinned chat grouped at the top; custom-folder
    // chats stay in the unpinned rest, like Telegram's All list.
    let nav = screen.getByRole("navigation", { name: copy.chats });
    let text = nav.textContent ?? "";
    expect(text).toContain(copy.pinnedChats);
    expect(text.indexOf(copy.pinnedChats)).toBeLessThan(
      text.indexOf("Grace Hopper"),
    );
    expect(text.indexOf("Grace Hopper")).toBeLessThan(
      text.indexOf("Ada Byron"),
    );

    act(() => useChatStore.getState().selectFolder(2));

    // Inside the folder no pinned chat remains, so the section label is gone.
    nav = screen.getByRole("navigation", { name: copy.chats });
    text = nav.textContent ?? "";
    expect(text).not.toContain(copy.pinnedChats);
    expect(text).toContain("Ada Byron");
    expect(text).not.toContain("Grace Hopper");
  });

  it("loads the next chat page when the end sentinel enters view", async () => {
    const { telo, useChatStore } = await renderSidebar();
    telo.workspace.listChatPage.mockResolvedValue({
      items: [chat({ id: "chat-2", title: "Grace Hopper" })],
      nextCursor: null,
    });
    act(() => useChatStore.setState({ chatCursor: chatCursor("chat-1") }));

    act(() => intersectAll());

    expect(
      await screen.findByRole("button", { name: /Grace Hopper/ }),
    ).toBeTruthy();
    expect(telo.workspace.listChatPage).toHaveBeenCalledWith({
      cursor: chatCursor("chat-1"),
    });
  });

  it("shows a spinner without visible text while more chats load", async () => {
    const { telo, useChatStore } = await renderSidebar();
    telo.workspace.listChatPage.mockImplementation(() => new Promise(() => {}));
    act(() => useChatStore.setState({ chatCursor: chatCursor("chat-1") }));

    act(() => intersectAll());

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label")).toBe(copy.loadingChats);
    // Paging feedback is a spinner only — no written "loading" notice.
    expect(status.textContent).toBe("");
  });

  it("pauses paging while a search query is active", async () => {
    const { telo, useChatStore } = await renderSidebar();
    act(() => useChatStore.setState({ chatCursor: chatCursor("chat-1") }));
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("textbox", { name: copy.searchChats }),
      "Ada",
    );
    act(() => intersectAll());

    expect(telo.workspace.listChatPage).not.toHaveBeenCalled();
  });

  it("shows a typing indicator instead of the preview text", async () => {
    await renderSidebar({
      chats: [chat({ id: "chat-1", title: "Ada Byron", typing: true })],
    });

    expect(screen.getAllByText(copy.typing).length).toBeGreaterThan(0);
  });

  it("shows the draft preview with a Draft label instead of the last message", async () => {
    await renderSidebar({
      chats: [
        chat({
          id: "chat-1",
          title: "Ada Byron",
          preview: "Old message",
          draftPreview: "Unsent reply",
        }),
      ],
    });

    expect(screen.getByText(copy.draftPrefix)).toBeTruthy();
    expect(screen.getByText(/Unsent reply/)).toBeTruthy();
    expect(screen.queryByText("Old message")).toBeNull();
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

  it("hides the folder tab bar when the server reports no folders", async () => {
    await renderSidebar();

    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("renders folder tabs with the server unread badges", async () => {
    await renderSidebar({
      chats: [
        chat({ id: "main", title: "Main Chat", folderId: null }),
        chat({
          id: "work",
          title: "Work Chat",
          folderId: 2,
          unreadCount: 3,
        }),
      ],
      folders: [
        { id: 2, title: "Work", unreadCount: 3 },
        { id: ARCHIVE_FOLDER_ID, title: "Archive", unreadCount: 2 },
      ],
    });

    const tabs = screen.getByRole("tablist", { name: copy.chatFolders });
    // The All badge sums its visible chats; folder badges are server counts.
    expect(
      within(tabs).getByRole("tab", {
        name: `${copy.allChats} 3 ${copy.unread}`,
      }),
    ).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: /Work/ })).toBeTruthy();
    expect(
      within(within(tabs).getByRole("tab", { name: /Work/ })).getByLabelText(
        "3 unread",
      ),
    ).toBeTruthy();
    // The Archive is not a tab: both reference clients strip folder 1 from
    // the tab strip and reach it through the pinned row on the All list.
    expect(
      within(tabs).queryByRole("tab", { name: new RegExp(copy.archiveFolder) }),
    ).toBeNull();
  });

  it("filters the chat list by the selected folder tab", async () => {
    const { useChatStore } = await renderSidebar({
      chats: [
        chat({ id: "main", title: "Main Chat", folderId: null }),
        chat({ id: "work", title: "Work Chat", folderId: 2 }),
        chat({
          id: "offsite",
          title: "Offsite Planning",
          folderId: ARCHIVE_FOLDER_ID,
        }),
      ],
      folders: [
        { id: 2, title: "Work", unreadCount: 0 },
        { id: ARCHIVE_FOLDER_ID, title: "Archive", unreadCount: 0 },
      ],
    });
    const user = userEvent.setup();
    const list = screen.getByRole("navigation", { name: copy.chats });

    // The All view keeps archived chats out of the main list.
    expect(within(list).queryByRole("button", { name: /Offsite/ })).toBeNull();
    expect(
      within(list).getByRole("button", { name: /Main Chat/ }),
    ).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /Work/ }));

    expect(useChatStore.getState().activeFolderId).toBe(2);
    expect(
      within(list).getByRole("button", { name: /Work Chat/ }),
    ).toBeTruthy();
    expect(
      within(list).queryByRole("button", { name: /Main Chat/ }),
    ).toBeNull();
    // The row lives on the All list, so the walk returns there first.
    await user.click(screen.getByRole("tab", { name: copy.allChats }));
    await user.click(
      screen.getByRole("button", { name: new RegExp(copy.archivedChats) }),
    );

    expect(
      within(list).getByRole("button", { name: /Offsite Planning/ }),
    ).toBeTruthy();
    expect(
      within(list).queryByRole("button", { name: /Work Chat/ }),
    ).toBeNull();
  });

  it("pins the archive row on the All list with its names and muted badge", async () => {
    await renderSidebar({
      chats: [
        chat({ id: "main", title: "Main Chat", folderId: null }),
        chat({
          id: "offsite",
          title: "Offsite Planning",
          folderId: ARCHIVE_FOLDER_ID,
          unreadCount: 2,
        }),
      ],
      folders: [{ id: ARCHIVE_FOLDER_ID, title: "Archive", unreadCount: 2 }],
    });
    const list = screen.getByRole("navigation", { name: copy.chats });

    const row = within(list).getByRole("button", {
      name: `${copy.archivedChats}, 2 ${copy.unread}`,
    });
    expect(row.textContent).toContain("Offsite Planning");
    // The badge is the folder's muted grey even though the chat is unmuted:
    // the folder's unread is muted by definition (data_folder.cpp:385-398).
    expect(row.querySelector('[class*="bg-muted"]')).not.toBeNull();

    // Nothing archived → no row at all.
    await renderSidebar({ chats: [chat({ id: "x", title: "Solo" })] });
    expect(
      screen.queryByRole("button", { name: new RegExp(copy.archivedChats) }),
    ).toBeNull();
  });

  it("offers a way back to All chats from inside the archive", async () => {
    const { useChatStore } = await renderSidebar({
      chats: [
        chat({ id: "main", title: "Main Chat", folderId: null }),
        chat({
          id: "offsite",
          title: "Offsite Planning",
          folderId: ARCHIVE_FOLDER_ID,
        }),
      ],
      folders: [{ id: ARCHIVE_FOLDER_ID, title: "Archive", unreadCount: 0 }],
    });
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: new RegExp(copy.archivedChats) }),
    );
    expect(useChatStore.getState().activeFolderId).toBe(ARCHIVE_FOLDER_ID);

    await user.click(screen.getByRole("button", { name: copy.backToAllChats }));
    expect(useChatStore.getState().activeFolderId).toBeNull();
  });

  it("archives a chat from its row menu and unarchives it back", async () => {
    const { useChatStore } = await renderSidebar({
      chats: [chat({ id: "chat-1", title: "Ada Byron", folderId: null })],
    });
    const user = userEvent.setup();

    fireEvent.contextMenu(screen.getByRole("button", { name: /Ada Byron/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: copy.archiveChat }),
    );

    await vi.waitFor(() => {
      expect(useChatStore.getState().chats[0]?.folderId).toBe(
        ARCHIVE_FOLDER_ID,
      );
    });
    // The archived chat leaves the All view immediately.
    expect(screen.queryByRole("button", { name: /Ada Byron/ })).toBeNull();
    // And the archive row takes its place with the chat's name on it. The
    // accessible name stays the folder's; the preview is content.
    const archiveRow = screen.getByRole("button", {
      name: copy.archivedChats,
    });
    expect(archiveRow.textContent).toContain("Ada Byron");
  });

  it("shows Typing text instead of dots when the user prefers reduced motion", async () => {
    stubMatchMedia(false, true);
    await renderSidebar({
      chats: [chat({ id: "chat-1", title: "Ada Byron", typing: true })],
    });

    expect(screen.getByText(copy.typing)).toBeTruthy();
    expect(document.querySelector('[data-slot="message-typing"]')).toBeNull();
  });

  it("promotes a chat with a new message to the top with an opacity-only flag", async () => {
    const { useChatStore } = await renderSidebar({
      chats: [
        chat({ id: "chat-1", title: "Ada Byron" }),
        chat({ id: "chat-2", title: "Mina Loy" }),
      ],
    });

    act(() => {
      useChatStore.getState().receive({
        type: "message-upsert",
        cause: "new",
        message: {
          id: "m-new",
          chatId: "chat-2",
          senderName: "Mina",
          senderId: "peer-mina",
          senderAvatarUrl: null,
          body: "Hello",
          entities: [],
          media: null,
          groupedId: null,
          sentAt: "2026-01-01T12:00:00.000Z",
          outgoing: false,
          status: "sent",
        },
      });
    });

    const rows = screen.getAllByRole("button", { name: /Byron|Loy/ });
    expect(rows[0]?.textContent).toContain("Mina Loy");
    expect(rows[0]?.getAttribute("data-promote")).toBe("true");
    expect(rows[1]?.getAttribute("data-promote")).toBeNull();
  });

  it("marks a secret chat row with a lock", async () => {
    await renderSidebar({
      chats: [chat({ id: "secret-mina", title: "Mina", kind: "secret" })],
    });

    expect(screen.getByLabelText(copy.secretChat)).toBeTruthy();
  });
});
