import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ChatDto } from "../../../../../contracts/src/ipc";
import { ARCHIVE_FOLDER_ID } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { installTeloApiMock } from "shared/test/mock-telo";

import { ChatFoldersSettings } from "./chat-folders-settings";

function chat(id: string, title: string): ChatDto {
  return {
    id,
    title,
    preview: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    unreadCount: 0,
    lastReadMessageId: null,
    muted: false,
    pinned: false,
    kind: "direct",
    initials: title.slice(0, 2).toUpperCase(),
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
  };
}

describe("ChatFoldersSettings", () => {
  beforeAll(() => {
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
  });

  beforeEach(() => {
    const telo = installTeloApiMock();
    telo.workspace.listFolders.mockResolvedValue([
      { id: 2, title: "Work", unreadCount: 3 },
    ]);
    telo.workspace.listChatPage.mockResolvedValue({
      items: [chat("design", "Telo Design")],
      nextCursor: null,
    });
    telo.workspace.getChatFolder.mockResolvedValue({
      id: 2,
      title: "Work",
      includedChatIds: ["design"],
    });
    useChatStore.setState({
      chats: [chat("design", "Telo Design"), chat("mina", "Mina")],
      folders: [
        { id: ARCHIVE_FOLDER_ID, title: "Archive", unreadCount: 2 },
        { id: 2, title: "Work", unreadCount: 3 },
        {
          id: -1,
          title: "Spacing",
          unreadCount: 3,
          kind: "keyword",
          query: "spacing",
        },
      ],
      activeFolderId: null,
    });
  });

  it("lists only server folders — not the Archive or keyword folders", () => {
    render(<ChatFoldersSettings />);

    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.queryByText("Archive")).toBeNull();
    expect(screen.queryByText("Spacing")).toBeNull();
  });

  it("creates a folder from a name and the picked chats", async () => {
    const user = userEvent.setup();
    render(<ChatFoldersSettings />);

    await user.click(
      screen.getByRole("button", { name: copy.addServerFolder }),
    );
    fireEvent.change(screen.getByLabelText(copy.keywordFolderTitle), {
      target: { value: "People" },
    });
    await user.click(screen.getByRole("button", { name: /Mina/ }));
    await user.click(
      screen.getByRole("button", { name: copy.saveServerFolder }),
    );

    expect(window.telo.workspace.createChatFolder).toHaveBeenCalledWith({
      title: "People",
      chatIds: ["mina"],
    });
  });

  it("edits a folder with the membership the server reports", async () => {
    const user = userEvent.setup();
    render(<ChatFoldersSettings />);

    await user.click(
      screen.getByRole("button", { name: copy.editServerFolder }),
    );
    // Membership arrives asynchronously from getChatFolder: the picked chat
    // is preselected once the read settles.
    const design = await screen.findByRole("button", {
      name: /Telo Design/,
    });
    expect(design.getAttribute("aria-pressed")).toBe("true");

    await user.click(design);
    await user.click(
      screen.getByRole("button", { name: copy.saveServerFolder }),
    );

    expect(window.telo.workspace.editChatFolder).toHaveBeenCalledWith({
      id: 2,
      title: "Work",
      chatIds: [],
    });
  });

  it("deletes a folder only after the confirm step", async () => {
    const user = userEvent.setup();
    render(<ChatFoldersSettings />);

    await user.click(
      screen.getByRole("button", { name: copy.editServerFolder }),
    );
    await screen.findByRole("button", { name: /Telo Design/ });

    await user.click(
      screen.getByRole("button", { name: copy.deleteServerFolder }),
    );
    expect(window.telo.workspace.deleteChatFolder).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: copy.deleteServerFolderConfirm }),
    );
    expect(window.telo.workspace.deleteChatFolder).toHaveBeenCalledWith(2);
  });
});
