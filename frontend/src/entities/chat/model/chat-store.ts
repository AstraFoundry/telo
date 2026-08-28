import { create } from "zustand";

import type { ChatDto, MessageDto } from "../../../../../contracts/src/ipc";

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
  composerTarget: ComposerTarget | null;
  load(): Promise<void>;
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
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  messages: [],
  activeChatId: null,
  loading: true,
  composerTarget: null,
  async load() {
    const chats = await window.telo.workspace.listChats();
    const activeChatId = chats[0]?.id ?? null;
    const messages = activeChatId
      ? await window.telo.workspace.listMessages(activeChatId)
      : [];
    set({ chats, activeChatId, messages, loading: false });
  },
  async select(chatId) {
    if (chatId === get().activeChatId) return;
    // A pending reply/edit references a message of the previous chat; it must
    // not leak into the newly selected conversation.
    set({ activeChatId: chatId, loading: true, composerTarget: null });
    const messages = await window.telo.workspace.listMessages(chatId);
    set({ messages, loading: false });
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
      messages: [...state.messages, message],
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
    const chats = await window.telo.workspace.listChats();
    const messages =
      toChatId === chatId
        ? await window.telo.workspace.listMessages(chatId)
        : get().messages;
    set({ chats, messages });
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
}));

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
