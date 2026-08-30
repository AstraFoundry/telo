import "../../../shared/test/test-environment";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  MessageDto,
  UserPreferencesDto,
} from "../../../../../contracts/src/ipc";
import { useAgentStore } from "../../../entities/agent";
import { useChatProfileStore, useChatStore } from "../../../entities/chat";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

// The widget's public API pulls in the mutual-exclusion subscriptions.
import { ChatProfilePanel } from "../index";

function chat(partial: Partial<ChatDto> & Pick<ChatDto, "id" | "title">) {
  return {
    preview: "",
    updatedAt: "2026-01-01T10:00:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "group",
    initials: "TD",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    ...partial,
  } satisfies ChatDto;
}

function message(partial: Partial<MessageDto> & Pick<MessageDto, "id">) {
  return {
    chatId: "chat-1",
    senderName: "Mina",
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

function photo(id: string, fileName: string) {
  return message({
    id,
    media: {
      id: `chat-1/${id}`,
      kind: "photo",
      fileName,
      mimeType: "image/png",
      size: 100,
      width: 640,
      height: 480,
      duration: null,
      spoiler: false,
    },
  });
}

const SHARED = [photo("m1", "telo-hero.png"), photo("m2", "telo-album.png")];
const PINNED = [
  message({ id: "m9", senderName: "Lev", body: "Ship both with the build." }),
  message({
    id: "m8",
    senderName: "Mina",
    body: "The list should stay compact.",
  }),
];

function preferences() {
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
    messageTemplates: [],
  } satisfies UserPreferencesDto;
}

describe("ChatProfilePanel", () => {
  let telo: ReturnType<typeof installTeloApiMock>;

  beforeEach(() => {
    telo = installTeloApiMock();
    telo.preferences.update.mockResolvedValue(preferences());
    telo.workspace.listSharedMedia.mockResolvedValue({
      items: SHARED,
      nextCursor: null,
    });
    telo.workspace.listPinnedMessages.mockResolvedValue(PINNED);
    useAgentStore.setState({ open: false });
    useChatStore.setState({
      chats: [chat({ id: "chat-1", title: "Telo Design" })],
      activeChatId: "chat-1",
      mediaDownloads: {},
      loading: false,
    });
    useChatProfileStore.setState({ open: true });
  });

  it("loads the chat header, shared media preview, and pinned preview", async () => {
    render(<ChatProfilePanel />);

    expect(await screen.findByText("Telo Design")).toBeTruthy();
    expect(screen.getByText(copy.chatKindGroup)).toBeTruthy();
    expect(telo.workspace.listSharedMedia).toHaveBeenCalledWith("chat-1", {
      limit: 30,
    });
    expect(telo.workspace.listPinnedMessages).toHaveBeenCalledWith("chat-1");

    const mediaSection = screen.getByRole("region", {
      name: copy.sharedMedia,
    });
    expect(
      within(mediaSection).getByRole("button", {
        name: new RegExp(copy.sharedMedia),
      }),
    ).toBeTruthy();
    const pinnedSection = screen.getByRole("region", {
      name: copy.pinnedMessages,
    });
    expect(
      within(pinnedSection).getByText("Ship both with the build."),
    ).toBeTruthy();
  });

  it("navigates into a section view and back, restoring the scroll offset", async () => {
    const user = userEvent.setup();
    render(<ChatProfilePanel />);

    const sectionHeader = await screen.findByRole("button", {
      name: new RegExp(copy.pinnedMessages),
    });
    const scroller = sectionHeader.closest(".overflow-y-auto") as HTMLElement;
    scroller.scrollTop = 120;

    await user.click(sectionHeader);
    expect(
      screen.getByRole("heading", { name: copy.pinnedMessages }),
    ).toBeTruthy();
    expect(scroller.scrollTop).toBe(0);

    await user.click(screen.getByRole("button", { name: copy.back }));
    expect(
      screen.getByRole("heading", { name: copy.chatProfile }),
    ).toBeTruthy();
    expect(scroller.scrollTop).toBe(120);
  });

  it("jumps to the transcript when a pinned message is clicked", async () => {
    const requestJumpToMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ requestJumpToMessage });
    const user = userEvent.setup();
    render(<ChatProfilePanel />);

    const row = await screen.findByRole("button", {
      name: new RegExp("Ship both with the build."),
    });
    await user.click(row);

    expect(requestJumpToMessage).toHaveBeenCalledWith("chat-1", "m9");
  });

  it("opens the media viewer from a shared media tile", async () => {
    useChatStore.setState({
      mediaDownloads: {
        "chat-1/m1": {
          state: "ready",
          downloadedBytes: 100,
          totalBytes: 100,
          url: "telo-media://cache/telo-hero.png",
          error: null,
        },
      },
    });
    const user = userEvent.setup();
    render(<ChatProfilePanel />);

    const tile = await screen.findByRole("button", { name: "telo-hero.png" });
    await user.click(tile);

    const viewer = await screen.findByRole("dialog", {
      name: copy.mediaViewer,
    });
    expect(within(viewer).getByAltText("telo-hero.png")).toBeTruthy();

    await user.click(
      within(viewer).getByRole("button", { name: copy.closeViewer }),
    );
  });

  it("closes the agent panel when it opens, and is closed by it", () => {
    render(<ChatProfilePanel />);

    act(() => useAgentStore.setState({ open: true }));
    expect(useChatProfileStore.getState().open).toBe(false);

    act(() => useChatProfileStore.getState().openPanel());
    expect(useChatProfileStore.getState().open).toBe(true);
    expect(useAgentStore.getState().open).toBe(false);
  });
});
