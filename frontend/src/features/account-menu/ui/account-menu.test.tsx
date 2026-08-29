import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatDto, CurrentUserDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
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
    });
    useChatStore.setState({ chats: [], activeChatId: null });
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

  it("opens the menu with Saved Messages and Settings actions", async () => {
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
    expect(screen.getByRole("button", { name: copy.settings })).toBeTruthy();
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
    // The popover content stays mounted for its exit spring, so aria-expanded
    // on the trigger (flipped synchronously by the controlled open state) is
    // the deterministic signal that the menu closed, not the item's removal.
    expect(
      screen
        .getByRole("button", { name: copy.openAccountMenu })
        .getAttribute("aria-expanded"),
    ).toBe("false");
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
});
