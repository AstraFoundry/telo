import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

function scheduled(partial: Partial<MessageDto> & Pick<MessageDto, "id">) {
  return {
    chatId: "chat-1",
    senderName: "You",
    senderId: "demo-you",
    senderAvatarUrl: null,
    body: "Message body",
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-01-01T10:00:00.000Z",
    outgoing: true,
    status: "sent",
    scheduledAt: "2026-01-02T10:00:00.000Z",
    ...partial,
  } satisfies MessageDto;
}

describe("ScheduledMessagesBar", () => {
  beforeEach(() => {
    vi.resetModules();
    stubMatchMedia();
    // jsdom has no ResizeObserver, which the morph modal's positioning uses.
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  it("renders nothing when the chat has no scheduled messages", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listScheduledMessages.mockResolvedValue([]);
    const { ScheduledMessagesBar } = await import("./scheduled-messages-bar");
    render(<ScheduledMessagesBar chatId="chat-1" />);

    await waitFor(() => {
      expect(telo.workspace.listScheduledMessages).toHaveBeenCalledWith(
        "chat-1",
      );
    });
    expect(
      screen.queryByRole("button", { name: copy.scheduledMessages }),
    ).toBeNull();
  });

  it("lists the scheduled messages with their delivery time and deletes one", async () => {
    const telo = installTeloApiMock();
    const first = scheduled({ id: "m1", body: "Standup notes" });
    const second = scheduled({ id: "m2", body: "Deploy at noon" });
    telo.workspace.listScheduledMessages.mockResolvedValue([first, second]);
    const { ScheduledMessagesBar } = await import("./scheduled-messages-bar");
    render(<ScheduledMessagesBar chatId="chat-1" />);

    const bar = await screen.findByRole("button", {
      name: copy.scheduledMessages,
    });
    expect(bar.textContent).toContain("2");
    fireEvent.click(bar);
    const dialog = await screen.findByRole("dialog", {
      name: copy.scheduledMessages,
    });
    expect(within(dialog).getByText("Standup notes")).toBeTruthy();
    expect(within(dialog).getByText("Deploy at noon")).toBeTruthy();

    // After the delete the list reloads with only the remaining message.
    telo.workspace.listScheduledMessages.mockResolvedValue([second]);
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: `${copy.deleteScheduledMessage}: Standup notes`,
      }),
    );

    await waitFor(() => {
      expect(telo.workspace.deleteMessage).toHaveBeenCalledWith({
        chatId: "chat-1",
        messageId: "m1",
      });
    });
    await waitFor(() => {
      expect(within(dialog).queryByText("Standup notes")).toBeNull();
    });
    expect(within(dialog).getByText("Deploy at noon")).toBeTruthy();
  });

  it("reloads when the adapter reports a scheduled-list change", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listScheduledMessages.mockResolvedValue([]);
    const { ScheduledMessagesBar } = await import("./scheduled-messages-bar");
    render(<ScheduledMessagesBar chatId="chat-1" />);
    await waitFor(() => {
      expect(telo.workspace.listScheduledMessages).toHaveBeenCalledTimes(1);
    });

    telo.workspace.listScheduledMessages.mockResolvedValue([
      scheduled({ id: "m1", body: "Standup notes" }),
    ]);
    telo.emitWorkspaceEvent({ type: "scheduled-messages", chatId: "chat-1" });

    expect(
      await screen.findByRole("button", { name: copy.scheduledMessages }),
    ).toBeTruthy();
  });
});
