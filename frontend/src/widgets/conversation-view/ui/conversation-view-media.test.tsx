import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  MessageDto,
  UserPreferencesDto,
} from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

function stubMatchMedia(): void {
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

type IntersectionCallback = (
  entries: Array<{ isIntersecting: boolean }>,
) => void;

let intersectionCallbacks: IntersectionCallback[] = [];

// jsdom does not implement IntersectionObserver, which the thumbnail preload
// and the paging sentinels use.
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
    body: "",
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-01-01T10:00:00.000Z",
    outgoing: false,
    status: "read",
    ...partial,
  } satisfies MessageDto;
}

function photo(id: string, fileName: string): NonNullable<MessageDto["media"]> {
  return {
    id,
    kind: "photo",
    fileName,
    mimeType: "image/png",
    size: null,
    width: 640,
    height: 480,
    duration: null,
    spoiler: false,
  };
}

function readyDownload(url: string) {
  return {
    state: "ready" as const,
    downloadedBytes: 100,
    totalBytes: 100,
    url,
    error: null,
  };
}

async function renderView({
  messages,
  mediaDownloads = {},
}: {
  messages: MessageDto[];
  mediaDownloads?: Record<string, ReturnType<typeof readyDownload>>;
}) {
  const telo = installTeloApiMock();
  telo.preferences.get.mockResolvedValue({
    agentPanelOpen: false,
    demoWorkspace: false,
    theme: "system",
    accentColor: "blue",
    messageTextSize: 14,
    timeFormat: "system",
    sendWithEnter: true,
    notificationsEnabled: false,
    sidebarWidth: 280,
    agentPanelWidth: 380,
    recentEmojis: [],
    messageTemplates: [],
  } satisfies UserPreferencesDto);
  const { useChatStore } = await import("../../../entities/chat");
  useChatStore.setState({
    chats: [chat({ id: "chat-1", title: "Media Chat" })],
    messages,
    activeChatId: "chat-1",
    loading: false,
    mediaDownloads,
  });
  const { ConversationView } = await import("./conversation-view");
  render(<ConversationView />);
  return { telo, useChatStore };
}

describe("ConversationView media", () => {
  beforeEach(() => {
    vi.resetModules();
    stubMatchMedia();
    stubIntersectionObserver();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preloads a photo thumbnail when the bubble scrolls into view", async () => {
    const { telo } = await renderView({
      messages: [message({ id: "m1", media: photo("chat-1/1", "one.png") })],
    });
    expect(telo.workspace.downloadMedia).not.toHaveBeenCalled();

    act(() => intersectAll());

    expect(telo.workspace.downloadMedia).toHaveBeenCalledWith("chat-1/1");
  });

  it("preloads a link-preview thumbnail through its thumbnail media id", async () => {
    const { telo } = await renderView({
      messages: [
        message({
          id: "m1",
          body: "https://example.com/article",
          media: {
            id: "chat-1/9",
            kind: "webpage",
            url: "https://example.com/article",
            displayUrl: "example.com/article",
            siteName: null,
            title: "An article",
            description: null,
            thumbnailMediaId: "chat-1/9-thumb",
          },
        }),
      ],
    });

    act(() => intersectAll());

    expect(telo.workspace.downloadMedia).toHaveBeenCalledWith("chat-1/9-thumb");
  });

  it("renders grouped messages as one album grid with the caption on the first tile", async () => {
    await renderView({
      messages: [
        message({
          id: "a1",
          body: "Album caption",
          media: photo("chat-1/a1", "one.png"),
          groupedId: "g1",
        }),
        message({
          id: "a2",
          media: photo("chat-1/a2", "two.png"),
          groupedId: "g1",
        }),
        message({
          id: "a3",
          media: photo("chat-1/a3", "three.png"),
          groupedId: "g1",
        }),
      ],
      mediaDownloads: {
        "chat-1/a1": readyDownload("telo-media://cache/a1.png"),
        "chat-1/a2": readyDownload("telo-media://cache/a2.png"),
        "chat-1/a3": readyDownload("telo-media://cache/a3.png"),
      },
    });

    const firstTile = screen.getByRole("button", { name: "one.png" });
    const grid = firstTile.closest(".grid");
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain("grid-cols-2");
    for (const name of ["two.png", "three.png"]) {
      expect(screen.getByRole("button", { name }).closest(".grid")).toBe(grid);
    }
    // One shared sender header and a single caption for the whole album.
    expect(screen.getAllByText("Sender")).toHaveLength(1);
    expect(screen.getByText("Album caption")).toBeTruthy();
  });

  it("opens the viewer from a ready photo and navigates with arrow keys", async () => {
    await renderView({
      messages: [
        message({ id: "m1", media: photo("chat-1/1", "one.png") }),
        message({
          id: "a1",
          media: photo("chat-1/a1", "two.png"),
          groupedId: "g1",
        }),
        message({
          id: "a2",
          media: photo("chat-1/a2", "three.png"),
          groupedId: "g1",
        }),
      ],
      mediaDownloads: {
        "chat-1/1": readyDownload("telo-media://cache/one.png"),
        "chat-1/a1": readyDownload("telo-media://cache/two.png"),
        "chat-1/a2": readyDownload("telo-media://cache/three.png"),
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "one.png" }));
    const dialog = await screen.findByRole("dialog", {
      name: copy.mediaViewer,
    });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
      "telo-media://cache/one.png",
    );

    // Album tiles are part of the same navigation sequence.
    await userEvent.keyboard("{ArrowRight}");
    expect(
      screen
        .getByRole("dialog", { name: copy.mediaViewer })
        .querySelector("img")
        ?.getAttribute("src"),
    ).toBe("telo-media://cache/two.png");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers Open and Save as for media messages in the context menu", async () => {
    const { telo } = await renderView({
      messages: [message({ id: "m1", media: photo("chat-1/1", "one.png") })],
      mediaDownloads: {
        "chat-1/1": readyDownload("telo-media://cache/one.png"),
      },
    });

    // The bubble's context menu is pointer-driven; open it via the trigger's
    // contextmenu event on the photo bubble.
    const bubble = screen
      .getByRole("button", { name: "one.png" })
      .closest("[data-slot]") as HTMLElement;
    bubble.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );

    const saveAs = await screen.findByRole("menuitem", {
      name: copy.saveMediaAs,
    });
    await userEvent.click(saveAs);
    expect(telo.workspace.saveMediaAs).toHaveBeenCalledWith(
      "chat-1/1",
      "one.png",
    );

    bubble.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    const open = await screen.findByRole("menuitem", { name: copy.openMedia });
    await userEvent.click(open);
    expect(telo.workspace.openMedia).toHaveBeenCalledWith("chat-1/1");
  });
});
