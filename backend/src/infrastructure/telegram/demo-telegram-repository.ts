import type {
  ChatDto,
  ChatPageDto,
  ChatPageInput,
  CurrentUserDto,
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
  MessageDto,
  MessagePageDto,
  MessagePageInput,
  MessageReplyToDto,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";

const INITIAL_CHATS: ReadonlyArray<ChatDto> = [
  {
    id: "saved",
    title: "Saved Messages",
    preview: "Release checklist",
    updatedAt: "2026-08-27T15:42:00.000Z",
    unreadCount: 0,
    muted: false,
    pinned: true,
    kind: "saved",
    initials: "SM",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
  },
  {
    id: "design",
    title: "Telo Design",
    preview: "Keep the composer anchored.",
    updatedAt: "2026-08-27T14:18:00.000Z",
    unreadCount: 3,
    muted: false,
    pinned: true,
    kind: "group",
    initials: "TD",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
  },
  {
    id: "product",
    title: "Product Notes",
    preview: "Agent context is ready for review.",
    updatedAt: "2026-08-26T10:24:00.000Z",
    unreadCount: 0,
    muted: true,
    pinned: false,
    kind: "channel",
    initials: "PN",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
  },
];

// Demo auto-reply copy, keyed by chat id; falls back to a generic reply for
// any chat added later (e.g. by forwardMessage into a new target).
const DEMO_AUTO_REPLIES: Record<string, string> = {
  design: "Looks good — shipping it.",
  product: "Noted, added to the review doc.",
};

const INITIAL_MESSAGES: Record<string, ReadonlyArray<MessageDto>> = {
  saved: [
    {
      id: "saved-1",
      chatId: "saved",
      senderName: "You",
      body: "Release checklist: tests, docs, signed packages.",
      sentAt: "2026-08-27T15:42:00.000Z",
      outgoing: true,
      status: "read",
    },
  ],
  design: [
    {
      id: "design-1",
      chatId: "design",
      senderName: "Mina",
      body: "The conversation list should stay compact at desktop widths.",
      sentAt: "2026-08-27T14:12:00.000Z",
      outgoing: false,
      status: "read",
    },
    {
      id: "design-2",
      chatId: "design",
      senderName: "You",
      body: "Agreed. Keep the composer anchored and let only the message list scroll.",
      sentAt: "2026-08-27T14:18:00.000Z",
      outgoing: true,
      status: "read",
    },
  ],
  product: [
    {
      id: "product-1",
      chatId: "product",
      senderName: "Telo",
      body: "Agent context is ready for review.",
      sentAt: "2026-08-26T10:24:00.000Z",
      outgoing: false,
      status: "read",
    },
  ],
};

export interface DemoTelegramRepositoryOptions {
  /** Delay before the simulated contact starts typing a reply. */
  readonly typingDelayMs?: number;
  /** Delay (from send) before the simulated contact's reply lands. */
  readonly autoReplyDelayMs?: number;
}

export class DemoTelegramRepository implements TelegramRepository {
  private readonly listeners = new Set<
    (event: TelegramWorkspaceEvent) => void
  >();
  private readonly chats = new Map(
    INITIAL_CHATS.map((chat) => [chat.id, { ...chat }]),
  );
  private readonly messages = new Map(
    Object.entries(INITIAL_MESSAGES).map(([chatId, messages]) => [
      chatId,
      [...messages],
    ]),
  );
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly typingDelayMs: number;
  private readonly autoReplyDelayMs: number;

  constructor(options: DemoTelegramRepositoryOptions = {}) {
    this.typingDelayMs = options.typingDelayMs ?? 500;
    this.autoReplyDelayMs = options.autoReplyDelayMs ?? 1400;
  }

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getCurrentUser(): Promise<CurrentUserDto> {
    return {
      id: "demo-user",
      displayName: "Demo User",
      username: null,
      initials: "DU",
      avatarDataUrl: null,
    };
  }

  async listChatPage(input: ChatPageInput): Promise<ChatPageDto> {
    const chats = [...this.chats.values()];
    const start = input.cursor
      ? chats.findIndex((chat) => chat.id === input.cursor?.chatId) + 1
      : 0;
    if (input.cursor && start === 0) {
      throw new Error(`Unknown chat cursor ${input.cursor.chatId}`);
    }
    const limit = input.limit ?? chats.length;
    const items = chats.slice(start, start + limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        start + items.length < chats.length && last
          ? {
              chatId: last.id,
              topMessageId: this.messages.get(last.id)?.at(-1)?.id ?? "0",
              updatedAt: last.updatedAt,
            }
          : null,
    };
  }

  async listMessagePage(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    this.requireChat(chatId);
    const messages = this.messages.get(chatId) ?? [];
    const end = input.beforeMessageId
      ? messages.findIndex((message) => message.id === input.beforeMessageId)
      : messages.length;
    if (input.beforeMessageId && end === -1) {
      throw new Error(`Unknown message cursor ${input.beforeMessageId}`);
    }
    const limit = input.limit ?? messages.length;
    const start = Math.max(0, end - limit);
    const items = messages.slice(start, end);
    return {
      items,
      nextCursor: start > 0 ? (items[0]?.id ?? null) : null,
    };
  }

  async sendMessage(
    chatId: string,
    body: string,
    replyToId?: string,
    clientId?: string,
  ): Promise<MessageDto> {
    this.requireChat(chatId);
    const message: MessageDto = {
      id: crypto.randomUUID(),
      chatId,
      senderName: "You",
      body,
      sentAt: new Date().toISOString(),
      outgoing: true,
      status: "sent",
      replyTo: replyToId ? this.replySnapshot(chatId, replyToId) : null,
      clientId: clientId ?? null,
    };
    const current = this.messages.get(chatId) ?? [];
    this.messages.set(chatId, [...current, message]);
    this.updateChat(chatId, (chat) => ({
      ...chat,
      preview: message.body,
      updatedAt: message.sentAt,
      draftPreview: null,
    }));
    this.emit({ type: "message-upsert", cause: "new", message });
    this.scheduleAutoReply(chatId);
    return message;
  }

  async setTyping(chatId: string, typing: boolean): Promise<void> {
    // The local user's own typing signal has no counterpart to notify in the
    // demo workspace; teleproto sends it out over the wire in production.
    void typing;
    this.requireChat(chatId);
  }

  async saveDraft(chatId: string, text: string): Promise<void> {
    this.requireChat(chatId);
    const draftPreview = text.trim() ? text : null;
    this.updateChatSilently(chatId, (chat) => ({ ...chat, draftPreview }));
    this.emit({ type: "draft", chatId, draftPreview });
  }

  /**
   * Demo-only realism: after the user sends a message, the recipient "types"
   * and then replies, so Wave 1's typing indicator and message sync have
   * something to show in jsdom/E2E without a live Telegram account.
   */
  private scheduleAutoReply(chatId: string): void {
    const reply = DEMO_AUTO_REPLIES[chatId];
    if (!reply) return; // Saved Messages and unknown chats have no counterpart.
    const typingTimer = setTimeout(() => {
      this.timers.delete(typingTimer);
      this.emit({ type: "typing", chatId, typing: true });
    }, this.typingDelayMs);
    this.timers.add(typingTimer);

    const replyTimer = setTimeout(() => {
      this.timers.delete(replyTimer);
      this.emit({ type: "typing", chatId, typing: false });
      const chat = this.chats.get(chatId);
      if (!chat) return;
      const message: MessageDto = {
        id: crypto.randomUUID(),
        chatId,
        senderName: chat.title,
        body: reply,
        sentAt: new Date().toISOString(),
        outgoing: false,
        status: "read",
      };
      const current = this.messages.get(chatId) ?? [];
      this.messages.set(chatId, [...current, message]);
      this.updateChat(chatId, (entry) => ({
        ...entry,
        preview: message.body,
        updatedAt: message.sentAt,
      }));
      this.emit({ type: "message-upsert", cause: "new", message });
    }, this.autoReplyDelayMs);
    this.timers.add(replyTimer);
  }

  async editMessage(input: EditMessageInput): Promise<void> {
    const { message, messages } = this.findMessage(
      input.chatId,
      input.messageId,
    );
    // Telegram rule: only one's own messages can be edited.
    if (!message.outgoing)
      throw new Error(`Message ${input.messageId} is not outgoing`);
    const edited: MessageDto = {
      ...message,
      body: input.body,
      editedAt: new Date().toISOString(),
    };
    this.messages.set(
      input.chatId,
      messages.map((entry) => (entry.id === edited.id ? edited : entry)),
    );
    this.emit({ type: "message-upsert", cause: "edited", message: edited });
  }

  async deleteMessage(input: DeleteMessageInput): Promise<void> {
    const { messages } = this.findMessage(input.chatId, input.messageId);
    this.messages.set(
      input.chatId,
      messages.filter((entry) => entry.id !== input.messageId),
    );
    this.emit({
      type: "message-delete",
      chatId: input.chatId,
      messageIds: [input.messageId],
    });
  }

  async forwardMessage(input: ForwardMessageInput): Promise<void> {
    const { message: source } = this.findMessage(
      input.fromChatId,
      input.messageId,
    );
    this.requireChat(input.toChatId);
    const forwarded: MessageDto = {
      id: crypto.randomUUID(),
      chatId: input.toChatId,
      senderName: "You",
      body: source.body,
      sentAt: new Date().toISOString(),
      outgoing: true,
      status: "sent",
      // A forwarded copy is not a reply; it never carries the source replyTo.
      replyTo: null,
    };
    const current = this.messages.get(input.toChatId) ?? [];
    this.messages.set(input.toChatId, [...current, forwarded]);
    // Your own outgoing message refreshes the dialog preview without
    // touching the unread counter.
    this.updateChat(input.toChatId, (chat) => ({
      ...chat,
      preview: forwarded.body,
      updatedAt: forwarded.sentAt,
    }));
    this.emit({ type: "message-upsert", cause: "new", message: forwarded });
  }

  async setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    this.updateChat(chatId, (chat) => ({ ...chat, pinned }));
  }

  async setChatMuted(chatId: string, muted: boolean): Promise<void> {
    this.updateChat(chatId, (chat) => ({ ...chat, muted }));
  }

  async setChatRead(chatId: string, read: boolean): Promise<void> {
    // Telegram dialog rule: read clears the counter, unread flags the dialog.
    this.updateChat(chatId, (chat) => ({ ...chat, unreadCount: read ? 0 : 1 }));
  }

  // Demo logout is a harmless no-op: resetting the demo workspace is owned by
  // the renderer clearing the demoWorkspace preference.
  async logout(): Promise<void> {}

  private replySnapshot(chatId: string, messageId: string): MessageReplyToDto {
    const { message } = this.findMessage(chatId, messageId);
    return {
      id: message.id,
      senderName: message.senderName,
      body: message.body,
    };
  }

  private findMessage(
    chatId: string,
    messageId: string,
  ): { message: MessageDto; messages: ReadonlyArray<MessageDto> } {
    this.requireChat(chatId);
    const messages = this.messages.get(chatId) ?? [];
    const message = messages.find((entry) => entry.id === messageId);
    if (!message) throw new Error(`Unknown message ${messageId}`);
    return { message, messages };
  }

  private requireChat(chatId: string): void {
    if (!this.chats.has(chatId)) throw new Error(`Unknown chat ${chatId}`);
  }

  private updateChat(chatId: string, update: (chat: ChatDto) => ChatDto): void {
    this.updateChatSilently(chatId, update);
    const chat = this.chats.get(chatId);
    if (chat) this.emit({ type: "chat-upsert", chat });
  }

  // Draft updates emit a dedicated "draft" event instead of "chat-upsert" so
  // the renderer can distinguish "someone is drafting" from a full chat
  // refresh; this still keeps the in-memory snapshot consistent.
  private updateChatSilently(
    chatId: string,
    update: (chat: ChatDto) => ChatDto,
  ): void {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error(`Unknown chat ${chatId}`);
    this.chats.set(chatId, update(chat));
  }

  private emit(event: TelegramWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
