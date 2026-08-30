import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatDto } from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

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

async function renderPalette() {
  const telo = installTeloApiMock();
  const { useChatStore } = await import("../../../entities/chat");
  const { GlobalSearchPalette } = await import("./global-search-palette");
  render(<GlobalSearchPalette />);
  return { telo, useChatStore };
}

describe("GlobalSearchPalette", () => {
  beforeEach(() => {
    vi.resetModules();
    // jsdom does not implement ResizeObserver, which the combobox's portal
    // positioning subscribes to.
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays closed until Cmd/Ctrl+K and closes on Escape", async () => {
    await renderPalette();

    expect(
      screen.queryByRole("combobox", { name: copy.searchEverywhereLabel }),
    ).toBeNull();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(
      await screen.findByRole("combobox", { name: copy.searchEverywhereLabel }),
    ).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("combobox", { name: copy.searchEverywhereLabel }),
    ).toBeNull();
  });

  it("searches the server and opens the first chat result with Enter", async () => {
    const { telo, useChatStore } = await renderPalette();
    const hit = chat({ id: "c1", title: "Product Notes" });
    telo.workspace.searchGlobal.mockResolvedValue({
      chats: [hit],
      messages: [],
    });
    const select = vi.fn();
    useChatStore.setState({ select });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const field = await screen.findByRole("combobox", {
      name: copy.searchEverywhereLabel,
    });
    fireEvent.change(field, { target: { value: "Product" } });

    await vi.waitFor(() => {
      expect(telo.workspace.searchGlobal).toHaveBeenCalledWith("Product");
    });
    await screen.findByRole("option", { name: /Product Notes/ });

    fireEvent.keyDown(field, { key: "Enter" });

    expect(select).toHaveBeenCalledWith("c1");
    expect(
      screen.queryByRole("combobox", { name: copy.searchEverywhereLabel }),
    ).toBeNull();
  });

  it("jumps to a message result through the store", async () => {
    const { telo, useChatStore } = await renderPalette();
    telo.workspace.searchGlobal.mockResolvedValue({
      chats: [],
      messages: [
        {
          id: "m1",
          chatId: "c1",
          senderName: "Mina",
          body: "compact spacing notes",
          entities: [],
          media: null,
          groupedId: null,
          sentAt: "2026-01-01T10:00:00.000Z",
          outgoing: false,
          status: "read",
        },
      ],
    });
    const requestJumpToMessage = vi.fn();
    useChatStore.setState({ requestJumpToMessage });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const field = await screen.findByRole("combobox", {
      name: copy.searchEverywhereLabel,
    });
    fireEvent.change(field, { target: { value: "spacing" } });

    await screen.findByRole("option", { name: /compact spacing notes/ });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(requestJumpToMessage).toHaveBeenCalledWith("c1", "m1");
  });
});
