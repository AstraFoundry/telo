import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageDto } from "../../../../../contracts/src/ipc";
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

function message(partial: Partial<MessageDto> & Pick<MessageDto, "id">) {
  return {
    chatId: "chat-1",
    senderName: "Sender",
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

describe("PinnedMessageBar", () => {
  beforeEach(() => {
    vi.resetModules();
    stubMatchMedia();
  });

  it("renders nothing when the chat has no pinned messages", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listPinnedMessages.mockResolvedValue([]);
    const { PinnedMessageBar } = await import("./pinned-message-bar");
    render(<PinnedMessageBar chatId="chat-1" />);

    await waitFor(() => {
      expect(telo.workspace.listPinnedMessages).toHaveBeenCalledWith("chat-1");
    });
    expect(
      screen.queryByRole("button", { name: copy.pinnedMessages }),
    ).toBeNull();
    expect(screen.queryByText(copy.connectionSynchronizing)).toBeNull();
  });

  it("shows the latest pin and jumps to it", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listPinnedMessages.mockResolvedValue([
      message({ id: "m9", body: "Ship both with the build." }),
    ]);
    const { useChatStore } = await import("../../../entities/chat");
    const requestJumpToMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ requestJumpToMessage });
    const { PinnedMessageBar } = await import("./pinned-message-bar");
    render(<PinnedMessageBar chatId="chat-1" />);

    const bar = await screen.findByRole("button", {
      name: copy.pinnedMessages,
    });
    expect(bar.textContent).toContain("Ship both with the build.");
    expect(bar.textContent).not.toContain("1/1");

    await userEvent.click(bar);
    expect(requestJumpToMessage).toHaveBeenCalledWith("chat-1", "m9");
  });

  it("cycles through several pins on each click", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listPinnedMessages.mockResolvedValue([
      message({ id: "m9", body: "First pin" }),
      message({ id: "m8", body: "Second pin" }),
    ]);
    const { useChatStore } = await import("../../../entities/chat");
    const requestJumpToMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ requestJumpToMessage });
    const { PinnedMessageBar } = await import("./pinned-message-bar");
    render(<PinnedMessageBar chatId="chat-1" />);

    const bar = await screen.findByRole("button", {
      name: copy.pinnedMessages,
    });
    expect(bar.textContent).toContain("1/2");
    expect(bar.textContent).toContain("First pin");

    await userEvent.click(bar);
    expect(requestJumpToMessage).toHaveBeenCalledWith("chat-1", "m9");
    expect(bar.textContent).toContain("2/2");
    expect(bar.textContent).toContain("Second pin");

    await userEvent.click(bar);
    expect(requestJumpToMessage).toHaveBeenCalledWith("chat-1", "m8");
    expect(bar.textContent).toContain("1/2");
    expect(bar.textContent).toContain("First pin");
  });

  it("falls back to a media file name when the pin has no body", async () => {
    installTeloApiMock().workspace.listPinnedMessages.mockResolvedValue([
      message({
        id: "m2",
        body: "  ",
        media: {
          id: "photo-1",
          kind: "photo",
          fileName: "pin.png",
          mimeType: "image/png",
          size: null,
          width: 640,
          height: 480,
          duration: null,
          spoiler: false,
        },
      }),
    ]);
    const { PinnedMessageBar } = await import("./pinned-message-bar");
    render(<PinnedMessageBar chatId="chat-1" />);

    expect(
      (await screen.findByRole("button", { name: copy.pinnedMessages }))
        .textContent,
    ).toContain("pin.png");
  });

  it("reloads pins when the chat changes", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listPinnedMessages.mockImplementation(async (chatId) =>
      chatId === "chat-1"
        ? [message({ id: "a", body: "Ada pin" })]
        : [message({ id: "b", chatId: "chat-2", body: "Grace pin" })],
    );
    const { PinnedMessageBar } = await import("./pinned-message-bar");
    const view = render(<PinnedMessageBar chatId="chat-1" />);
    expect(
      (await screen.findByRole("button", { name: copy.pinnedMessages }))
        .textContent,
    ).toContain("Ada pin");

    view.rerender(<PinnedMessageBar chatId="chat-2" />);
    expect(
      (await screen.findByRole("button", { name: copy.pinnedMessages }))
        .textContent,
    ).toContain("Grace pin");
  });

  it("reloads pins when Telegram reports a pin change", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listPinnedMessages
      .mockResolvedValueOnce([message({ id: "m9", body: "First pin" })])
      .mockResolvedValueOnce([message({ id: "m8", body: "Updated pin" })]);
    const { PinnedMessageBar } = await import("./pinned-message-bar");
    render(<PinnedMessageBar chatId="chat-1" />);
    expect(
      (await screen.findByRole("button", { name: copy.pinnedMessages }))
        .textContent,
    ).toContain("First pin");

    telo.emitWorkspaceEvent({ type: "pinned-messages", chatId: "chat-1" });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: copy.pinnedMessages }).textContent,
      ).toContain("Updated pin");
    });
    expect(telo.workspace.listPinnedMessages).toHaveBeenCalledTimes(2);
  });

  it("keeps the last pins when a reload fails", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listPinnedMessages
      .mockResolvedValueOnce([message({ id: "m9", body: "First pin" })])
      .mockRejectedValueOnce(new Error("CHANNEL_PRIVATE"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { PinnedMessageBar } = await import("./pinned-message-bar");
      render(<PinnedMessageBar chatId="chat-1" />);
      expect(
        (await screen.findByRole("button", { name: copy.pinnedMessages }))
          .textContent,
      ).toContain("First pin");

      telo.emitWorkspaceEvent({ type: "pinned-messages", chatId: "chat-1" });
      await waitFor(() => {
        expect(logged).toHaveBeenCalled();
      });
      expect(
        screen.getByRole("button", { name: copy.pinnedMessages }).textContent,
      ).toContain("First pin");
    } finally {
      logged.mockRestore();
    }
  });
});
