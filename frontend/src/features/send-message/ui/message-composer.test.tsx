import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatMemberDto,
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
    sidebarWidth: 280,
    agentPanelWidth: 380,
    recentEmojis: [],
    messageTemplates: [],
    reduceMotion: false,
    loopStickers: true,
    notificationSenderName: true,
    notificationPreview: true,
    countMutedChats: false,
    mediaCacheLimitMb: 512,
    ...partial,
  } satisfies UserPreferencesDto;
}

function message(id: string, chatId: string): MessageDto {
  return {
    id,
    chatId,
    senderName: "Sender",
    senderId: "peer-sender",
    senderAvatarUrl: null,
    body: `Message ${id}`,
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-01-01T00:00:00.000Z",
    outgoing: false,
    status: "read",
  };
}

// The preferences slice is a module-level store that loads once per key, so
// each test imports a fresh module graph after resetting the registry; the
// chat store must come from the same graph as the component.
async function renderComposer(
  sendWithEnter: boolean,
  options: {
    readonly preferences?: Partial<UserPreferencesDto>;
    readonly activeChatId?: string;
    readonly members?: ReadonlyArray<ChatMemberDto>;
  } = {},
) {
  const telo = installTeloApiMock();
  const stored = preferences({ sendWithEnter, ...options.preferences });
  telo.preferences.get.mockResolvedValue(stored);
  telo.preferences.update.mockResolvedValue(stored);
  if (options.members) {
    telo.workspace.listChatMembers.mockResolvedValue(options.members);
  }
  const { useChatStore } = await import("../../../entities/chat");
  useChatStore.setState({
    chats: [],
    messages: [],
    activeChatId: options.activeChatId ?? null,
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
    // jsdom does not implement object URLs, which image previews rely on.
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    // jsdom has no ResizeObserver, which the beui popover positioning uses.
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
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

  function attachFiles(files: ReadonlyArray<File>): void {
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [...files] } });
  }

  it("lists picked files in the tray and removes a single one", async () => {
    await renderComposer(true);
    await flushPreferences();

    attachFiles([
      new File(["a"], "photo.png", { type: "image/png" }),
      new File(["b"], "notes.txt", { type: "text/plain" }),
    ]);

    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: `${copy.removeAttachment}: photo.png`,
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: `${copy.removeAttachment}: notes.txt`,
      }),
    );

    expect(screen.queryByText("notes.txt")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: `${copy.removeAttachment}: photo.png`,
      }),
    ).toBeTruthy();
  });

  it("rejects picking more than 10 attachments at once", async () => {
    await renderComposer(true);
    await flushPreferences();

    attachFiles(
      Array.from(
        { length: 11 },
        (_, index) =>
          new File(["x"], `file-${index}.txt`, { type: "text/plain" }),
      ),
    );

    expect(screen.getByRole("alert").textContent).toContain(
      copy.tooManyAttachments,
    );
    expect(
      screen.queryByRole("button", { name: /Remove attachment/ }),
    ).toBeNull();
  });

  it("sends attachments with the caption through the store and clears the tray", async () => {
    const { telo, useChatStore, textarea } = await renderComposer(true);
    const sent = {
      ...message("m9", "a"),
      outgoing: true,
      senderId: "",
      status: "sent" as const,
    };
    telo.workspace.sendMedia.mockResolvedValue([sent]);
    act(() => useChatStore.setState({ activeChatId: "a", messages: [] }));
    await flushPreferences();

    const files = [new File(["a"], "photo.png", { type: "image/png" })];
    attachFiles(files);
    fireEvent.change(textarea, { target: { value: "look" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() =>
      expect(telo.workspace.sendMedia).toHaveBeenCalledWith(
        "a",
        files,
        expect.objectContaining({
          caption: "look",
          uploadId: expect.any(String),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Remove attachment/ }),
      ).toBeNull(),
    );
    expect((textarea as HTMLTextAreaElement).value).toBe("");
    expect(useChatStore.getState().messages).toEqual([sent]);
  });

  it("keeps the files and caption after a failed upload for a one-click retry", async () => {
    const { telo, useChatStore, textarea } = await renderComposer(true);
    telo.workspace.sendMedia.mockRejectedValue(new Error("Upload failed"));
    act(() => useChatStore.setState({ activeChatId: "a", messages: [] }));
    await flushPreferences();

    const files = [new File(["a"], "photo.png", { type: "image/png" })];
    attachFiles(files);
    fireEvent.change(textarea, { target: { value: "look" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect((await screen.findByRole("alert")).textContent).toContain(
      `${copy.mediaUploadFailed} Upload failed`,
    );
    expect((textarea as HTMLTextAreaElement).value).toBe("look");
    expect(
      screen.getByRole("button", {
        name: `${copy.removeAttachment}: photo.png`,
      }),
    ).toBeTruthy();

    telo.workspace.sendMedia.mockResolvedValue([
      {
        ...message("m9", "a"),
        outgoing: true,
        senderId: "",
        status: "sent" as const,
      },
    ]);
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() =>
      expect(telo.workspace.sendMedia).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("cancelling an in-flight upload calls cancelMediaUpload without an error", async () => {
    const { telo, useChatStore, textarea } = await renderComposer(true);
    let resolveSend: ((messages: MessageDto[]) => void) | undefined;
    telo.workspace.sendMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    act(() => useChatStore.setState({ activeChatId: "a", messages: [] }));
    await flushPreferences();

    attachFiles([new File(["a"], "photo.png", { type: "image/png" })]);
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() =>
      expect(telo.workspace.sendMedia).toHaveBeenCalledTimes(1),
    );
    const uploadId = telo.workspace.sendMedia.mock.calls[0]?.[2].uploadId;
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));

    expect(telo.workspace.cancelMediaUpload).toHaveBeenCalledWith(uploadId);

    resolveSend?.([]);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Stop generating" }),
      ).toBeNull(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables the attach action while editing a message", async () => {
    const { useChatStore } = await renderComposer(true);
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });
    act(() => useChatStore.getState().startEdit(message("m1", "a")));
    await flushPreferences();

    expect(
      screen
        .getByRole("button", { name: copy.attachFiles })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("reflects draft text a message action streams into the store", async () => {
    const { useChatStore, textarea } = await renderComposer(true);
    act(() => useChatStore.setState({ activeChatId: "a", messages: [] }));
    await flushPreferences();

    // A message AI action streams into the draft through the store; the
    // textarea must follow without a keystroke.
    act(() =>
      useChatStore.setState({
        draftStream: { chatId: "a", text: "Demo translation: hi" },
      }),
    );

    expect((textarea as HTMLTextAreaElement).value).toBe(
      "Demo translation: hi",
    );
  });

  it("keeps the edited message text when an action stream lands", async () => {
    const { useChatStore, textarea } = await renderComposer(true);
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });
    act(() => useChatStore.getState().startEdit(message("m1", "a")));
    await flushPreferences();

    act(() =>
      useChatStore.setState({
        draftStream: { chatId: "a", text: "external" },
      }),
    );

    expect((textarea as HTMLTextAreaElement).value).toBe("Message m1");
  });

  function composerDropZone(): HTMLElement {
    const form = document.querySelector("form");
    if (!form?.parentElement) throw new Error("Composer form is not mounted");
    return form.parentElement;
  }

  function dropFiles(files: ReadonlyArray<File>): void {
    fireEvent.drop(composerDropZone(), {
      dataTransfer: { types: ["Files"], files: [...files] },
    });
  }

  it("lands dropped files in the tray through the same validation as the picker", async () => {
    await renderComposer(true);
    await flushPreferences();

    dropFiles([new File(["a"], "dropped.txt", { type: "text/plain" })]);

    expect(screen.getByText("dropped.txt")).toBeTruthy();

    dropFiles(
      Array.from(
        { length: 10 },
        (_, index) =>
          new File(["x"], `extra-${index}.txt`, { type: "text/plain" }),
      ),
    );

    expect(screen.getByRole("alert").textContent).toContain(
      copy.tooManyAttachments,
    );
    expect(screen.getByText("dropped.txt")).toBeTruthy();
    expect(screen.queryByText("extra-0.txt")).toBeNull();
  });

  it("highlights the drop zone only while a file drag is over it", async () => {
    await renderComposer(true);
    await flushPreferences();
    const form = document.querySelector("form") as HTMLFormElement;
    const dataTransfer = { types: ["Files"], files: [] };

    fireEvent.dragEnter(composerDropZone(), { dataTransfer });
    expect(form.className).toContain("border-primary/60");

    fireEvent.dragLeave(composerDropZone(), { dataTransfer });
    expect(form.className).not.toContain("border-primary/60");
  });

  it("ignores dropped files while editing a message", async () => {
    const { useChatStore } = await renderComposer(true);
    useChatStore.setState({
      activeChatId: "a",
      messages: [message("m1", "a")],
    });
    act(() => useChatStore.getState().startEdit(message("m1", "a")));
    await flushPreferences();

    dropFiles([new File(["a"], "dropped.txt", { type: "text/plain" })]);

    expect(screen.queryByText("dropped.txt")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Remove attachment/ }),
    ).toBeNull();
  });

  it("attaches pasted files, renaming clipboard screenshots deterministically", async () => {
    const { textarea } = await renderComposer(true);
    await flushPreferences();

    const screenshot = new File(["png"], "image.png", { type: "image/png" });
    const named = new File(["doc"], "report.pdf", { type: "application/pdf" });
    fireEvent.paste(textarea, {
      clipboardData: { files: [screenshot, named] },
    });

    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: new RegExp(`^${copy.removeAttachment}: screenshot-\\d+\\.png$`),
      }),
    ).toBeTruthy();
    // A pasted file must not replace the typed draft with a bogus text paste.
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("sends without sound from the send button's context menu", async () => {
    const { onSend, textarea } = await renderComposer(true);
    await flushPreferences();

    fireEvent.change(textarea, { target: { value: "Quiet hello" } });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Send prompt" }));
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.sendWithoutSound }),
    );

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("Quiet hello", { silent: true }),
    );
    await waitFor(() =>
      expect((textarea as HTMLTextAreaElement).value).toBe(""),
    );
  });

  it("forwards the silent flag to the workspace send through the store", async () => {
    const telo = installTeloApiMock();
    telo.preferences.get.mockResolvedValue(preferences());
    const { useChatStore } = await import("../../../entities/chat");
    useChatStore.setState({
      chats: [],
      messages: [],
      activeChatId: "a",
      loading: true,
      composerTarget: null,
    });
    const { MessageComposer } = await import("./message-composer");
    telo.workspace.sendMessage.mockResolvedValue({
      ...message("m9", "a"),
      outgoing: true,
      senderId: "",
      status: "sent" as const,
    });
    render(<MessageComposer onSend={useChatStore.getState().send} />);
    const textarea = screen.getByRole("textbox", {
      name: copy.messagePlaceholder,
    });
    await flushPreferences();

    fireEvent.change(textarea, { target: { value: "Quiet hello" } });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Send prompt" }));
    const menu = await screen.findByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: copy.sendWithoutSound }),
    );

    await waitFor(() =>
      expect(telo.workspace.sendMessage).toHaveBeenCalledWith(
        "a",
        "Quiet hello",
        expect.objectContaining({ silent: true }),
      ),
    );
  });

  it("disables the silent send item while attachments are staged", async () => {
    await renderComposer(true);
    await flushPreferences();

    attachFiles([new File(["a"], "photo.png", { type: "image/png" })]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Send prompt" }));
    const menu = await screen.findByRole("menu");

    expect(
      within(menu)
        .getByRole("menuitem", { name: copy.sendWithoutSound })
        .getAttribute("data-disabled"),
    ).toBe("true");
  });

  it("inserts a picked emoji at the caret and records it as recent", async () => {
    const { telo, useChatStore, textarea } = await renderComposer(true);
    act(() => useChatStore.setState({ activeChatId: "a", messages: [] }));
    await flushPreferences();

    fireEvent.change(textarea, { target: { value: "hi " } });
    fireEvent.click(screen.getByRole("button", { name: copy.mediaPicker }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "grinning face happy smile",
      }),
    );

    expect((textarea as HTMLTextAreaElement).value).toBe("hi 😀");
    expect((textarea as HTMLTextAreaElement).selectionStart).toBe(5);
    expect(useChatStore.getState().drafts.a).toBe("hi 😀");
    expect(telo.preferences.update).toHaveBeenCalledWith({
      recentEmojis: ["😀"],
    });
  });

  it("shows frequently used emojis and keeps the most recent first", async () => {
    // Recents load once when the preference store subscribes, so the mock
    // must be in place before the composer renders.
    const telo = installTeloApiMock();
    telo.preferences.get.mockResolvedValue(
      preferences({ recentEmojis: ["🚀", "😀"] }),
    );
    telo.preferences.update.mockResolvedValue(
      preferences({ recentEmojis: ["🚀", "😀"] }),
    );
    const { useChatStore } = await import("../../../entities/chat");
    useChatStore.setState({
      chats: [],
      messages: [],
      activeChatId: null,
      loading: true,
      composerTarget: null,
    });
    const { MessageComposer } = await import("./message-composer");
    render(<MessageComposer onSend={vi.fn().mockResolvedValue(undefined)} />);
    const textarea = screen.getByRole("textbox", {
      name: copy.messagePlaceholder,
    });
    await flushPreferences();

    fireEvent.click(screen.getByRole("button", { name: copy.mediaPicker }));
    expect(await screen.findByText(copy.emojiRecent)).toBeTruthy();

    // Picking an already-recent emoji moves it to the front instead of
    // duplicating it. The glyph shows in both the recents row and the
    // smileys grid; click the recents one (first in the dialog).
    fireEvent.click(
      screen.getAllByRole("button", { name: "grinning face happy smile" })[0],
    );
    expect(telo.preferences.update).toHaveBeenCalledWith({
      recentEmojis: ["😀", "🚀"],
    });
    expect((textarea as HTMLTextAreaElement).value).toBe("😀");
  });

  it("filters the picker through the search field", async () => {
    await renderComposer(true);
    await flushPreferences();

    fireEvent.click(screen.getByRole("button", { name: copy.mediaPicker }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: copy.searchEmoji }),
      { target: { value: "rocket" } },
    );

    expect(
      await screen.findByRole("button", {
        name: "rocket launch space ship",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "grinning face happy smile" }),
    ).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: copy.searchEmoji }), {
      target: { value: "no such emoji exists" },
    });
    expect(await screen.findByText(copy.noEmojiFound)).toBeTruthy();
  });
  it("keeps no formatting toolbar above the field", async () => {
    await renderComposer(true);
    await flushPreferences();

    // Telegram's own composer has no persistent formatting strip; formatting
    // lives on the shortcuts and the right-click menu instead.
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryByRole("button", { name: copy.formatBold })).toBeNull();
  });

  it("sends the draft with the formatting entities a shortcut authored", async () => {
    const { onSend, textarea } = await renderComposer(true);
    await flushPreferences();

    const field = textarea as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Hello team" } });
    field.setSelectionRange(0, 5);
    fireEvent.select(field);

    fireEvent.keyDown(field, { key: "b", ctrlKey: true });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("Hello team", {
      entities: [{ type: "bold", offset: 0, length: 5 }],
    });
  });

  it("formats the selection from the right-click menu", async () => {
    const { onSend, textarea } = await renderComposer(true);
    await flushPreferences();

    const field = textarea as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Hello team" } });
    field.setSelectionRange(0, 5);
    fireEvent.select(field);
    fireEvent.contextMenu(field);

    const item = await screen.findByRole("menuitemcheckbox", {
      name: new RegExp(copy.formatBold),
    });
    // The menu reports what already covers the selection, so the same item
    // toggles the format back off.
    expect(item.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(item);

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("Hello team", {
      entities: [{ type: "bold", offset: 0, length: 5 }],
    });
  });

  it("disables the selection actions in the menu with nothing selected", async () => {
    const { textarea } = await renderComposer(true);
    await flushPreferences();

    const field = textarea as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Hello team" } });
    field.setSelectionRange(3, 3);
    fireEvent.select(field);
    fireEvent.contextMenu(field);

    const copyItem = await screen.findByRole("menuitem", {
      name: copy.composerCopy,
    });
    expect((copyItem as HTMLButtonElement).disabled).toBe(true);
    // Paste needs no selection, so it stays available.
    const pasteItem = screen.getByRole("menuitem", {
      name: copy.composerPaste,
    });
    expect((pasteItem as HTMLButtonElement).disabled).toBe(false);
  });

  it("replaces the @ query with the picked mention and closes the listbox", async () => {
    const { textarea } = await renderComposer(true, {
      activeChatId: "design",
      members: [
        {
          id: "m1",
          displayName: "Mina",
          username: "mina",
          avatarDataUrl: null,
        },
        {
          id: "m2",
          displayName: "Aron",
          username: "aron",
          avatarDataUrl: null,
        },
      ],
    });
    await flushPreferences();

    const field = textarea as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "hi @mi" } });
    field.setSelectionRange(6, 6);
    fireEvent.keyUp(field);

    const option = await screen.findByRole("option", { name: "Mina, @mina" });
    fireEvent.click(option);

    await waitFor(() => expect(field.value).toBe("hi @mina "));
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("names the highlighted mention so a screen reader follows the query", async () => {
    const { textarea } = await renderComposer(true, {
      activeChatId: "design",
      members: [
        {
          id: "m1",
          displayName: "Mina",
          username: "mina",
          avatarDataUrl: null,
        },
        {
          id: "m2",
          displayName: "Aron",
          username: "aron",
          avatarDataUrl: null,
        },
      ],
    });
    await flushPreferences();

    const field = textarea as HTMLTextAreaElement;
    expect(field.getAttribute("aria-activedescendant")).toBeNull();

    fireEvent.change(field, { target: { value: "hi @" } });
    field.setSelectionRange(4, 4);
    fireEvent.keyUp(field);

    const first = await screen.findByRole("option", { name: "Mina, @mina" });
    expect(first.id).not.toBe("");
    expect(field.getAttribute("aria-activedescendant")).toBe(first.id);
    expect(field.getAttribute("aria-controls")).toBe(first.closest("ul")!.id);

    fireEvent.keyDown(field, { key: "ArrowDown" });

    const second = screen.getByRole("option", { name: "Aron, @aron" });
    await waitFor(() =>
      expect(field.getAttribute("aria-activedescendant")).toBe(second.id),
    );
  });

  it("completes the highlighted mention on Enter instead of sending the draft", async () => {
    const { textarea, onSend } = await renderComposer(true, {
      activeChatId: "design",
      members: [
        {
          id: "m1",
          displayName: "Mina",
          username: "mina",
          avatarDataUrl: null,
        },
        {
          id: "m2",
          displayName: "Aron",
          username: "aron",
          avatarDataUrl: null,
        },
      ],
    });
    await flushPreferences();

    const field = textarea as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "hi @" } });
    field.setSelectionRange(4, 4);
    fireEvent.keyUp(field);
    await screen.findByRole("option", { name: "Mina, @mina" });

    // Move onto the second suggestion, then narrow the query so only the
    // first survives, which also resets the highlight back to it.
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.change(field, { target: { value: "hi @mi" } });
    field.setSelectionRange(6, 6);
    fireEvent.keyUp(field);

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));

    // Enter must complete the mention that is actually highlighted rather
    // than falling through to sending the draft.
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(field.value).toBe("hi @mina "));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("inserts a saved template at the caret", async () => {
    const { textarea } = await renderComposer(true, {
      preferences: {
        messageTemplates: [
          { id: "t1", title: "Standup", body: "Standup notes:" },
        ],
      },
    });
    await flushPreferences();

    fireEvent.click(
      screen.getByRole("button", { name: copy.messageTemplates }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Standup, Standup notes:" }),
    );

    await waitFor(() =>
      expect((textarea as HTMLTextAreaElement).value).toBe("Standup notes:"),
    );
  });
});
