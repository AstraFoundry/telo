import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  MessageDto,
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

type IntersectionCallback = (
  entries: Array<{ isIntersecting: boolean }>,
) => void;

let intersectionCallbacks: IntersectionCallback[] = [];

// jsdom does not implement IntersectionObserver, which the paging sentinels
// use to trigger lazy loading.
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

function message(partial: Partial<MessageDto> & Pick<MessageDto, "id">) {
  return {
    chatId: "chat-1",
    senderName: "Sender",
    body: "Message body",
    sentAt: "2026-01-01T10:00:00.000Z",
    outgoing: false,
    status: "read",
    ...partial,
  } satisfies MessageDto;
}

// The preferences slice is a module-level store that loads once per key, so
// each test imports a fresh module graph after resetting the registry; the
// chat store must come from the same graph as the component.
async function renderView({
  prefs = {},
  chats = [chat({ id: "chat-1", title: "Saved Messages", kind: "saved" })],
  messages = [],
  activeChatId = "chat-1",
}: {
  prefs?: Partial<UserPreferencesDto>;
  chats?: ChatDto[];
  messages?: MessageDto[];
  activeChatId?: string | null;
} = {}) {
  const telo = installTeloApiMock();
  telo.preferences.get.mockResolvedValue(preferences(prefs));
  const { useChatStore } = await import("../../../entities/chat");
  useChatStore.setState({ chats, messages, activeChatId, loading: false });
  const { ConversationView } = await import("./conversation-view");
  const result = render(<ConversationView />);
  return { telo, useChatStore, ...result };
}

describe("ConversationView", () => {
  beforeEach(() => {
    vi.resetModules();
    stubMatchMedia(false);
    stubIntersectionObserver();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the chat title without the raw kind subtitle", async () => {
    await renderView();

    expect(
      screen.getByRole("heading", { name: "Saved Messages" }),
    ).toBeTruthy();
    expect(screen.queryByText("saved")).toBeNull();
  });

  it("loads an earlier message page when the top sentinel enters view", async () => {
    const { telo, useChatStore } = await renderView({
      messages: [message({ id: "2", body: "Newer" })],
    });
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [message({ id: "1", body: "Older" })],
      nextCursor: null,
    });
    act(() => useChatStore.setState({ messageCursor: "2" }));

    // There is no "load earlier" button — scrolling to the top of the
    // transcript brings the sentinel into view and triggers the fetch.
    expect(screen.queryByRole("button", { name: /earlier/i })).toBeNull();
    act(() => intersectAll());

    expect(await screen.findByText("Older")).toBeTruthy();
    expect(telo.workspace.listMessagePage).toHaveBeenCalledWith("chat-1", {
      beforeMessageId: "2",
    });
  });

  it("shows a spinner without visible text while older messages load", async () => {
    const { telo, useChatStore } = await renderView({
      messages: [message({ id: "2", body: "Newer" })],
    });
    let resolvePage: (page: {
      items: ReadonlyArray<MessageDto>;
      nextCursor: string | null;
    }) => void = () => {};
    telo.workspace.listMessagePage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePage = resolve;
        }),
    );
    act(() => useChatStore.setState({ messageCursor: "2" }));
    act(() => intersectAll());

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label")).toBe(copy.loadingEarlierMessages);
    expect(status.textContent).toBe("");

    act(() => {
      resolvePage({ items: [], nextCursor: null });
    });
  });

  it("shows explicit offline and synchronizing states", async () => {
    const { useChatStore } = await renderView();

    act(() => useChatStore.setState({ connectionState: "offline" }));
    expect(screen.getByRole("status").textContent).toContain(
      copy.connectionOffline,
    );

    act(() => useChatStore.setState({ connectionState: "synchronizing" }));
    expect(screen.getByRole("status").textContent).toContain(
      copy.connectionSynchronizing,
    );
  });

  it("renders outgoing bubbles with the accent tint variant", async () => {
    const { container } = await renderView({
      messages: [
        message({ id: "m1", outgoing: true, body: "Outgoing body" }),
        message({ id: "m2", outgoing: false, body: "Incoming body" }),
      ],
    });

    const outgoing = screen
      .getByText("Outgoing body")
      .closest("[data-variant]");
    const incoming = screen
      .getByText("Incoming body")
      .closest("[data-variant]");
    expect(outgoing?.getAttribute("data-variant")).toBe("tint");
    expect(incoming?.getAttribute("data-variant")).toBe("soft");
    expect(container.querySelector('[data-variant="solid"]')).toBeNull();
  });

  it("copies the whole message body from the bubble context menu", async () => {
    await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.copyText }),
    );

    expect(writeText).toHaveBeenCalledWith("Message body");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers to copy only the current selection when text is selected", async () => {
    await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "Message",
    } as Selection);

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: copy.copyText }),
    ).toBeNull();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.copySelectedText }),
    );

    expect(writeText).toHaveBeenCalledWith("Message");
  });

  it("sizes bubble text from the messageTextSize preference", async () => {
    await renderView({
      prefs: { messageTextSize: 18 },
      messages: [message({ id: "m1", body: "Message body" })],
    });

    await vi.waitFor(() => {
      expect(
        screen.getByRole("main").style.getPropertyValue("--message-font-size"),
      ).toBe("18px");
    });
    const bubble = screen
      .getByText("Message body")
      .closest('[class*="var(--message-font-size"]');
    expect(bubble).not.toBeNull();
  });

  it("formats message times with the 24h preference", async () => {
    await renderView({
      prefs: { timeFormat: "24h" },
      messages: [
        message({ id: "m1", body: "Late", sentAt: "2026-01-01T23:30:00" }),
      ],
    });

    await vi.waitFor(() => {
      expect(screen.getByText(/23:30/)).toBeTruthy();
    });
  });

  it("formats message times with the 12h preference", async () => {
    await renderView({
      prefs: { timeFormat: "12h" },
      messages: [
        message({ id: "m1", body: "Late", sentAt: "2026-01-01T23:30:00" }),
      ],
    });

    await vi.waitFor(() => {
      expect(screen.queryByText(/23:30/)).toBeNull();
      expect(screen.getByText(/11:30/)).toBeTruthy();
    });
  });

  it("starts a reply from the bubble context menu", async () => {
    const { useChatStore } = await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    const startReply = vi.fn();
    useChatStore.setState({ startReply });

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: copy.reply }));

    expect(startReply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1" }),
    );
  });

  it("offers Edit only on outgoing messages", async () => {
    await renderView({
      messages: [
        message({ id: "m1", outgoing: true, body: "Outgoing body" }),
        message({ id: "m2", outgoing: false, body: "Incoming body" }),
      ],
    });

    fireEvent.contextMenu(screen.getByText("Outgoing body"));
    let menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: copy.editMessage }),
    ).toBeTruthy();
    fireEvent.keyDown(menu, { key: "Escape" });

    fireEvent.contextMenu(screen.getByText("Incoming body"));
    menu = await screen.findByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: copy.editMessage }),
    ).toBeNull();
  });

  it("starts an edit from the bubble context menu on outgoing messages", async () => {
    const { useChatStore } = await renderView({
      messages: [message({ id: "m1", outgoing: true, body: "Message body" })],
    });
    const startEdit = vi.fn();
    useChatStore.setState({ startEdit });

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.editMessage }),
    );

    expect(startEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1" }),
    );
  });

  it("opens the delete confirmation from a destructive menu item", async () => {
    await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");
    const deleteItem = within(menu).getByRole("menuitem", {
      name: copy.deleteMessage,
    });
    expect(deleteItem.className).toContain("text-destructive");
    fireEvent.click(deleteItem);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(copy.deleteMessageConfirm)).toBeTruthy();
  });

  it("deletes the message after confirmation", async () => {
    const { useChatStore } = await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ deleteMessage });

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.deleteMessage }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: copy.deleteMessage }),
    );

    expect(deleteMessage).toHaveBeenCalledWith("m1");
  });

  it("keeps the message when the delete confirmation is cancelled", async () => {
    const { useChatStore } = await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ deleteMessage });

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.deleteMessage }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: copy.cancel }));

    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("forwards the message to the chat picked in the forward dialog", async () => {
    const { useChatStore } = await renderView({
      chats: [
        chat({ id: "chat-1", title: "Saved Messages", kind: "saved" }),
        chat({ id: "chat-2", title: "Product Notes", initials: "PN" }),
      ],
      messages: [message({ id: "m1", body: "Message body" })],
    });
    const forwardMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ forwardMessage });

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: copy.forward }));

    const dialog = await screen.findByRole("dialog", {
      name: copy.forwardTo,
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Product Notes/ }),
    );

    expect(forwardMessage).toHaveBeenCalledWith("m1", "chat-2");
  });

  it("renders a quote block when the message replies to another", async () => {
    await renderView({
      messages: [
        message({
          id: "m1",
          body: "Message body",
          replyTo: { id: "m0", senderName: "Mina", body: "Quoted body" },
        }),
      ],
    });

    const quoted = screen.getByText("Quoted body");
    expect(quoted).toBeTruthy();
    expect(screen.getByText("Mina")).toBeTruthy();
    expect(quoted.parentElement?.className).toContain("border-l-2");
  });

  it("marks edited messages next to the timestamp", async () => {
    await renderView({
      messages: [
        message({
          id: "m1",
          body: "Message body",
          editedAt: "2026-01-01T11:00:00.000Z",
        }),
        message({ id: "m2", body: "Other body" }),
      ],
    });

    expect(screen.getByText(copy.edited)).toBeTruthy();
    expect(screen.getAllByText(copy.edited)).toHaveLength(1);
  });
});
