import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageDto } from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

function message(partial: Partial<MessageDto> = {}): MessageDto {
  return {
    id: "m1",
    chatId: "a",
    senderName: "Sender",
    senderId: "peer-sender",
    senderAvatarUrl: null,
    body: "Body",
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-01-01T00:00:00.000Z",
    outgoing: false,
    status: "read",
    ...partial,
  };
}

// The bar and the picker both drive the chat store, whose available-reaction
// cache is module state: the import has to run after `vi.resetModules()` in
// each test, so a static import would share one cache across cases.
async function renderBar(subject: MessageDto) {
  const telo = installTeloApiMock();
  const { useChatStore } = await import("../../../entities/chat");
  useChatStore.setState({
    chats: [],
    messages: [subject],
    activeChatId: "a",
    availableReactions: [],
    availableReactionsReady: false,
  });
  const { ReactionBar } = await import("./reaction-bar");
  render(<ReactionBar message={subject} />);
  return { telo, useChatStore };
}

describe("ReactionBar", () => {
  beforeEach(() => {
    vi.resetModules();
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  it("renders a chip per bucket with its count and marks the account's own", async () => {
    await renderBar(
      message({
        reactions: [
          { emoji: "👍", count: 3, chosen: false },
          { emoji: "❤", count: 1, chosen: true },
        ],
      }),
    );

    const chips = screen.getAllByRole("button");
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toBe("👍3");
    expect(chips[1].textContent).toBe("❤1");
    expect(chips[0].getAttribute("aria-pressed")).toBe("false");
    expect(chips[1].getAttribute("aria-pressed")).toBe("true");
    expect(chips[1].dataset.chosen).toBe("true");
  });

  it("renders nothing until a message carries reactions", async () => {
    await renderBar(message());

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sends exactly one reaction call per press", async () => {
    const { telo } = await renderBar(
      message({ reactions: [{ emoji: "👍", count: 1, chosen: false }] }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(telo.workspace.setMessageReaction).toHaveBeenCalledTimes(1);
    expect(telo.workspace.setMessageReaction).toHaveBeenCalledWith({
      chatId: "a",
      messageId: "m1",
      emoji: "👍",
    });
  });

  it("clears the account's own reaction when its chip is pressed again", async () => {
    const { telo } = await renderBar(
      message({ reactions: [{ emoji: "👍", count: 1, chosen: true }] }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(telo.workspace.setMessageReaction).toHaveBeenCalledWith({
      chatId: "a",
      messageId: "m1",
      emoji: "👍",
      remove: true,
    });
  });

  it("reverts the chip when the reaction call fails and paints no alert", async () => {
    const subject = message({
      reactions: [{ emoji: "👍", count: 1, chosen: false }],
    });
    const { telo, useChatStore } = await renderBar(subject);
    telo.workspace.setMessageReaction.mockRejectedValue(
      new Error("REACTION_INVALID"),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    await waitFor(() => {
      expect(useChatStore.getState().messages[0]?.reactions).toEqual([
        { emoji: "👍", count: 1, chosen: false },
      ]);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ReactionPicker", () => {
  beforeEach(() => {
    vi.resetModules();
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  async function renderPicker() {
    const telo = installTeloApiMock();
    telo.workspace.listAvailableReactions.mockResolvedValue(["👍", "❤"]);
    const { useChatStore } = await import("../../../entities/chat");
    const subject = message();
    useChatStore.setState({
      chats: [],
      messages: [subject],
      activeChatId: "a",
      availableReactions: [],
      availableReactionsReady: false,
    });
    const { ReactionPicker } = await import("./reaction-picker");
    render(<ReactionPicker message={subject} />);
    return { telo, useChatStore, subject };
  }

  it("opens from the keyboard and loads the chat's own reactions", async () => {
    const { telo } = await renderPicker();

    const trigger = screen.getByRole("button", { name: copy.react });
    await act(async () => {
      fireEvent.click(trigger);
    });

    expect(telo.workspace.listAvailableReactions).toHaveBeenCalledWith(
      "a",
      "m1",
    );
    await waitFor(() => {
      expect(screen.getByRole("group", { name: copy.reactions })).toBeTruthy();
    });
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.dataset.reaction !== undefined),
    ).toHaveLength(2);
  });

  it("picks a reaction with Enter and closes the picker", async () => {
    const { telo } = await renderPicker();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.react }));
    });
    const chip = await waitFor(() => {
      const found = screen
        .getAllByRole("button")
        .find((button) => button.dataset.reaction === "❤");
      if (!found) throw new Error("chip not rendered");
      return found;
    });

    await act(async () => {
      fireEvent.keyDown(chip, { key: "Enter" });
      fireEvent.click(chip);
    });

    expect(telo.workspace.setMessageReaction).toHaveBeenCalledWith({
      chatId: "a",
      messageId: "m1",
      emoji: "❤",
    });
    await waitFor(() => {
      expect(screen.queryByRole("group", { name: copy.reactions })).toBeNull();
    });
  });

  it("leaves an empty picker, not a spinner, when the chat allows none", async () => {
    const telo = installTeloApiMock();
    telo.workspace.listAvailableReactions.mockResolvedValue([]);
    const { useChatStore } = await import("../../../entities/chat");
    const subject = message();
    useChatStore.setState({
      chats: [],
      messages: [subject],
      activeChatId: "a",
      availableReactions: [],
      availableReactionsReady: false,
    });
    const { ReactionPicker } = await import("./reaction-picker");
    render(<ReactionPicker message={subject} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.react }));
    });

    await waitFor(() => {
      expect(screen.getByRole("group", { name: copy.reactions })).toBeTruthy();
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.dataset.reaction !== undefined),
    ).toHaveLength(0);
  });
});
