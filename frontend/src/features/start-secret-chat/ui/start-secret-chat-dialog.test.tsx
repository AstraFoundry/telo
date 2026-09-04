import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";
import { useChatStore } from "entities/chat";

import { StartSecretChatDialog } from "./start-secret-chat-dialog";

describe("StartSecretChatDialog", () => {
  beforeEach(() => {
    useChatStore.setState({ chats: [], activeChatId: null });
  });

  it("creates a secret chat and selects it", async () => {
    const telo = installTeloApiMock();
    telo.workspace.createSecretChat.mockResolvedValue({
      id: "secret-mina",
      title: "Mina",
      preview: "",
      updatedAt: "2026-01-01T00:00:00.000Z",
      unreadCount: 0,
      lastReadMessageId: null,
      muted: false,
      pinned: false,
      kind: "secret",
      initials: "M",
      avatarDataUrl: null,
      draftPreview: null,
      typing: false,
      secretState: "ready",
    });
    telo.workspace.listMessagePage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    telo.workspace.listPinnedMessages.mockResolvedValue([]);
    telo.workspace.listChatMembers.mockResolvedValue([]);

    const user = userEvent.setup();
    render(
      <StartSecretChatDialog userId="mina" open onOpenChange={() => {}} />,
    );

    await user.click(
      screen.getByRole("button", { name: copy.startSecretChatAction }),
    );

    expect(telo.workspace.createSecretChat).toHaveBeenCalledWith("mina");
    await act(async () => {
      await Promise.resolve();
    });
    expect(useChatStore.getState().activeChatId).toBe("secret-mina");
  });
});
