import type {
  ChatDto,
  CurrentUserDto,
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
  MessageDto,
  MessageReplyToDto,
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
  },
];

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

export class DemoTelegramRepository implements TelegramRepository {
  private readonly chats = new Map(
    INITIAL_CHATS.map((chat) => [chat.id, { ...chat }]),
  );
  private readonly messages = new Map(
    Object.entries(INITIAL_MESSAGES).map(([chatId, messages]) => [
      chatId,
      [...messages],
    ]),
  );

  async getCurrentUser(): Promise<CurrentUserDto> {
    return {
      id: "demo-user",
      displayName: "Demo User",
      username: null,
      initials: "DU",
      avatarDataUrl: null,
    };
  }

  async listChats(): Promise<ReadonlyArray<ChatDto>> {
    return [...this.chats.values()];
  }

  async listMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    return this.messages.get(chatId) ?? [];
  }

  async sendMessage(
    chatId: string,
    body: string,
    replyToId?: string,
  ): Promise<MessageDto> {
    const message: MessageDto = {
      id: crypto.randomUUID(),
      chatId,
      senderName: "You",
      body,
      sentAt: new Date().toISOString(),
      outgoing: true,
      status: "sent",
      replyTo: replyToId ? this.replySnapshot(chatId, replyToId) : null,
    };
    const current = this.messages.get(chatId) ?? [];
    this.messages.set(chatId, [...current, message]);
    return message;
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
  }

  async deleteMessage(input: DeleteMessageInput): Promise<void> {
    const { messages } = this.findMessage(input.chatId, input.messageId);
    this.messages.set(
      input.chatId,
      messages.filter((entry) => entry.id !== input.messageId),
    );
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
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error(`Unknown chat ${chatId}`);
    this.chats.set(chatId, update(chat));
  }
}
