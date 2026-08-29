import { create } from "zustand";

import type {
  ChatDto,
  ChatPageCursorDto,
  MessageDto,
  TelegramWorkspaceEvent,
} from "../../../../../contracts/src/ipc";

let selectionRequest = 0;

export interface ComposerTarget {
  readonly mode: "reply" | "edit";
  readonly messageId: string;
  readonly preview: string;
}

interface ChatState {
  chats: ReadonlyArray<ChatDto>;
  messages: ReadonlyArray<MessageDto>;
  activeChatId: string | null;
  loading: boolean;
  loadingMoreChats: boolean;
  loadingOlderMessages: boolean;
  chatCursor: ChatPageCursorDto | null;
  messageCursor: string | null;
  syncError: string | null;
  connectionState: "offline" | "synchronizing" | "connected";
  composerTarget: ComposerTarget | null;
  load(): Promise<void>;
  loadMoreChats(): Promise<void>;
  loadOlderMessages(): Promise<void>;
  select(chatId: string): Promise<void>;
  send(body: string): Promise<void>;
  startReply(message: MessageDto): void;
  startEdit(message: MessageDto): void;
  cancelComposerTarget(): void;
  deleteMessage(messageId: string): Promise<void>;
  forwardMessage(messageId: string, toChatId: string): Promise<void>;
  togglePin(chatId: string): Promise<void>;
  toggleMute(chatId: string): Promise<void>;
  toggleRead(chatId: string): Promise<void>;
  receive(event: TelegramWorkspaceEvent): void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  messages: [],
  activeChatId: null,
  loading: true,
  loadingMoreChats: false,
  loadingOlderMessages: false,
  chatCursor: null,
  messageCursor: null,
  syncError: null,
  connectionState: "connected",
  composerTarget: null,
  async load() {
    const request = ++selectionRequest;
    try {
      const chatPage = await window.telo.workspace.listChatPage();
      const chats = chatPage.items;
      const activeChatId = chats[0]?.id ?? null;
      const messagePage = activeChatId
        ? await window.telo.workspace.listMessagePage(activeChatId)
        : { items: [], nextCursor: null };
      if (request === selectionRequest) {
        set({
          chats,
          activeChatId,
          messages: messagePage.items,
          chatCursor: chatPage.nextCursor,
          messageCursor: messagePage.nextCursor,
          loading: false,
          loadingMoreChats: false,
          loadingOlderMessages: false,
          syncError: null,
        });
      }
    } catch (error) {
      if (request === selectionRequest) {
        set({ loading: false, syncError: errorMessage(error) });
      }
    }
  },
  async loadMoreChats() {
    const { chatCursor, loadingMoreChats } = get();
    if (!chatCursor || loadingMoreChats) return;
    set({ loadingMoreChats: true });
    try {
      const page = await window.telo.workspace.listChatPage({
        cursor: chatCursor,
      });
      set((state) => ({
        chats: mergeChats(state.chats, page.items),
        chatCursor: page.nextCursor,
        loadingMoreChats: false,
        syncError: null,
      }));
    } catch (error) {
      set({ syncError: errorMessage(error), loadingMoreChats: false });
    }
  },
  async select(chatId) {
    if (chatId === get().activeChatId) return;
    const request = ++selectionRequest;
    // A pending reply/edit references a message of the previous chat; it must
    // not leak into the newly selected conversation.
    set({
      activeChatId: chatId,
      messages: [],
      loading: true,
      messageCursor: null,
      loadingOlderMessages: false,
      composerTarget: null,
    });
    try {
      const page = await window.telo.workspace.listMessagePage(chatId);
      if (request === selectionRequest && get().activeChatId === chatId) {
        set({
          messages: page.items,
          messageCursor: page.nextCursor,
          loading: false,
          syncError: null,
        });
      }
    } catch (error) {
      if (request === selectionRequest && get().activeChatId === chatId) {
        set({ loading: false, syncError: errorMessage(error) });
      }
    }
  },
  async loadOlderMessages() {
    const { activeChatId, messageCursor, loadingOlderMessages } = get();
    if (!activeChatId || !messageCursor || loadingOlderMessages) return;
    const chatId = activeChatId;
    const cursor = messageCursor;
    set({ loadingOlderMessages: true });
    try {
      const page = await window.telo.workspace.listMessagePage(chatId, {
        beforeMessageId: cursor,
      });
      if (get().activeChatId !== chatId) return;
      // One commit: the prepended page and the loading flag flip together, so
      // the transcript's scroll compensation and the spinner exit happen in a
      // single render.
      set((state) => ({
        messages: mergeMessages(page.items, state.messages),
        messageCursor: page.nextCursor,
        loadingOlderMessages: false,
        syncError: null,
      }));
    } catch (error) {
      if (get().activeChatId === chatId) {
        set({ syncError: errorMessage(error), loadingOlderMessages: false });
      }
    }
  },
  async send(body) {
    const chatId = get().activeChatId;
    if (!chatId) return;
    const target = get().composerTarget;
    if (target?.mode === "edit") {
      await window.telo.workspace.editMessage({
        chatId,
        messageId: target.messageId,
        body,
      });
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === target.messageId
            ? { ...message, body, editedAt: new Date().toISOString() }
            : message,
        ),
        composerTarget: null,
      }));
      return;
    }
    const message =
      target?.mode === "reply"
        ? await window.telo.workspace.sendMessage(chatId, body, {
            replyToId: target.messageId,
          })
        : await window.telo.workspace.sendMessage(chatId, body);
    set((state) => ({
      messages: upsertMessage(state.messages, message),
      composerTarget: null,
    }));
  },
  startReply(message) {
    set({
      composerTarget: {
        mode: "reply",
        messageId: message.id,
        preview: message.body,
      },
    });
  },
  startEdit(message) {
    set({
      composerTarget: {
        mode: "edit",
        messageId: message.id,
        preview: message.body,
      },
    });
  },
  cancelComposerTarget() {
    set({ composerTarget: null });
  },
  async deleteMessage(messageId) {
    const chatId = get().activeChatId;
    if (!chatId) return;
    await window.telo.workspace.deleteMessage({ chatId, messageId });
    set((state) => {
      const messages = state.messages.filter(
        (message) => message.id !== messageId,
      );
      // The chat list preview mirrors the last message, so deleting it
      // requires a local preview patch to the new tail.
      const removedLast =
        state.messages[state.messages.length - 1]?.id === messageId;
      return {
        messages,
        ...(removedLast
          ? patchChat(state.chats, chatId, {
              preview: messages[messages.length - 1]?.body ?? "",
            })
          : {}),
        composerTarget:
          state.composerTarget?.messageId === messageId
            ? null
            : state.composerTarget,
      };
    });
  },
  async forwardMessage(messageId, toChatId) {
    const chatId = get().activeChatId;
    if (!chatId) return;
    await window.telo.workspace.forwardMessage({
      fromChatId: chatId,
      messageId,
      toChatId,
    });
    // Previews and unread counts shift in both chats; the backend owns those
    // rules, so the list is reloaded instead of patched.
    const chatPage = await window.telo.workspace.listChatPage();
    const messagePage =
      toChatId === chatId
        ? await window.telo.workspace.listMessagePage(chatId)
        : null;
    set({
      chats: chatPage.items,
      chatCursor: chatPage.nextCursor,
      messages: messagePage?.items ?? get().messages,
      messageCursor: messagePage?.nextCursor ?? get().messageCursor,
    });
  },
  async togglePin(chatId) {
    const chat = get().chats.find((entry) => entry.id === chatId);
    if (!chat) return;
    const pinned = !chat.pinned;
    await window.telo.workspace.setChatPinned(chatId, pinned);
    set((state) => patchChat(state.chats, chatId, { pinned }));
  },
  async toggleMute(chatId) {
    const chat = get().chats.find((entry) => entry.id === chatId);
    if (!chat) return;
    const muted = !chat.muted;
    await window.telo.workspace.setChatMuted(chatId, muted);
    set((state) => patchChat(state.chats, chatId, { muted }));
  },
  async toggleRead(chatId) {
    const chat = get().chats.find((entry) => entry.id === chatId);
    if (!chat) return;
    const read = chat.unreadCount > 0;
    await window.telo.workspace.setChatRead(chatId, read);
    set((state) =>
      patchChat(state.chats, chatId, { unreadCount: read ? 0 : 1 }),
    );
  },
  receive(event) {
    if (event.type === "connection-state") {
      set({ connectionState: event.state });
      return;
    }
    if (event.type === "sync-error") {
      set({ syncError: event.message });
      return;
    }
    if (event.type === "chat-upsert") {
      set((state) => ({ chats: upsertChat(state.chats, event.chat) }));
      return;
    }
    if (event.type === "message-upsert") {
      set((state) => {
        const isActive = state.activeChatId === event.message.chatId;
        const existing = state.messages.some(
          (message) => message.id === event.message.id,
        );
        const incomingNew =
          event.cause === "new" && !event.message.outgoing && !existing;
        return {
          messages: isActive
            ? upsertMessage(state.messages, event.message)
            : state.messages,
          chats: state.chats.map((chat) =>
            chat.id === event.message.chatId
              ? {
                  ...chat,
                  preview: event.message.body,
                  updatedAt: event.message.sentAt,
                  unreadCount:
                    incomingNew && !isActive
                      ? chat.unreadCount + 1
                      : chat.unreadCount,
                }
              : chat,
          ),
          syncError: null,
        };
      });
      return;
    }
    if (event.type === "message-delete") {
      set((state) => {
        if (state.activeChatId !== event.chatId) return state;
        const deleted = new Set(event.messageIds);
        const messages = state.messages.filter(
          (message) => !deleted.has(message.id),
        );
        return {
          messages,
          chats: state.chats.map((chat) =>
            chat.id === event.chatId
              ? { ...chat, preview: messages.at(-1)?.body ?? "" }
              : chat,
          ),
          composerTarget:
            state.composerTarget && deleted.has(state.composerTarget.messageId)
              ? null
              : state.composerTarget,
        };
      });
      return;
    }
    set((state) => ({
      chats:
        event.direction === "inbox"
          ? state.chats.map((chat) =>
              chat.id === event.chatId ? { ...chat, unreadCount: 0 } : chat,
            )
          : state.chats,
      messages:
        event.direction === "outbox" && state.activeChatId === event.chatId
          ? state.messages.map((message) =>
              message.outgoing &&
              compareTelegramIds(message.id, event.maxMessageId) <= 0
                ? { ...message, status: "read" as const }
                : message,
            )
          : state.messages,
    }));
  },
}));

export function subscribeToWorkspaceEvents(): () => void {
  return window.telo.workspace.onEvent((event) =>
    useChatStore.getState().receive(event),
  );
}

function patchChat(
  chats: ReadonlyArray<ChatDto>,
  chatId: string,
  patch: Partial<ChatDto>,
): Pick<ChatState, "chats"> {
  return {
    chats: chats.map((chat) =>
      chat.id === chatId ? { ...chat, ...patch } : chat,
    ),
  };
}

function upsertChat(
  chats: ReadonlyArray<ChatDto>,
  updated: ChatDto,
): ReadonlyArray<ChatDto> {
  const index = chats.findIndex((chat) => chat.id === updated.id);
  if (index === -1) return [...chats, updated];
  return chats.map((chat) => (chat.id === updated.id ? updated : chat));
}

function mergeChats(
  current: ReadonlyArray<ChatDto>,
  incoming: ReadonlyArray<ChatDto>,
): ReadonlyArray<ChatDto> {
  return incoming.reduce(upsertChat, current);
}

function upsertMessage(
  messages: ReadonlyArray<MessageDto>,
  updated: MessageDto,
): ReadonlyArray<MessageDto> {
  const existing = messages.some((message) => message.id === updated.id);
  const next = existing
    ? messages.map((message) => (message.id === updated.id ? updated : message))
    : [...messages, updated];
  return [...next].sort((left, right) =>
    left.sentAt.localeCompare(right.sentAt),
  );
}

function mergeMessages(
  current: ReadonlyArray<MessageDto>,
  incoming: ReadonlyArray<MessageDto>,
): ReadonlyArray<MessageDto> {
  return incoming.reduce(upsertMessage, current);
}

function compareTelegramIds(left: string, right: string): number {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
