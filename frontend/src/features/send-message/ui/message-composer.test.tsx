import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MessageDto,
  UserPreferencesDto,
} from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

function stubMatchMedia(dark: boolean): void {
  // jsdom does not implement matchMedia, which the preferences slice applies
  // at module scope.
  window.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function preferences(partial: Partial<UserPreferencesDto> = {}) {
  return {
    agentPanelOpen: false,
    demoWorkspace: false,
    theme: "system",
    accentColor: "blue",
    messageTextSize: 14,
    timeFormat: "system",
    sendWithEnter: true,
    notificationsEnabled: true,
    ...partial,
  } satisfies UserPreferencesDto;
}

function message(id: string, chatId: string): MessageDto {
  return {
    id,
    chatId,
    senderName: "Sender",
    body: `Message ${id}`,
    sentAt: "2026-01-01T00:00:00.000Z",
    outgoing: false,
    status: "read",
  };
}

// The preferences slice is a module-level store that loads once per key, so
// each test imports a fresh module graph after resetting the registry; the
// chat store must come from the same graph as the component.
async function renderComposer(sendWithEnter: boolean) {
  const telo = installTeloApiMock();
  telo.preferences.get.mockResolvedValue(preferences({ sendWithEnter }));
  const { useChatStore } = await import("../../../entities/chat");
  useChatStore.setState({
    chats: [],
    messages: [],
    activeChatId: null,
    loading: true,
    composerTarget: null,
  });
  const { MessageComposer } = await import("./message-composer");
  const onSend = vi.fn().mockResolvedValue(undefined);
  render(<MessageComposer onSend={onSend} />);
  const textarea = screen.getByRole("textbox", {
    name: copy.messagePlaceholder,
  });
  return { telo, useChatStore, onSend, textarea };
}

async function flushPreferences(): Promise<void> {
  await act(async () => {});
}

describe("MessageComposer", () => {
  beforeEach(() => {
    vi.resetModules();
    stubMatchMedia(false);
  });

  it("submits on Enter when sendWithEnter is on", async () => {
    const { onSend, textarea } = await renderComposer(true);
    await flushPreferences();

    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("Hello");
    await waitFor(() =>
      expect((textarea as HTMLTextAreaElement).value).toBe(""),
    );
  });

  it("inserts a newline on Enter when sendWithEnter is off", async () => {
    const { onSend, textarea } = await renderComposer(false);
    await flushPreferences();

    fireEvent.change(textarea, { target: { value: "Hello" } });
    (textarea as HTMLTextAreaElement).setSelectionRange(5, 5);
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe("Hello\n");
    expect((textarea as HTMLTextAreaElement).selectionStart).toBe(6);
  });

  it("submits on Cmd+Enter when sendWithEnter is off", async () => {
    const { onSend, textarea } = await renderComposer(false);
    await flushPreferences();

    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    expect(onSend).toHaveBeenCalledWith("Hello");
  });

  it("submits on Ctrl+Enter when sendWithEnter is off", async () => {
    const { onSend, textarea } = await renderComposer(false);
    await flushPreferences();

    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(onSend).toHaveBeenCalledWith("Hello");
  });

  it("keeps the draft and exposes the error when sending fails", async () => {
    const { onSend, textarea } = await renderComposer(true);
    onSend.mockRejectedValue(new Error("Network unavailable"));
    await flushPreferences();

    fireEvent.change(textarea, { target: { value: "Retry me" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect((await screen.findByRole("alert")).textContent).toContain(
      `${copy.messageSendFailed} Network unavailable`,
    );
    expect((textarea as HTMLTextAreaElement).value).toBe("Retry me");
  });

  it("restores a chat's draft when switching to it and persists edits through the store", async () => {
    const { useChatStore, textarea } = await renderComposer(true);
    act(() =>
      useChatStore.setState({ activeChatId: "a", drafts: { a: "left off" } }),
    );

    expect((textarea as HTMLTextAreaElement).value).toBe("left off");

    fireEvent.change(textarea, { target: { value: "left off here" } });

    expect(useChatStore.getState().drafts.a).toBe("left off here");

    act(() => useChatStore.setState({ activeChatId: "b" }));

    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("shows a reply preview bar with the sender and body, and cancels it", async () => {
    const { useChatStore } = await renderComposer(true);
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });
    act(() => useChatStore.getState().startReply(message("m1", "a")));

    expect(screen.getByText(`${copy.replyingTo} Sender`)).toBeTruthy();
    expect(screen.getByText("Message m1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: copy.cancel }));

    expect(useChatStore.getState().composerTarget).toBeNull();
    expect(screen.queryByText(`${copy.replyingTo} Sender`)).toBeNull();
  });

  it("prefills the input in edit mode and clears it on cancel", async () => {
    const { useChatStore, textarea } = await renderComposer(true);
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });
    act(() => useChatStore.getState().startEdit(message("m1", "a")));

    expect(screen.getByText(copy.editingMessage)).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe("Message m1");

    fireEvent.click(screen.getByRole("button", { name: copy.cancel }));

    expect(useChatStore.getState().composerTarget).toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("submitting in edit mode edits through the store and clears the bar", async () => {
    // The composer's onSend is the store's send action here, so editing
    // routes through the store like it does in the conversation view.
    const telo = installTeloApiMock();
    telo.preferences.get.mockResolvedValue(preferences());
    const { useChatStore } = await import("../../../entities/chat");
    useChatStore.setState({
      chats: [],
      messages: [],
      activeChatId: null,
      loading: true,
      composerTarget: null,
    });
    const { MessageComposer } = await import("./message-composer");
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });
    useChatStore.getState().startEdit(message("m1", "a"));
    render(<MessageComposer onSend={useChatStore.getState().send} />);
    const textarea = screen.getByRole("textbox", {
      name: copy.messagePlaceholder,
    });
    await flushPreferences();

    fireEvent.change(textarea, { target: { value: "Rewritten" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await flushPreferences();

    expect(telo.workspace.editMessage).toHaveBeenCalledWith({
      chatId: "a",
      messageId: "m1",
      body: "Rewritten",
    });
    expect(useChatStore.getState().composerTarget).toBeNull();
    expect(screen.queryByText(copy.editingMessage)).toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });
});
