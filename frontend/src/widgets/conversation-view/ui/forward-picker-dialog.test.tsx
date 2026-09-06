import "../../../shared/test/test-environment";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatDto, MessageDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "../../../entities/chat";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

import { ForwardPickerDialog } from "./forward-picker-dialog";

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

const forwarded: MessageDto = {
  id: "m1",
  chatId: "chat-1",
  senderName: "Mina",
  senderId: "peer-mina",
  senderAvatarUrl: null,
  body: "Forward me",
  entities: [],
  media: null,
  groupedId: null,
  sentAt: "2026-01-01T10:00:00.000Z",
  outgoing: false,
  status: "read",
};

const CHATS = [
  chat({ id: "chat-1", title: "Saved Messages", kind: "saved" }),
  chat({ id: "chat-2", title: "Product Notes", initials: "PN" }),
  chat({ id: "chat-3", title: "Telo Design", initials: "TD" }),
];

describe("ForwardPickerDialog", () => {
  beforeEach(() => {
    installTeloApiMock();
    useChatStore.setState({
      chats: CHATS,
      forwardMessage: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("filters the target chats by the search field", async () => {
    const user = userEvent.setup();
    render(<ForwardPickerDialog message={forwarded} onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: copy.forwardTo });
    await user.type(
      within(dialog).getByRole("textbox", { name: copy.searchChats }),
      "telo",
    );

    expect(
      within(dialog).getByRole("button", { name: /Telo Design/ }),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: /Product Notes/ }),
    ).toBeNull();
  });

  it("forwards to every picked chat at once", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ForwardPickerDialog message={forwarded} onClose={onClose} />);

    const dialog = await screen.findByRole("dialog", { name: copy.forwardTo });
    await user.click(
      within(dialog).getByRole("button", { name: /Product Notes/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: /Telo Design/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: copy.forward }),
    );

    const forwardMessage = useChatStore.getState().forwardMessage;
    expect(forwardMessage).toHaveBeenCalledTimes(2);
    expect(forwardMessage).toHaveBeenCalledWith("m1", "chat-2", {
      hideSender: false,
    });
    expect(forwardMessage).toHaveBeenCalledWith("m1", "chat-3", {
      hideSender: false,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("passes the hide-sender toggle through to the forward", async () => {
    const user = userEvent.setup();
    render(<ForwardPickerDialog message={forwarded} onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: copy.forwardTo });
    await user.click(
      within(dialog).getByRole("switch", { name: copy.forwardHideSender }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: /Product Notes/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: copy.forward }),
    );

    expect(useChatStore.getState().forwardMessage).toHaveBeenCalledWith(
      "m1",
      "chat-2",
      { hideSender: true },
    );
  });

  it("keeps the forward action disabled until a target is picked", async () => {
    render(<ForwardPickerDialog message={forwarded} onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: copy.forwardTo });
    const action = within(dialog).getByRole("button", { name: copy.forward });
    expect(action).toHaveProperty("disabled", true);
    expect(useChatStore.getState().forwardMessage).not.toHaveBeenCalled();
  });

  it("lists Saved Messages even when that chat was not on the first dialog page", async () => {
    const telo = installTeloApiMock();
    telo.workspace.openSavedMessages.mockResolvedValue(
      chat({
        id: "saved",
        title: "Rafa K93",
        kind: "saved",
        initials: "RK",
      }),
    );
    useChatStore.setState({
      chats: [chat({ id: "chat-2", title: "Product Notes", initials: "PN" })],
      forwardMessage: vi.fn().mockResolvedValue(undefined),
    });
    const user = userEvent.setup();
    render(<ForwardPickerDialog message={forwarded} onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: copy.forwardTo });
    await vi.waitFor(() => {
      expect(telo.workspace.openSavedMessages).toHaveBeenCalledOnce();
    });
    expect(
      within(dialog).getByRole("button", { name: copy.savedMessages }),
    ).toBeTruthy();

    await user.type(
      within(dialog).getByRole("textbox", { name: copy.searchChats }),
      "Saved",
    );
    expect(
      within(dialog).getByRole("button", { name: copy.savedMessages }),
    ).toBeTruthy();
    expect(within(dialog).queryByText("Product Notes")).toBeNull();
  });
});
