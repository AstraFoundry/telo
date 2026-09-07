import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatDto, CurrentUserDto } from "../../../../../contracts/src/ipc";
import { useChatProfileStore, useChatStore } from "entities/chat";
import { useTelegramStore } from "entities/telegram";
import { copy } from "shared/config/copy";
import { installTeloApiMock } from "shared/test/mock-telo";

import { AccountMenu } from "./account-menu";

function chat(
  partial: Partial<ChatDto> & Pick<ChatDto, "id" | "kind">,
): ChatDto {
  return {
    title: "Chat",
    preview: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    initials: "C",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    ...partial,
  };
}

const currentUser: CurrentUserDto = {
  id: "u1",
  displayName: "Ada Lovelace",
  username: "ada",
  initials: "AL",
  avatarDataUrl: null,
};

describe("AccountMenu", () => {
  beforeEach(() => {
    useTelegramStore.setState({
      auth: null,
      configuration: null,
      currentUser: null,
      accounts: [],
      addingAccount: false,
    });
    useChatStore.setState({ chats: [], activeChatId: null });
    useChatProfileStore.setState({ open: false, peerId: null });
    // jsdom does not implement ResizeObserver, which the popover positioning
    // hook uses to re-measure the trigger and panel.
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  it("renders nothing until the current user has loaded", () => {
    const onOpenSettings = vi.fn();
    render(<AccountMenu onOpenSettings={onOpenSettings} />);

    expect(
      screen.queryByRole("button", { name: copy.openAccountMenu }),
    ).toBeNull();
  });

  it("shows the avatar, display name, and username once the current user loads", () => {
    useTelegramStore.setState({ currentUser });
    render(<AccountMenu onOpenSettings={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    ).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("@ada")).toBeTruthy();
  });

  it("opens the complete account menu", async () => {
    useTelegramStore.setState({ currentUser });
    const onOpenSettings = vi.fn();
    const user = userEvent.setup();
    render(<AccountMenu onOpenSettings={onOpenSettings} />);

    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );

    expect(
      await screen.findByRole("button", { name: copy.savedMessages }),
    ).toBeTruthy();
    for (const label of [
      copy.myProfile,
      copy.newStory,
      copy.newGroup,
      copy.newChannel,
      copy.startSecretChat,
      copy.contacts,
      copy.calls,
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: copy.settings })).toBeTruthy();
  });

  it("opens the current user's profile from My Profile", async () => {
    useTelegramStore.setState({ currentUser });
    const user = userEvent.setup();
    render(<AccountMenu onOpenSettings={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );
    await user.click(
      await screen.findByRole("button", { name: copy.myProfile }),
    );

    expect(useChatProfileStore.getState()).toMatchObject({
      open: true,
      peerId: currentUser.id,
    });
  });

  it("opens a contact's private chat from the account menu", async () => {
    useTelegramStore.setState({ currentUser });
    const telo = installTeloApiMock();
    telo.workspace.listContacts.mockResolvedValue([
      {
        id: "mina",
        displayName: "Mina",
        username: "mina",
        phone: null,
        avatarDataUrl: null,
      },
    ]);
    telo.workspace.openPrivateChat.mockResolvedValue(
      chat({ id: "mina", kind: "direct", title: "Mina" }),
    );
    const user = userEvent.setup();
    render(<AccountMenu onOpenSettings={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );
    await user.click(screen.getByRole("button", { name: copy.contacts }));
    await user.click(await screen.findByRole("button", { name: /Mina/ }));

    expect(telo.workspace.openPrivateChat).toHaveBeenCalledWith("mina");
    expect(useChatStore.getState().activeChatId).toBe("mina");
  });

  it("creates a group from selected contacts", async () => {
    useTelegramStore.setState({ currentUser });
    const telo = installTeloApiMock();
    telo.workspace.listContacts.mockResolvedValue([
      {
        id: "mina",
        displayName: "Mina",
        username: "mina",
        phone: null,
        avatarDataUrl: null,
      },
    ]);
    telo.workspace.createGroup.mockResolvedValue(
      chat({ id: "design", kind: "group", title: "Design" }),
    );
    const user = userEvent.setup();
    render(<AccountMenu onOpenSettings={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );
    await user.click(screen.getByRole("button", { name: copy.newGroup }));
    await user.type(await screen.findByLabelText(copy.groupName), "Design");
    await user.click(await screen.findByRole("button", { name: /Mina/ }));
    await user.click(screen.getByRole("button", { name: copy.createGroup }));

    expect(telo.workspace.createGroup).toHaveBeenCalledWith({
      title: "Design",
      userIds: ["mina"],
    });
    expect(useChatStore.getState().activeChatId).toBe("design");
  });

  it("creates a channel from the account menu", async () => {
    useTelegramStore.setState({ currentUser });
    const telo = installTeloApiMock();
    telo.workspace.createChannel.mockResolvedValue(
      chat({ id: "news", kind: "channel", title: "News" }),
    );
    const user = userEvent.setup();
    render(<AccountMenu onOpenSettings={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );
    await user.click(screen.getByRole("button", { name: copy.newChannel }));
    await user.type(await screen.findByLabelText(copy.channelName), "News");
    await user.type(
      screen.getByLabelText(copy.channelDescription),
      "Product updates",
    );
    await user.click(screen.getByRole("button", { name: copy.createChannel }));

    expect(telo.workspace.createChannel).toHaveBeenCalledWith({
      title: "News",
      description: "Product updates",
    });
    expect(useChatStore.getState().activeChatId).toBe("news");
  });

  it("selects the Saved Messages chat and closes the menu", async () => {
    useTelegramStore.setState({ currentUser });
    const telo = installTeloApiMock();
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    useChatStore.setState({
      chats: [
        chat({ id: "general", kind: "direct" }),
        chat({ id: "saved", kind: "saved" }),
      ],
      activeChatId: "general",
    });
    const user = userEvent.setup();
    render(<AccountMenu onOpenSettings={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );
    await user.click(
      await screen.findByRole("button", { name: copy.savedMessages }),
    );

    expect(telo.workspace.listMessagePage).toHaveBeenCalledWith("saved");
    expect(telo.workspace.openSavedMessages).not.toHaveBeenCalled();
    // The popover content stays mounted for its exit spring, so aria-expanded
    // on the trigger (flipped synchronously by the controlled open state) is
    // the deterministic signal that the menu closed, not the item's removal.
    expect(
      screen
        .getByRole("button", { name: copy.openAccountMenu })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("opens Saved Messages through IPC when the chat is not in the loaded list", async () => {
    useTelegramStore.setState({ currentUser });
    const telo = installTeloApiMock();
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    useChatStore.setState({
      chats: [chat({ id: "general", kind: "direct" })],
      activeChatId: "general",
    });
    const user = userEvent.setup();
    render(<AccountMenu onOpenSettings={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );
    await user.click(
      await screen.findByRole("button", { name: copy.savedMessages }),
    );

    expect(telo.workspace.openSavedMessages).toHaveBeenCalledOnce();
    expect(telo.workspace.listMessagePage).toHaveBeenCalledWith("saved");
  });

  it("opens Settings and closes the menu", async () => {
    useTelegramStore.setState({ currentUser });
    const onOpenSettings = vi.fn();
    const user = userEvent.setup();
    render(<AccountMenu onOpenSettings={onOpenSettings} />);

    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );
    await user.click(
      await screen.findByRole("button", { name: copy.settings }),
    );

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("button", { name: copy.openAccountMenu })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
  it("lists every account above the first option, rings the active one, and always offers a plus", async () => {
    useTelegramStore.setState({
      currentUser,
      accounts: [
        {
          id: "a1",
          displayName: "Ada Lovelace",
          username: "ada",
          avatarDataUrl: null,
          active: true,
          unreadCount: 0,
        },
        {
          id: "a2",
          displayName: "Grace Hopper",
          username: "grace",
          avatarDataUrl: null,
          active: false,
          unreadCount: 7,
        },
      ],
    });
    const user = userEvent.setup();
    render(<AccountMenu onOpenSettings={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );

    expect(screen.getByRole("button", { name: "Ada Lovelace" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Ada Lovelace" })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Grace Hopper" })).toBeTruthy();
    // The plus disc is the default add-account affordance, present with one
    // account or several.
    expect(screen.getByRole("button", { name: copy.addAccount })).toBeTruthy();
  });

  it("switches to the tapped account and closes the menu", async () => {
    const switchAccount = vi.fn();
    useTelegramStore.setState({
      currentUser,
      switchAccount,
      accounts: [
        {
          id: "a1",
          displayName: "Ada Lovelace",
          username: "ada",
          avatarDataUrl: null,
          active: true,
          unreadCount: 0,
        },
        {
          id: "a2",
          displayName: "Grace Hopper",
          username: "grace",
          avatarDataUrl: null,
          active: false,
          unreadCount: 7,
        },
      ],
    });
    const user = userEvent.setup();
    render(<AccountMenu onOpenSettings={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );
    await user.click(screen.getByRole("button", { name: "Grace Hopper" }));

    expect(switchAccount).toHaveBeenCalledWith("a2");
    // The active account's disc closes the menu without switching.
    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );
    await user.click(screen.getByRole("button", { name: "Ada Lovelace" }));
    expect(switchAccount).toHaveBeenCalledTimes(1);
  });

  it("starts the add-account flow from the plus disc", async () => {
    const startAddingAccount = vi.fn();
    useTelegramStore.setState({ currentUser, startAddingAccount });
    const user = userEvent.setup();
    render(<AccountMenu onOpenSettings={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: copy.openAccountMenu }),
    );
    await user.click(screen.getByRole("button", { name: copy.addAccount }));

    expect(startAddingAccount).toHaveBeenCalledOnce();
  });
});
