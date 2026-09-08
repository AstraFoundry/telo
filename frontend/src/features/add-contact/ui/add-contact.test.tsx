import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatDto,
  PeerProfileDto,
  TelegramContactDto,
} from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { installTeloApiMock } from "shared/test/mock-telo";

import { AddContactByPhoneDialog } from "./add-contact-by-phone-dialog";
import { EditPeerContactDialog } from "./edit-peer-contact-dialog";
import { RemovePeerContactConfirm } from "./remove-peer-contact-confirm";

const contact: TelegramContactDto = {
  id: "mina",
  displayName: "Mina Harker",
  username: "mina",
  phone: "+15551234567",
  avatarDataUrl: null,
};

const chat: ChatDto = {
  id: "mina",
  title: "Mina Harker",
  preview: "",
  updatedAt: "2026-01-01T00:00:00.000Z",
  unreadCount: 0,
  lastReadMessageId: null,
  muted: false,
  pinned: false,
  kind: "direct",
  initials: "MH",
  avatarDataUrl: null,
  draftPreview: null,
  typing: false,
};

const profile: PeerProfileDto = {
  id: "mina",
  title: "Mina Harker",
  username: "mina",
  kind: "direct",
  avatarDataUrl: null,
  bio: null,
  phone: "+15551234567",
};

describe("AddContactByPhoneDialog", () => {
  beforeEach(() => {
    useChatStore.setState({ chats: [], activeChatId: null });
  });

  it("keeps Save disabled until a name and an 8-digit phone are entered", async () => {
    installTeloApiMock();
    const user = userEvent.setup();
    render(<AddContactByPhoneDialog open onOpenChange={vi.fn()} />);

    const save = await screen.findByRole("button", { name: copy.save });
    expect(save).toHaveProperty("disabled", true);

    await user.type(screen.getByLabelText(copy.contactFirstName), "Mina");
    expect(save).toHaveProperty("disabled", true);

    await user.type(screen.getByLabelText(copy.peerPhone), "1234567");
    expect(save).toHaveProperty("disabled", true);

    await user.type(screen.getByLabelText(copy.peerPhone), "8");
    expect(save).toHaveProperty("disabled", false);
  });

  it("imports the contact and opens the private chat", async () => {
    const telo = installTeloApiMock();
    telo.workspace.addContactByPhone.mockResolvedValue(contact);
    telo.workspace.openPrivateChat.mockResolvedValue(chat);
    const onOpenChange = vi.fn();
    const onAdded = vi.fn();
    const user = userEvent.setup();
    render(
      <AddContactByPhoneDialog
        open
        onOpenChange={onOpenChange}
        onAdded={onAdded}
      />,
    );

    await user.type(screen.getByLabelText(copy.contactFirstName), "Mina");
    await user.type(screen.getByLabelText(copy.contactLastName), "Harker");
    await user.type(screen.getByLabelText(copy.peerPhone), "+1 (555) 123-4567");
    await user.click(screen.getByRole("button", { name: copy.save }));

    expect(telo.workspace.addContactByPhone).toHaveBeenCalledWith({
      firstName: "Mina",
      lastName: "Harker",
      phone: "+1 (555) 123-4567",
    });
    expect(telo.workspace.openPrivateChat).toHaveBeenCalledWith("mina");
    expect(onAdded).toHaveBeenCalledWith(contact);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(useChatStore.getState().activeChatId).toBe("mina");
  });

  it("offers the not-joined retry when the number is not on Telegram", async () => {
    const telo = installTeloApiMock();
    const user = userEvent.setup();
    render(<AddContactByPhoneDialog open onOpenChange={vi.fn()} />);
    // The modal focuses the first field on open via rAF; await any element
    // so that settles before typing, or keystrokes land in the wrong field.
    await screen.findByRole("button", { name: copy.save });

    await user.type(screen.getByLabelText(copy.contactLastName), "Harker");
    await user.type(screen.getByLabelText(copy.peerPhone), "12345678");
    await user.click(screen.getByRole("button", { name: copy.save }));

    expect(await screen.findByText(copy.contactNotJoined)).toBeTruthy();
    expect(telo.workspace.openPrivateChat).not.toHaveBeenCalled();

    // Back to the form with the draft intact.
    await user.click(screen.getByRole("button", { name: copy.trySomeoneElse }));
    expect(screen.getByLabelText(copy.contactLastName)).toHaveProperty(
      "value",
      "Harker",
    );
  });

  it("surfaces a user-facing detail when the import fails", async () => {
    const telo = installTeloApiMock();
    telo.workspace.addContactByPhone.mockRejectedValue(
      new Error("That number is blocked."),
    );
    const user = userEvent.setup();
    render(<AddContactByPhoneDialog open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText(copy.contactFirstName), "Mina");
    await user.type(screen.getByLabelText(copy.peerPhone), "12345678");
    await user.click(screen.getByRole("button", { name: copy.save }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      `${copy.addContactFailed}: That number is blocked.`,
    );
  });
});

describe("EditPeerContactDialog", () => {
  it("prefills the names from the profile title and saves", async () => {
    const telo = installTeloApiMock();
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <EditPeerContactDialog
        profile={profile}
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    expect(await screen.findByLabelText(copy.contactFirstName)).toHaveProperty(
      "value",
      "Mina",
    );
    expect(screen.getByLabelText(copy.contactLastName)).toHaveProperty(
      "value",
      "Harker",
    );
    // No privacy exception requested, so no share row.
    expect(screen.queryByRole("switch")).toBeNull();

    await user.click(screen.getByRole("button", { name: copy.save }));

    expect(telo.workspace.setPeerContact).toHaveBeenCalledWith({
      userId: "mina",
      firstName: "Mina",
      lastName: "Harker",
      sharePhoneNumber: false,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalled();
  });

  it("offers the phone privacy exception, on by default, when the peer needs it", async () => {
    const telo = installTeloApiMock();
    const user = userEvent.setup();
    render(
      <EditPeerContactDialog
        profile={{ ...profile, needPhonePrivacyException: true }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    const share = await screen.findByRole("switch", {
      name: copy.shareMyPhoneNumber,
    });
    expect(share.getAttribute("aria-checked")).toBe("true");

    await user.click(share);
    await user.click(screen.getByRole("button", { name: copy.save }));

    expect(telo.workspace.setPeerContact).toHaveBeenCalledWith({
      userId: "mina",
      firstName: "Mina",
      lastName: "Harker",
      sharePhoneNumber: false,
    });
  });

  it("keeps Save disabled until the first name is non-empty", async () => {
    installTeloApiMock();
    const user = userEvent.setup();
    render(
      <EditPeerContactDialog profile={profile} open onOpenChange={vi.fn()} />,
    );

    const firstName = await screen.findByLabelText(copy.contactFirstName);
    const save = screen.getByRole("button", { name: copy.save });
    expect(save).toHaveProperty("disabled", false);

    await user.clear(firstName);
    expect(save).toHaveProperty("disabled", true);
  });
});

describe("RemovePeerContactConfirm", () => {
  it("asks for a second click before removing the contact", async () => {
    const telo = installTeloApiMock();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<RemovePeerContactConfirm userId="mina" onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: copy.removeContact }));

    expect(telo.workspace.removePeerContact).not.toHaveBeenCalled();
    const armed = screen.getByRole("button", {
      name: copy.removeContactConfirm,
    });
    await user.click(armed);

    expect(telo.workspace.removePeerContact).toHaveBeenCalledWith("mina");
    expect(onSaved).toHaveBeenCalled();
  });
});
