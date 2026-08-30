import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { installTeloApiMock } from "shared/test/mock-telo";

import { KeywordFoldersSettings } from "./keyword-folders-settings";

describe("KeywordFoldersSettings", () => {
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
    telo.workspace.listFolders.mockResolvedValue([]);
    telo.workspace.listChatPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    useChatStore.setState({
      chats: [],
      folders: [
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

  it("lists keyword folders and opens the create dialog", async () => {
    const user = userEvent.setup();
    render(<KeywordFoldersSettings />);

    expect(screen.getByText("Spacing")).toBeTruthy();
    expect(screen.getByText("spacing")).toBeTruthy();
    expect(screen.queryByText("Work")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: copy.addKeywordFolder }),
    );
    expect(
      screen.getByRole("heading", { name: copy.addKeywordFolder }),
    ).toBeTruthy();
    expect(screen.getByLabelText(copy.keywordFolderTitle)).toBeTruthy();
    expect(screen.getByLabelText(copy.keywordFolderQuery)).toBeTruthy();
  });

  it("saves a new keyword folder through the chat store", async () => {
    const user = userEvent.setup();
    render(<KeywordFoldersSettings />);

    await user.click(
      screen.getByRole("button", { name: copy.addKeywordFolder }),
    );
    fireEvent.change(screen.getByLabelText(copy.keywordFolderTitle), {
      target: { value: "Retry" },
    });
    fireEvent.change(screen.getByLabelText(copy.keywordFolderQuery), {
      target: { value: "retry" },
    });
    await user.click(
      screen.getByRole("button", { name: copy.saveKeywordFolder }),
    );

    expect(window.telo.workspace.createKeywordFolder).toHaveBeenCalledWith({
      title: "Retry",
      query: "retry",
    });
  });
});
