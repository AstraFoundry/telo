import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { EventType, type AGUIEvent } from "@ag-ui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  CurrentUserDto,
  MessageDto,
  StickerItemDto,
  UserPreferencesDto,
} from "../../../../../contracts/src/ipc";
import { MESSAGE_ACTION_EVENT_NAME } from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

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
    sidebarWidth: 280,
    agentPanelWidth: 380,
    recentEmojis: [],
    recentSearches: [],
    messageTemplates: [],
    reduceMotion: false,
    loopStickers: true,
    notificationSenderName: true,
    notificationPreview: true,
    countMutedChats: false,
    mediaCacheLimitMb: 512,
    ...partial,
  } satisfies UserPreferencesDto;
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

function message(partial: Partial<MessageDto> & Pick<MessageDto, "id">) {
  return {
    chatId: "chat-1",
    senderName: "Sender",
    senderId: "peer-sender",
    senderAvatarUrl: null,
    body: "Message body",
    entities: [],
    media: null,
    groupedId: null,
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
  scrollPositions = {},
  peerAvatars = {},
  customEmoji = {},
  currentUser = null,
}: {
  prefs?: Partial<UserPreferencesDto>;
  chats?: ChatDto[];
  messages?: MessageDto[];
  activeChatId?: string | null;
  scrollPositions?: Record<string, number>;
  peerAvatars?: Record<string, string | null>;
  customEmoji?: Record<string, StickerItemDto | null>;
  currentUser?: CurrentUserDto | null;
} = {}) {
  const telo = installTeloApiMock();
  telo.preferences.get.mockResolvedValue(preferences(prefs));
  const { useChatStore } = await import("../../../entities/chat");
  useChatStore.setState({
    chats,
    messages,
    activeChatId,
    loading: false,
    scrollPositions,
    peerAvatars,
    customEmoji,
  });
  const { useTelegramStore } = await import("../../../entities/telegram");
  useTelegramStore.setState({ currentUser });
  const { ConversationView } = await import("./conversation-view");
  const result = render(<ConversationView />);
  return { telo, useChatStore, ...result };
}

function avatarSlot(messageId: string): HTMLElement {
  const row = document.getElementById(`conversation-message-${messageId}`);
  if (!row) throw new Error(`no transcript row for ${messageId}`);
  const slot = row.querySelector<HTMLElement>('[data-slot="message-avatar"]');
  if (!slot) throw new Error(`no avatar slot for ${messageId}`);
  return slot;
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
    const { container } = await renderView();

    expect(
      screen.getByRole("heading", { name: "Saved Messages" }),
    ).toBeTruthy();
    expect(screen.queryByText("saved")).toBeNull();
    expect(container.querySelector("main")?.className).toContain("min-h-0");
    expect(container.querySelector("main")?.className).toContain(
      "overflow-hidden",
    );
  });

  it("labels forwarded bubbles with their original sender", async () => {
    await renderView({
      messages: [
        message({
          id: "m1",
          forwardedFrom: {
            senderName: "Ada Byron",
            senderId: null,
            messageId: null,
          },
        }),
        message({ id: "m2", body: "Original message" }),
      ],
    });

    expect(screen.getByText(copy.forwardedFrom)).toBeTruthy();
    expect(screen.getByText("Ada Byron")).toBeTruthy();
    // A non-forwarded bubble carries no attribution.
    expect(screen.getAllByText(copy.forwardedFrom)).toHaveLength(1);
    // A sender who disallowed linking gives nothing to follow, so the name is
    // not a control that would do nothing.
    expect(screen.queryByRole("button", { name: "Ada Byron" })).toBeNull();
  });

  it("follows a forward to the original message in the original chat", async () => {
    const { useChatStore, telo } = await renderView({
      chats: [
        chat({ id: "chat-1", title: "Saved Messages", kind: "saved" }),
        chat({ id: "chat-2", title: "Telo Design" }),
      ],
      messages: [
        message({
          id: "m1",
          forwardedFrom: {
            senderName: "Mina",
            senderId: "chat-2",
            messageId: "design-7",
          },
        }),
      ],
    });
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Mina" }));

    await waitFor(() => {
      expect(useChatStore.getState().activeChatId).toBe("chat-2");
      expect(useChatStore.getState().jumpTarget).toMatchObject({
        chatId: "chat-2",
        messageId: "design-7",
      });
    });
  });

  it("opens an identity card when the forward's peer has no dialog", async () => {
    await renderView({
      messages: [
        message({
          id: "m1",
          forwardedFrom: {
            senderName: "Ada Byron",
            senderId: "peer-ada",
            messageId: "post-3",
          },
        }),
      ],
    });
    // `vi.resetModules()` per test means the store the component holds is
    // only reachable through the same fresh graph — the reason renderView
    // imports it this way too.
    const { useChatProfileStore } = await import("../../../entities/chat");

    fireEvent.click(screen.getByRole("button", { name: "Ada Byron" }));

    // The transcript can only page a chat it knows; a peer without one gets
    // the same card a message author without a dialog gets.
    expect(useChatProfileStore.getState().peerId).toBe("peer-ada");
  });

  it("names the channel's signed author after the channel", async () => {
    await renderView({
      messages: [
        message({
          id: "m1",
          forwardedFrom: {
            senderName: "Telo News",
            senderId: "channel-1",
            messageId: "42",
            postAuthor: "Mina",
          },
        }),
      ],
    });

    expect(
      screen.getByRole("button", { name: "Telo News (Mina)" }),
    ).toBeTruthy();
  });

  it("paints the author photo on an incoming row and the account photo on an outgoing row", async () => {
    await renderView({
      messages: [
        message({
          id: "m1",
          senderId: "peer-mina",
          senderAvatarUrl: "data:image/gif;base64,bWluYQ==",
        }),
        message({ id: "m2", outgoing: true }),
      ],
      currentUser: {
        id: "peer-self",
        displayName: "Ada Lovelace",
        username: "ada",
        initials: "AL",
        avatarDataUrl: "data:image/gif;base64,YWRh",
      },
    });

    expect(avatarSlot("m1").querySelector("img")?.getAttribute("src")).toBe(
      "data:image/gif;base64,bWluYQ==",
    );
    // Outgoing rows are all authored by the account, so they never consult the
    // per-peer cache.
    expect(avatarSlot("m2").querySelector("img")?.getAttribute("src")).toBe(
      "data:image/gif;base64,YWRh",
    );
  });

  it("tails a run of one author with a single photo and keeps the earlier slots aligned", async () => {
    const photo = "data:image/gif;base64,bWluYQ==";
    await renderView({
      messages: [
        message({ id: "m1", senderId: "peer-mina", senderAvatarUrl: photo }),
        message({ id: "m2", senderId: "peer-mina", senderAvatarUrl: photo }),
        message({ id: "m3", senderId: "peer-lev", senderAvatarUrl: photo }),
      ],
    });

    expect(avatarSlot("m1").className).toContain("invisible");
    expect(avatarSlot("m1").querySelector("img")).toBeNull();
    expect(avatarSlot("m2").className).not.toContain("invisible");
    expect(avatarSlot("m3").className).not.toContain("invisible");
  });

  it("swaps an author skeleton for the photo that lands after the row rendered", async () => {
    const { useChatStore } = await renderView({
      messages: [
        message({
          id: "m1",
          senderId: "peer-mina",
          senderAvatarUrl: null,
          senderAvatarPending: true,
        }),
      ],
    });

    expect(
      within(avatarSlot("m1")).getByRole("status", {
        name: copy.loadingAvatar,
      }),
    ).toBeTruthy();

    act(() => {
      useChatStore.getState().receive({
        type: "chat-avatar",
        chatId: "peer-mina",
        avatarDataUrl: "data:image/gif;base64,bWluYQ==",
      });
    });

    expect(avatarSlot("m1").querySelector("img")?.getAttribute("src")).toBe(
      "data:image/gif;base64,bWluYQ==",
    );
  });

  it("opens the author profile when the transcript avatar is pressed", async () => {
    await renderView({
      messages: [message({ id: "m1", senderId: "peer-mina" })],
    });
    const { useChatProfileStore } = await import("../../../entities/chat");

    act(() => {
      within(avatarSlot("m1"))
        .getByRole("button", { name: copy.openProfile })
        .click();
    });

    expect(useChatProfileStore.getState().open).toBe(true);
    expect(useChatProfileStore.getState().peerId).toBe("peer-mina");
  });

  it("draws a sticker straight on the background, with no bubble", async () => {
    await renderView({
      messages: [
        message({
          id: "m1",
          body: "",
          media: {
            id: "chat-1/m1",
            kind: "sticker",
            fileName: "wave.webp",
            mimeType: "image/webp",
            size: 4096,
            width: 512,
            height: 512,
            duration: null,
            spoiler: false,
            sticker: {
              emoji: "👋",
              format: "static",
              setReference: { kind: "short-name", shortName: "TeloPack" },
              outlinePath: null,
            },
          },
        }),
      ],
    });

    const row = document.getElementById("conversation-message-m1");
    expect(row?.querySelector('[data-slot="sticker"]')).toBeTruthy();
    // Telegram gives a sticker no surface: no bubble, no padding, no tail.
    expect(row?.querySelector('[data-slot="message-bubble"]')).toBeNull();
    // It is never the attachment card either — no file name, no download.
    expect(row?.textContent).not.toContain("wave.webp");
  });

  it("carries the sentence with the glyph until a custom emoji resolves", async () => {
    const { telo } = await renderView({
      messages: [
        message({
          id: "m1",
          body: "Shipping 🎉",
          entities: [
            { type: "custom-emoji", offset: 9, length: 2, documentId: "2" },
          ],
        }),
      ],
    });

    const row = document.getElementById("conversation-message-m1");
    // Telegram's own fallback: the glyph the entity covers reads as text.
    expect(row?.textContent).toContain("Shipping 🎉");
    expect(row?.querySelector('[data-slot="sticker"]')).toBeNull();
    // The transcript is the layer that can fetch the document, so it asks.
    await waitFor(() => {
      expect(telo.workspace.getCustomEmoji).toHaveBeenCalledWith(["2"]);
    });
  });

  it("draws a resolved custom emoji inline in the sentence", async () => {
    await renderView({
      messages: [
        message({
          id: "m1",
          body: "Shipping 🎉",
          entities: [
            { type: "custom-emoji", offset: 9, length: 2, documentId: "2" },
          ],
        }),
      ],
      customEmoji: {
        "2": {
          id: "sticker/2",
          emoji: "🎉",
          format: "static",
          width: 512,
          height: 512,
          outlinePath: null,
        },
      },
    });

    const row = document.getElementById("conversation-message-m1");
    const slot = row?.querySelector<HTMLElement>('[data-slot="sticker"]');
    expect(slot).toBeTruthy();
    // It reads as a character, not as an attachment wedged into the sentence.
    expect(slot?.style.width).toBe("20px");
  });

  it("keeps the bubble when a sticker carries a caption", async () => {
    await renderView({
      messages: [
        message({
          id: "m1",
          body: "look at this",
          media: {
            id: "chat-1/m1",
            kind: "sticker",
            fileName: "wave.webp",
            mimeType: "image/webp",
            size: 4096,
            width: 512,
            height: 512,
            duration: null,
            spoiler: false,
            sticker: {
              emoji: "👋",
              format: "static",
              setReference: { kind: "short-name", shortName: "TeloPack" },
              outlinePath: null,
            },
          },
        }),
      ],
    });

    const row = document.getElementById("conversation-message-m1");
    // The caption needs a surface, so the bubble comes back with it.
    expect(row?.querySelector('[data-slot="message-bubble"]')).toBeTruthy();
    expect(row?.querySelector('[data-slot="sticker"]')).toBeTruthy();
  });

  it("shows the online status line only for an online direct chat", async () => {
    await renderView({
      chats: [chat({ id: "chat-1", title: "Ada Byron", presence: "online" })],
    });

    expect(screen.getByText(copy.online)).toBeTruthy();
  });

  it("shows the secret-chat lock line in the header", async () => {
    await renderView({
      chats: [
        chat({
          id: "chat-1",
          title: "Mina",
          kind: "secret",
        }),
      ],
    });

    expect(screen.getByText(copy.secretChatDeviceLocal)).toBeTruthy();
  });

  it("pins and unpins the active chat from the header", async () => {
    const { telo, useChatStore } = await renderView();

    fireEvent.click(screen.getByRole("button", { name: copy.pinChat }));

    await vi.waitFor(() => {
      expect(useChatStore.getState().chats[0]?.pinned).toBe(true);
    });
    expect(telo.workspace.setChatPinned).toHaveBeenCalledWith("chat-1", true);

    fireEvent.click(screen.getByRole("button", { name: copy.unpinChat }));

    await vi.waitFor(() => {
      expect(useChatStore.getState().chats[0]?.pinned).toBe(false);
    });
    expect(telo.workspace.setChatPinned).toHaveBeenCalledWith("chat-1", false);
  });

  it("opens the in-chat search bar from the header and closes it with Escape", async () => {
    await renderView();

    fireEvent.click(screen.getByRole("button", { name: copy.searchInChat }));

    const field = await screen.findByRole("textbox", {
      name: copy.searchMessages,
    });

    fireEvent.keyDown(field, { key: "Escape" });

    expect(
      screen.queryByRole("textbox", { name: copy.searchMessages }),
    ).toBeNull();
  });

  it("navigates in-chat search matches and highlights the current one", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const { telo } = await renderView({
      messages: [
        message({ id: "m1", body: "alpha" }),
        message({ id: "m2", body: "beta" }),
      ],
    });
    telo.workspace.searchMessages.mockResolvedValue({
      messageIds: ["m2", "m1"],
      totalCount: 2,
      nextCursor: null,
    });

    fireEvent.click(screen.getByRole("button", { name: copy.searchInChat }));
    const field = await screen.findByRole("textbox", {
      name: copy.searchMessages,
    });
    fireEvent.change(field, { target: { value: "a" } });

    // Newest match first: the counter and the highlight land on m2.
    expect(await screen.findByText(`1 ${copy.searchMatchOf} 2`)).toBeTruthy();
    await vi.waitFor(() => {
      expect(
        document
          .getElementById("conversation-message-m2")
          ?.getAttribute("data-highlighted"),
      ).toBe("true");
    });

    fireEvent.keyDown(field, { key: "Enter" });

    expect(await screen.findByText(`2 ${copy.searchMatchOf} 2`)).toBeTruthy();
    await vi.waitFor(() => {
      expect(
        document
          .getElementById("conversation-message-m1")
          ?.getAttribute("data-highlighted"),
      ).toBe("true");
    });
    expect(
      document
        .getElementById("conversation-message-m2")
        ?.getAttribute("data-highlighted"),
    ).toBeNull();

    // Escape clears the highlight together with the search bar.
    fireEvent.keyDown(field, { key: "Escape" });
    expect(
      document
        .getElementById("conversation-message-m1")
        ?.getAttribute("data-highlighted"),
    ).toBeNull();
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
    fireEvent.wheel(screen.getByRole("region", { name: copy.conversation }), {
      deltaY: -100,
    });
    await vi.waitFor(() =>
      expect(intersectionCallbacks.length).toBeGreaterThan(0),
    );
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
    fireEvent.wheel(screen.getByRole("region", { name: copy.conversation }), {
      deltaY: -100,
    });
    await vi.waitFor(() =>
      expect(intersectionCallbacks.length).toBeGreaterThan(0),
    );
    act(() => intersectAll());

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label")).toBe(copy.loadingEarlierMessages);
    expect(status.textContent).toBe("");

    act(() => {
      resolvePage({ items: [], nextCursor: null });
    });
  });

  it("keeps connection copy out of the transcript so the pin strip stays free", async () => {
    const { useChatStore } = await renderView();

    act(() => useChatStore.setState({ connectionState: "offline" }));
    expect(screen.queryByText(copy.connectionOffline)).toBeNull();

    act(() => useChatStore.setState({ connectionState: "synchronizing" }));
    expect(screen.queryByText(copy.connectionSynchronizing)).toBeNull();
  });

  it("does not paint a sync failure under the conversation header", async () => {
    const { useChatStore } = await renderView();

    act(() => {
      useChatStore.getState().receive({
        type: "sync-error",
        message: copy.syncError,
      });
      useChatStore.getState().receive({
        type: "sync-error",
        message: "FLOOD_WAIT_30",
      });
    });
    expect(screen.queryByText(copy.syncError)).toBeNull();
    expect(screen.queryByText("FLOOD_WAIT_30")).toBeNull();
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

    // An incoming message only offers "delete for me" (Telegram rule).
    expect(deleteMessage).toHaveBeenCalledWith("m1", "me");
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
    fireEvent.click(within(dialog).getByRole("button", { name: copy.forward }));

    expect(forwardMessage).toHaveBeenCalledWith("m1", "chat-2", {
      hideSender: false,
    });
  });

  it("renders a quote block when the message replies to another", async () => {
    await renderView({
      messages: [
        message({
          id: "m1",
          body: "Message body",
          replyTo: {
            id: "m0",
            senderName: "Mina",
            body: "Quoted body",
            entities: [],
          },
        }),
      ],
    });

    const quoted = screen.getByText("Quoted body");
    expect(quoted).toBeTruthy();
    expect(screen.getByText("Mina")).toBeTruthy();
    expect(quoted.parentElement?.className).toContain("border-l-2");
  });

  it("shows a typing indicator under the chat title", async () => {
    await renderView({
      chats: [chat({ id: "chat-1", title: "Saved Messages", typing: true })],
    });

    expect(screen.getAllByText(copy.typing).length).toBeGreaterThan(0);
  });

  it("shows a date marker before the first message of a day", async () => {
    await renderView({
      messages: [
        message({
          id: "m1",
          body: "Older day",
          sentAt: "2026-01-01T10:00:00.000Z",
        }),
        message({
          id: "m2",
          body: "Same day",
          sentAt: "2026-01-01T12:00:00.000Z",
        }),
      ],
    });

    expect(screen.getAllByText(/2026|January 1/).length).toBeGreaterThan(0);
  });

  it("jumps to the quoted message when the reply block is clicked", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    await renderView({
      messages: [
        message({ id: "m0", body: "Original body" }),
        message({
          id: "m1",
          body: "Reply body",
          replyTo: {
            id: "m0",
            senderName: "Sender",
            body: "Original body",
            entities: [],
          },
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: copy.jumpToMessage }));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("pages older messages until the quoted message is found", async () => {
    const { telo, useChatStore } = await renderView({
      messages: [
        message({
          id: "m1",
          body: "Reply body",
          replyTo: {
            id: "m0",
            senderName: "Sender",
            body: "Original body",
            entities: [],
          },
        }),
      ],
    });
    Element.prototype.scrollIntoView = vi.fn();
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [message({ id: "m0", body: "Original body" })],
      nextCursor: null,
    });
    act(() => useChatStore.setState({ messageCursor: "m1" }));

    fireEvent.click(screen.getByRole("button", { name: copy.jumpToMessage }));

    await vi.waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
    expect(telo.workspace.listMessagePage).toHaveBeenCalledWith("chat-1", {
      beforeMessageId: "m1",
    });
  });

  it("restores a chat's saved scroll position after reselecting it", async () => {
    await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
      scrollPositions: { "chat-1": 120 },
    });

    await vi.waitFor(() => {
      expect(
        screen.getByRole("region", { name: copy.conversation }).scrollTop,
      ).toBe(120);
    });
  });

  it("lands a newly opened chat at the live edge", async () => {
    await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    const viewport = screen.getByRole("region", { name: copy.conversation });
    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      value: 500,
    });

    await vi.waitFor(() => {
      expect(viewport.scrollTop).toBe(500);
    });
  });

  it("shows a BEUI page-down control away from the live edge", async () => {
    await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    const viewport = screen.getByRole("region", { name: copy.conversation });
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 400 },
    });
    const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      viewport.scrollTop = Number(top);
    });
    Object.defineProperty(viewport, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    viewport.scrollTop = 200;
    fireEvent.scroll(viewport);

    const pageDown = await screen.findByRole("button", {
      name: copy.jumpToLatestMessages,
    });
    fireEvent.click(pageDown);

    expect(scrollTo).toHaveBeenCalledWith({
      top: 1_000,
      behavior: "smooth",
    });
    fireEvent.scroll(viewport);
    await vi.waitFor(() => {
      expect(
        screen.queryByRole("button", { name: copy.jumpToLatestMessages }),
      ).toBeNull();
    });
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

  it("flags a failed bubble and offers Resend and Delete from its menu", async () => {
    const { useChatStore } = await renderView({
      messages: [
        message({
          id: "m1",
          body: "Undelivered body",
          outgoing: true,
          status: "failed",
        }),
      ],
    });
    const resendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ resendMessage });

    expect(screen.getByLabelText(copy.messageSendFailed)).toBeTruthy();

    fireEvent.contextMenu(screen.getByText("Undelivered body"));
    const menu = await screen.findByRole("menu");
    // A failed send never reached Telegram, so the actions that reference a
    // server-side message stay hidden.
    expect(
      within(menu).queryByRole("menuitem", { name: copy.reply }),
    ).toBeNull();
    expect(
      within(menu).queryByRole("menuitem", { name: copy.editMessage }),
    ).toBeNull();
    expect(
      within(menu).queryByRole("menuitem", { name: copy.forward }),
    ).toBeNull();
    expect(
      within(menu).getByRole("menuitem", { name: copy.deleteMessage }),
    ).toBeTruthy();

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.resendMessage }),
    );

    expect(resendMessage).toHaveBeenCalledWith("m1");
  });

  it("does not offer Resend on a delivered message", async () => {
    await renderView({
      messages: [message({ id: "m1", body: "Message body", outgoing: true })],
    });

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");

    expect(
      within(menu).queryByRole("menuitem", { name: copy.resendMessage }),
    ).toBeNull();
  });

  it("renders the unread divider before the first message past the read boundary", async () => {
    await renderView({
      chats: [
        chat({
          id: "chat-1",
          title: "Telo Design",
          unreadCount: 2,
          lastReadMessageId: "m1",
        }),
      ],
      messages: [
        message({ id: "m1", body: "Already read" }),
        message({ id: "m2", body: "First unread" }),
        message({ id: "m3", body: "Second unread" }),
      ],
    });

    const divider = screen.getByText(copy.unreadMessages);
    expect(
      divider.compareDocumentPosition(screen.getByText("First unread")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      divider.compareDocumentPosition(screen.getByText("Already read")) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("hides the unread divider when the chat has no unread messages", async () => {
    await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });

    expect(screen.queryByText(copy.unreadMessages)).toBeNull();
  });

  it("places the unread divider from unreadCount without paging older history", async () => {
    const { telo, useChatStore } = await renderView({
      chats: [
        chat({
          id: "chat-1",
          title: "Telo Design",
          unreadCount: 2,
          lastReadMessageId: "m0",
        }),
      ],
      messages: [message({ id: "m1", body: "First unread" })],
    });
    act(() => useChatStore.setState({ messageCursor: "m1" }));

    const divider = screen.getByText(copy.unreadMessages);
    expect(
      divider.compareDocumentPosition(screen.getByText("First unread")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(telo.workspace.listMessagePage).not.toHaveBeenCalled();
  });

  it("pins the unread divider to the top when the boundary is beyond loaded history", async () => {
    await renderView({
      chats: [
        chat({
          id: "chat-1",
          title: "Telo Design",
          unreadCount: 5,
          lastReadMessageId: "m-ancient",
        }),
      ],
      messages: [message({ id: "m1", body: "Loaded unread" })],
    });

    const divider = screen.getByText(copy.unreadMessages);
    expect(
      divider.compareDocumentPosition(screen.getByText("Loaded unread")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("ConversationView message AI actions", () => {
  beforeEach(() => {
    vi.resetModules();
    stubMatchMedia(false);
    stubIntersectionObserver();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs translate from the bubble menu", async () => {
    const { telo, useChatStore } = await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    telo.agent.run.mockImplementation(async () => {
      // The main process ends every action run with the terminal event.
      telo.emitAgentEvent({
        type: EventType.CUSTOM,
        name: MESSAGE_ACTION_EVENT_NAME,
        value: { type: "done" },
      } as AGUIEvent);
    });

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.translateMessage }),
    );

    await vi.waitFor(() => {
      expect(telo.agent.run).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Message body",
          action: { kind: "translate" },
        }),
      );
    });
    expect(useChatStore.getState().messageAction).toBeNull();
  });

  it("offers every draft-reply tone and passes the chosen one", async () => {
    const { telo } = await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    telo.agent.run.mockResolvedValue(undefined);

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");
    for (const label of [
      copy.draftReplyToneNeutral,
      copy.draftReplyToneFriendly,
      copy.draftReplyToneFormal,
    ]) {
      expect(within(menu).getByRole("menuitem", { name: label })).toBeTruthy();
    }
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.draftReplyToneFormal }),
    );

    await vi.waitFor(() => {
      expect(telo.agent.run).toHaveBeenCalledWith(
        expect.objectContaining({
          action: { kind: "draft-reply", tone: "formal" },
        }),
      );
    });
  });

  it("hides the AI actions for messages that never reached the server", async () => {
    await renderView({
      messages: [
        message({ id: "m1", body: "Undelivered body", status: "failed" }),
      ],
    });

    fireEvent.contextMenu(screen.getByText("Undelivered body"));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: copy.translateMessage }),
    ).toBeNull();
    expect(
      within(menu).queryByRole("menuitem", { name: copy.rewriteMessage }),
    ).toBeNull();
    expect(
      within(menu).queryByRole("menuitem", {
        name: copy.draftReplyToneNeutral,
      }),
    ).toBeNull();
  });

  it("hides the AI actions for messages without text", async () => {
    await renderView({
      messages: [message({ id: "m1", body: "" })],
    });

    const bubble = document
      .getElementById("conversation-message-m1")!
      .querySelector('[data-slot="message-bubble"]') as HTMLElement;
    fireEvent.contextMenu(bubble);
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: copy.translateMessage }),
    ).toBeNull();
  });

  it("shows the action error inline above the composer", async () => {
    const { telo } = await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    telo.agent.run.mockImplementation(async () => {
      telo.emitAgentEvent({
        type: EventType.CUSTOM,
        name: MESSAGE_ACTION_EVENT_NAME,
        value: { type: "error", message: "The agent request failed." },
      } as AGUIEvent);
      telo.emitAgentEvent({
        type: EventType.CUSTOM,
        name: MESSAGE_ACTION_EVENT_NAME,
        value: { type: "done" },
      } as AGUIEvent);
    });

    fireEvent.contextMenu(screen.getByText("Message body"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.rewriteMessage }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(copy.messageActionFailed);
    expect(alert.textContent).toContain("The agent request failed.");
  });
});

describe("ConversationView Wave 4 message interaction", () => {
  beforeEach(() => {
    vi.resetModules();
    stubMatchMedia(false);
    stubIntersectionObserver();
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replies from the hover rail", async () => {
    const { useChatStore } = await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });

    fireEvent.click(screen.getByRole("button", { name: copy.reply }));

    expect(useChatStore.getState().composerTarget).toEqual({
      mode: "reply",
      messageId: "m1",
      preview: "Message body",
    });
  });

  it("runs translate from the hover rail AI popover", async () => {
    const { telo } = await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    telo.agent.run.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole("button", { name: copy.aiActions }));
    const popover = await screen.findByRole("dialog");
    fireEvent.click(
      within(popover).getByRole("button", { name: copy.translateMessage }),
    );

    await vi.waitFor(() => {
      expect(telo.agent.run).toHaveBeenCalledWith(
        expect.objectContaining({ action: { kind: "translate" } }),
      );
    });
  });

  it("hides the rail reply for a failed message", async () => {
    await renderView({
      messages: [
        message({ id: "m1", body: "Undelivered body", status: "failed" }),
      ],
    });

    expect(screen.queryByRole("button", { name: copy.reply })).toBeNull();
    expect(screen.queryByRole("button", { name: copy.aiActions })).toBeNull();
  });

  it("enters selection mode from the menu and shows the batch bar", async () => {
    await renderView({
      messages: [
        message({ id: "m1", body: "First body" }),
        message({ id: "m2", body: "Second body" }),
      ],
    });

    fireEvent.contextMenu(screen.getByText("First body"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.selectMessage }),
    );

    const bar = await screen.findByRole("region", {
      name: copy.selectionActions,
    });
    expect(bar.textContent).toContain(`1 ${copy.messagesSelected}`);

    // The second bubble's toggle joins the selection.
    const second = document.getElementById("conversation-message-m2")!;
    fireEvent.click(
      within(second).getByRole("button", { name: copy.selectMessage }),
    );
    expect(bar.textContent).toContain(`2 ${copy.messagesSelected}`);
  });

  it("batch-deletes the selection for me from the bar", async () => {
    const { telo, useChatStore } = await renderView({
      messages: [
        message({ id: "m1", body: "First body" }),
        message({ id: "m2", body: "Second body" }),
      ],
    });
    useChatStore.setState({ selectedMessageIds: ["m1", "m2"] });

    const bar = await screen.findByRole("region", {
      name: copy.selectionActions,
    });
    fireEvent.click(
      within(bar).getByRole("button", { name: copy.deleteMessage }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(copy.deleteMessagesConfirm)).toBeTruthy();
    // Mixed/incoming selections never see the "for everyone" scope.
    expect(within(dialog).queryByRole("radiogroup")).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: copy.deleteMessage }),
    );

    await vi.waitFor(() => {
      expect(telo.workspace.deleteMessage).toHaveBeenCalledTimes(2);
    });
    expect(telo.workspace.deleteMessage).toHaveBeenCalledWith({
      chatId: "chat-1",
      messageId: "m1",
      scope: "me",
    });
    expect(telo.workspace.deleteMessage).toHaveBeenCalledWith({
      chatId: "chat-1",
      messageId: "m2",
      scope: "me",
    });
    expect(useChatStore.getState().selectedMessageIds).toEqual([]);
  });

  it("offers both scopes for an outgoing message and defaults to everyone", async () => {
    const { useChatStore } = await renderView({
      messages: [
        message({
          id: "m1",
          body: "My body",
          outgoing: true,
          senderName: "You",
        }),
      ],
    });
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ deleteMessage });

    fireEvent.contextMenu(screen.getByText("My body"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.deleteMessage }),
    );

    const dialog = await screen.findByRole("dialog");
    const everyone = within(dialog).getByRole("radio", {
      name: copy.deleteForEveryone,
    });
    expect(everyone.getAttribute("aria-checked")).toBe("true");
    expect(
      within(dialog).getByRole("radio", { name: copy.deleteForMe }),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: copy.deleteMessage }),
    );

    expect(deleteMessage).toHaveBeenCalledWith("m1", "everyone");
  });

  it("exits selection mode with Escape", async () => {
    const { useChatStore } = await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    useChatStore.setState({ selectedMessageIds: ["m1"] });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(useChatStore.getState().selectedMessageIds).toEqual([]);
    expect(
      screen.queryByRole("region", { name: copy.selectionActions }),
    ).toBeNull();
  });

  it("replies to a single selected message with R", async () => {
    const { useChatStore } = await renderView({
      messages: [message({ id: "m1", body: "Message body" })],
    });
    useChatStore.setState({ selectedMessageIds: ["m1"] });

    fireEvent.keyDown(window, { key: "r" });

    expect(useChatStore.getState().composerTarget).toEqual({
      mode: "reply",
      messageId: "m1",
      preview: "Message body",
    });
    expect(useChatStore.getState().selectedMessageIds).toEqual([]);
  });

  it("opens the batch delete dialog with the Delete key", async () => {
    const { useChatStore } = await renderView({
      messages: [
        message({ id: "m1", body: "First body" }),
        message({ id: "m2", body: "Second body" }),
      ],
    });
    useChatStore.setState({ selectedMessageIds: ["m1", "m2"] });

    fireEvent.keyDown(window, { key: "Delete" });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(copy.deleteMessagesConfirm)).toBeTruthy();
  });

  it("opens the in-chat search with Ctrl+F", async () => {
    await renderView();

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    expect(
      await screen.findByRole("textbox", { name: copy.searchMessages }),
    ).toBeTruthy();
  });

  it("edits the last outgoing message with ArrowUp in an empty composer", async () => {
    const { useChatStore } = await renderView({
      messages: [
        message({ id: "m1", body: "Incoming body" }),
        message({
          id: "m2",
          body: "My last body",
          outgoing: true,
          senderName: "You",
          status: "sent",
        }),
      ],
    });

    const composer = screen.getByLabelText(copy.messagePlaceholder);
    fireEvent.keyDown(composer, { key: "ArrowUp" });

    expect(useChatStore.getState().composerTarget).toEqual({
      mode: "edit",
      messageId: "m2",
      preview: "My last body",
    });
  });

  it("ignores ArrowUp in a composer that already has text", async () => {
    const { useChatStore } = await renderView({
      messages: [
        message({
          id: "m2",
          body: "My last body",
          outgoing: true,
          senderName: "You",
          status: "sent",
        }),
      ],
    });

    const composer = screen.getByLabelText(copy.messagePlaceholder);
    fireEvent.change(composer, { target: { value: "draft" } });
    fireEvent.keyDown(composer, { key: "ArrowUp" });

    expect(useChatStore.getState().composerTarget).toBeNull();
  });

  it("navigates the chat list with arrow keys and opens the chat", async () => {
    const { useChatStore } = await renderView({
      chats: [
        chat({ id: "chat-1", title: "Saved Messages", kind: "saved" }),
        chat({ id: "chat-2", title: "Product Notes" }),
      ],
      activeChatId: "chat-1",
    });

    fireEvent.keyDown(window, { key: "ArrowDown" });

    await vi.waitFor(() => {
      expect(useChatStore.getState().activeChatId).toBe("chat-2");
    });
  });

  it("animates only a newly arrived message, not history", async () => {
    const { useChatStore } = await renderView({
      messages: [message({ id: "m1", body: "History body" })],
    });

    expect(
      screen.getByText("History body").closest("article")?.dataset.animateIn,
    ).toBeUndefined();

    act(() => {
      useChatStore.getState().receive({
        type: "message-upsert",
        cause: "new",
        message: message({
          id: "m2",
          body: "Live body",
          sentAt: "2026-01-01T11:00:00.000Z",
        }),
      });
    });

    expect(
      screen.getByText("Live body").closest("article")?.dataset.animateIn,
    ).toBe("true");
    expect(
      screen.getByText("History body").closest("article")?.dataset.animateIn,
    ).toBeUndefined();
  });

  it("crossfades the outgoing delivery glyph without swapping the timestamp", async () => {
    const { useChatStore } = await renderView({
      messages: [
        message({
          id: "m1",
          body: "Outgoing",
          outgoing: true,
          status: "sending",
        }),
      ],
    });

    expect(screen.getByRole("img", { name: copy.messageSending })).toBeTruthy();

    act(() => {
      useChatStore.setState({
        messages: [
          message({
            id: "m1",
            body: "Outgoing",
            outgoing: true,
            status: "sent",
          }),
        ],
      });
    });

    expect(screen.getByRole("img", { name: copy.messageSent })).toBeTruthy();
    expect(
      screen.getByText("Outgoing").closest("article")?.querySelector("time"),
    ).toBeTruthy();
  });

  it("marks a sent message with one check and a read message with two", async () => {
    const { useChatStore } = await renderView({
      messages: [
        message({
          id: "m1",
          body: "Outgoing",
          outgoing: true,
          status: "sent",
        }),
      ],
    });

    const sent = screen.getByText("Outgoing").closest("article");
    expect(
      sent?.querySelector("[data-delivery]")?.getAttribute("data-delivery"),
    ).toBe("check");
    expect(sent?.querySelector('[data-delivery="double-check"]')).toBeNull();

    act(() => {
      useChatStore.setState({
        messages: [
          message({
            id: "m1",
            body: "Outgoing",
            outgoing: true,
            status: "read",
          }),
        ],
      });
    });

    const read = screen.getByText("Outgoing").closest("article");
    expect(read?.querySelector('[data-delivery="double-check"]')).toBeTruthy();
    expect(screen.getByRole("img", { name: copy.messageRead })).toBeTruthy();
  });

  it("reserves the overlay meta's space in the text flow, never over it", async () => {
    await renderView({
      messages: [
        message({ id: "m1", outgoing: true, senderName: "You", senderId: "" }),
        message({
          id: "m2",
          keyboard: { rows: [[{ id: "b1", text: "Pick", kind: "callback" }]] },
        }),
      ],
    });

    const article = (id: string) =>
      document.getElementById(`conversation-message-${id}`);
    // A text bubble carries the spacer inside the text flow and the overlay
    // meta outside it, so the message's text content stays exactly its body.
    const texted = article("m1");
    const body = texted?.querySelector("[class*=pre-wrap]");
    expect(
      body?.querySelector('[data-slot="message-meta-spacer"]'),
    ).toBeTruthy();
    expect(body?.textContent).toBe("Message body");
    expect(
      texted?.querySelector(
        '[data-slot="message-bubble-content"] > div > [data-slot="message-meta"]',
      ),
    ).toBeTruthy();

    // A bubble that continues into an inline keyboard cannot anchor the meta
    // to the text's last line, so it keeps the footer row instead.
    const keyed = article("m2");
    expect(
      keyed?.querySelector('[data-slot="message-meta-spacer"]'),
    ).toBeNull();
    expect(
      keyed?.querySelector(
        '[data-slot="message-footer"] [data-slot="message-meta"]',
      ),
    ).toBeTruthy();
  });
  it("groups a run by one author: tight gap, one header, grouped corners", async () => {
    await renderView({
      messages: [
        message({ id: "m1", sentAt: "2026-01-01T10:00:00.000Z" }),
        message({ id: "m2", sentAt: "2026-01-01T10:01:00.000Z" }),
        message({
          id: "m3",
          outgoing: true,
          senderName: "You",
          senderId: "",
          sentAt: "2026-01-01T10:02:00.000Z",
        }),
      ],
    });

    // The sender is named once per run, on its first row.
    expect(
      document.querySelectorAll('[data-slot="message-header"]'),
    ).toHaveLength(1);

    const bubble = (id: string) =>
      document
        .getElementById(`conversation-message-${id}`)
        ?.querySelector('[data-slot="message-bubble-content"]');
    // The run's first bubble keeps its full top corner on the avatar side;
    // the interior one rounds it down to the grouped small radius. The run's
    // last row keeps its full bottom corner, because that is where the
    // author photo anchors.
    expect(bubble("m1")?.className).not.toContain(
      "rounded-tl-[var(--message-bubble-radius-grouped)]",
    );
    expect(bubble("m2")?.className).toContain(
      "rounded-tl-[var(--message-bubble-radius-grouped)]",
    );
    expect(bubble("m2")?.className).not.toContain(
      "rounded-bl-[var(--message-bubble-radius-grouped)]",
    );

    // Consecutive same-author rows share the tight run gap; the outgoing
    // author switch adds the wider group gap.
    const row = (id: string) =>
      document.getElementById(`conversation-message-${id}`);
    expect(row("m2")?.className ?? "").not.toContain("message-group-gap");
    expect(row("m3")?.className ?? "").toContain("message-group-gap");
  });

  it("shows Typing text instead of dots when the user prefers reduced motion", async () => {
    stubMatchMedia(false, true);
    await renderView({
      chats: [chat({ id: "chat-1", title: "Saved Messages", typing: true })],
    });

    expect(screen.getByText(copy.typing)).toBeTruthy();
    expect(document.querySelector('[data-slot="message-typing"]')).toBeNull();
  });
});
