import { TelegramClient } from "teleproto";
import {
  DeletedMessage,
  EditedMessage,
  MessageRead,
  NewMessage,
  type DeletedMessageEvent,
  type EditedMessageEvent,
  type MessageReadEvent,
  type NewMessageEvent,
} from "teleproto/events/index.js";
import { StringSession } from "teleproto/sessions/index.js";
import { UpdateConnectionState } from "teleproto/network/index.js";

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
  TelegramAuthState,
  TelegramLoginConfigurationDto,
  TelegramLoginInput,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";
import type {
  TelegramRepository,
  TelegramConnectionProfileRepository,
  TelegramSessionRepository,
} from "../../domain/telegram/telegram-ports";
import { DemoTelegramRepository } from "./demo-telegram-repository";

type Challenge = {
  readonly kind: "code" | "password";
  readonly resolve: (value: string) => void;
};

export class TelegramClientCoordinator implements TelegramRepository {
  private readonly listeners = new Set<
    (event: TelegramWorkspaceEvent) => void
  >();
  private repository: TelegramRepository;
  private unsubscribeRepository: () => void;
  private state: TelegramAuthState = { status: "idle" };
  private challenge: Challenge | null = null;
  private client: TelegramClient | null = null;

  constructor(
    private readonly sessions: TelegramSessionRepository,
    private readonly profiles: TelegramConnectionProfileRepository,
    private readonly applicationCredentials: {
      readonly apiId: number;
      readonly apiHash: string;
    } | null,
    private readonly onState: (state: TelegramAuthState) => void,
  ) {
    this.repository = new DemoTelegramRepository();
    this.unsubscribeRepository = this.repository.subscribe((event) =>
      this.publish(event),
    );
  }

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getAuthState(): TelegramAuthState {
    return this.state;
  }

  async getLoginConfiguration(): Promise<TelegramLoginConfigurationDto> {
    return {
      applicationCredentialsConfigured: Boolean(
        this.applicationCredentials ?? (await this.profiles.get()),
      ),
    };
  }

  async initialize(): Promise<void> {
    try {
      const session = await this.sessions.get();
      const profile = await this.profiles.get();
      const credentials = this.applicationCredentials ?? profile;
      if (!session || !credentials) return;

      this.setState({ status: "connecting" });
      const client = this.createClient(
        session,
        credentials.apiId,
        credentials.apiHash,
      );
      this.client = client;
      await client.connect();
      if (!(await client.checkAuthorization())) {
        await client.disconnect();
        this.client = null;
        this.setState({ status: "idle" });
        return;
      }
      this.replaceRepository(new TeleprotoRepository(client));
      await client.catchUp();
      this.setState({ status: "ready" });
    } catch (error) {
      this.client = null;
      this.setState({ status: "error", message: safeError(error) });
    }
  }

  async beginLogin(input: TelegramLoginInput): Promise<void> {
    const savedProfile = await this.profiles.get();
    const apiId =
      this.applicationCredentials?.apiId ?? savedProfile?.apiId ?? input.apiId;
    const apiHash =
      this.applicationCredentials?.apiHash ??
      savedProfile?.apiHash ??
      input.apiHash?.trim();
    if (!Number.isInteger(apiId) || !apiId || apiId <= 0)
      throw new Error("Telegram API id is invalid");
    if (!apiHash) throw new Error("Telegram API hash is required");
    if (!input.phoneNumber.trim()) throw new Error("Phone number is required");

    await this.disconnectCurrentClient();
    const client = this.createClient(await this.sessions.get(), apiId, apiHash);
    const profile = { apiId, apiHash, phoneNumber: input.phoneNumber.trim() };
    this.client = client;
    this.setState({ status: "connecting" });

    void client
      .start({
        phoneNumber: input.phoneNumber.trim(),
        phoneCode: () => this.waitForChallenge("code"),
        password: (hint) => {
          this.setState({ status: "password-required", hint: hint || null });
          return this.waitForChallenge("password", false);
        },
        onError: (error) => {
          this.setState({ status: "error", message: safeError(error) });
        },
      })
      .then(async () => {
        await this.sessions.save(client.session.save() as string);
        await this.profiles.save(profile);
        this.replaceRepository(new TeleprotoRepository(client));
        await client.catchUp();
        this.setState({ status: "ready" });
      })
      .catch((error: unknown) => {
        this.setState({ status: "error", message: safeError(error) });
      });
  }

  async submitChallenge(value: string): Promise<void> {
    const challenge = this.challenge;
    if (!challenge)
      throw new Error("Telegram is not waiting for a login challenge");
    if (!value.trim()) throw new Error("Telegram login value is required");
    this.challenge = null;
    this.setState({ status: "connecting" });
    challenge.resolve(value.trim());
  }

  getCurrentUser(): Promise<CurrentUserDto> {
    return this.repository.getCurrentUser();
  }

  listChatPage(input: ChatPageInput): Promise<ChatPageDto> {
    return this.repository.listChatPage(input);
  }

  listMessagePage(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    return this.repository.listMessagePage(chatId, input);
  }

  sendMessage(
    chatId: string,
    body: string,
    replyToId?: string,
  ): Promise<MessageDto> {
    return this.repository.sendMessage(chatId, body, replyToId);
  }

  editMessage(input: EditMessageInput): Promise<void> {
    return this.repository.editMessage(input);
  }

  deleteMessage(input: DeleteMessageInput): Promise<void> {
    return this.repository.deleteMessage(input);
  }

  forwardMessage(input: ForwardMessageInput): Promise<void> {
    return this.repository.forwardMessage(input);
  }

  setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    return this.repository.setChatPinned(chatId, pinned);
  }

  setChatMuted(chatId: string, muted: boolean): Promise<void> {
    return this.repository.setChatMuted(chatId, muted);
  }

  setChatRead(chatId: string, read: boolean): Promise<void> {
    return this.repository.setChatRead(chatId, read);
  }

  async logout(): Promise<void> {
    await this.disconnectCurrentClient();
    this.client = null;
    this.challenge = null;
    this.replaceRepository(new DemoTelegramRepository());
    await this.sessions.clear();
    this.setState({ status: "idle" });
  }

  private waitForChallenge(
    kind: Challenge["kind"],
    announce = true,
  ): Promise<string> {
    if (announce) this.setState({ status: "code-required" });
    return new Promise((resolve) => {
      this.challenge = { kind, resolve };
    });
  }

  private createClient(
    session: string,
    apiId: number,
    apiHash: string,
  ): TelegramClient {
    return new TelegramClient(new StringSession(session), apiId, apiHash, {
      connectionRetries: 5,
    });
  }

  private setState(state: TelegramAuthState): void {
    this.state = state;
    this.onState(state);
  }

  private async disconnectCurrentClient(): Promise<void> {
    if (this.repository instanceof TeleprotoRepository) {
      await this.repository.logout();
    } else {
      await this.client?.disconnect();
    }
  }

  private replaceRepository(repository: TelegramRepository): void {
    this.unsubscribeRepository();
    this.repository = repository;
    this.unsubscribeRepository = repository.subscribe((event) =>
      this.publish(event),
    );
  }

  private publish(event: TelegramWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

class TeleprotoRepository implements TelegramRepository {
  private readonly listeners = new Set<
    (event: TelegramWorkspaceEvent) => void
  >();
  private readonly messageChats = new Map<string, Set<string>>();
  private readonly newMessageBuilder = new NewMessage({});
  private readonly editedMessageBuilder = new EditedMessage({});
  private readonly deletedMessageBuilder = new DeletedMessage({});
  private readonly inboxReadBuilder = new MessageRead({ inbox: true });
  private readonly outboxReadBuilder = new MessageRead({ inbox: false });
  private readonly onNewMessage = (event: NewMessageEvent) => {
    void this.handleMessageUpsert("new", event).catch((error: unknown) =>
      this.emitSyncError(error),
    );
  };
  private readonly onEditedMessage = (event: EditedMessageEvent) => {
    void this.handleMessageUpsert("edited", event).catch((error: unknown) =>
      this.emitSyncError(error),
    );
  };
  private readonly onDeletedMessage = (event: DeletedMessageEvent) => {
    void this.handleMessageDelete(event).catch((error: unknown) =>
      this.emitSyncError(error),
    );
  };
  private readonly onMessageRead = (event: MessageReadEvent) => {
    this.handleMessageRead(event);
  };
  private readonly stopConnectionListener: () => void;

  constructor(private readonly client: TelegramClient) {
    client.addEventHandler(this.onNewMessage, this.newMessageBuilder);
    client.addEventHandler(this.onEditedMessage, this.editedMessageBuilder);
    client.addEventHandler(this.onDeletedMessage, this.deletedMessageBuilder);
    client.addEventHandler(this.onMessageRead, this.inboxReadBuilder);
    client.addEventHandler(this.onMessageRead, this.outboxReadBuilder);
    this.stopConnectionListener = client.updates.on(
      "connectionState",
      async (update, next) => {
        await this.handleConnectionState(update);
        await next();
      },
    );
  }

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getCurrentUser(): Promise<CurrentUserDto> {
    const user = await this.client.getMe();
    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.username ||
      user.phone;
    if (!displayName) throw new Error("Telegram account has no display name");
    let avatarDataUrl: string | null = null;

    try {
      const avatar = await this.client.downloadProfilePhoto("me", {
        isBig: false,
      });
      if (avatar && typeof avatar !== "string" && avatar.byteLength > 0) {
        avatarDataUrl = `data:image/jpeg;base64,${Buffer.from(avatar).toString("base64")}`;
      }
    } catch {
      // A missing or inaccessible profile photo should not block the workspace.
    }

    return {
      id: user.id.toString(),
      displayName,
      username: user.username ?? null,
      initials: initials(displayName),
      avatarDataUrl,
    };
  }

  async listChatPage(input: ChatPageInput): Promise<ChatPageDto> {
    const limit = input.limit ?? 50;
    const dialogs = await this.client.getDialogs({
      limit: limit + 1,
      offsetDate: input.cursor
        ? Math.floor(Date.parse(input.cursor.updatedAt) / 1000)
        : undefined,
      offsetId: input.cursor
        ? telegramMessageId(input.cursor.topMessageId)
        : undefined,
      offsetPeer: input.cursor?.chatId,
      ignorePinned: Boolean(input.cursor),
    });
    const page = dialogs.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((dialog) => this.toChat(dialog)),
      nextCursor:
        dialogs.length > limit && last
          ? {
              chatId: this.dialogId(last),
              topMessageId: String(last.dialog.topMessage),
              updatedAt: this.dialogDate(last).toISOString(),
            }
          : null,
    };
  }

  async listMessagePage(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    const limit = input.limit ?? 50;
    const messages = await this.client.getMessages(chatId, {
      limit: limit + 1,
      offsetId: input.beforeMessageId
        ? telegramMessageId(input.beforeMessageId)
        : undefined,
    });
    const page = messages.slice(0, limit);
    const replyTo = await this.replySnapshots(chatId, page);
    page.forEach((message) => this.indexMessage(chatId, message));
    const items = (
      await Promise.all(
        page.map((message) =>
          this.toMessage(
            chatId,
            message,
            replyTo.get(message.id.toString()) ?? null,
          ),
        ),
      )
    ).sort((left, right) => left.sentAt.localeCompare(right.sentAt));
    return {
      items,
      nextCursor:
        messages.length > limit ? (page.at(-1)?.id.toString() ?? null) : null,
    };
  }

  async sendMessage(
    chatId: string,
    body: string,
    replyToId?: string,
  ): Promise<MessageDto> {
    const sent = await this.client.sendMessage(chatId, {
      message: body,
      replyTo: replyToId ? Number(replyToId) : undefined,
    });
    const replyTo = replyToId
      ? ((await this.replySnapshots(chatId, [sent])).get(sent.id.toString()) ??
        null)
      : null;
    this.indexMessage(chatId, sent);
    return this.toMessage(chatId, sent, replyTo);
  }

  async editMessage(input: EditMessageInput): Promise<void> {
    // Telegram rejects edits of other users' messages, so no local check.
    await this.client.editMessage(input.chatId, {
      message: Number(input.messageId),
      text: input.body,
    });
  }

  async deleteMessage(input: DeleteMessageInput): Promise<void> {
    await this.client.deleteMessages(input.chatId, [Number(input.messageId)], {
      revoke: true,
    });
  }

  async forwardMessage(input: ForwardMessageInput): Promise<void> {
    await this.client.forwardMessages(input.toChatId, {
      messages: [Number(input.messageId)],
      fromPeer: input.fromChatId,
    });
  }

  async setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    await this.client.api.messages.toggleDialogPin({ pinned, peer: chatId });
  }

  async setChatMuted(chatId: string, muted: boolean): Promise<void> {
    // A far-future muteUntil mutes the dialog forever; 0 restores notifications.
    await this.client.updateNotifySettings(chatId, {
      muteUntil: muted ? 2147483647 : 0,
    });
  }

  async setChatRead(chatId: string, read: boolean): Promise<void> {
    if (read) {
      await this.client.markAsRead(chatId);
    } else {
      await this.client.api.messages.markDialogUnread({
        unread: true,
        peer: chatId,
      });
    }
  }

  async logout(): Promise<void> {
    this.removeEventHandlers();
    this.stopConnectionListener();
    await this.client.disconnect();
  }

  private async handleConnectionState(
    update: UpdateConnectionState,
  ): Promise<void> {
    if (update.state !== UpdateConnectionState.connected) {
      this.emit({ type: "connection-state", state: "offline" });
      return;
    }
    this.emit({ type: "connection-state", state: "synchronizing" });
    try {
      await this.client.catchUp();
      this.emit({ type: "connection-state", state: "connected" });
    } catch (error) {
      this.emitSyncError(error);
    }
  }

  private async handleMessageUpsert(
    cause: "new" | "edited",
    event: NewMessageEvent | EditedMessageEvent,
  ): Promise<void> {
    const chatId = event.message.chatId?.toString();
    if (!chatId) throw new Error("Telegram update has no chat id");
    this.indexMessage(chatId, event.message);
    const replyTo = (await this.replySnapshots(chatId, [event.message])).get(
      event.message.id.toString(),
    );
    const message = await this.toMessage(
      chatId,
      event.message,
      replyTo ?? null,
    );
    this.emit({ type: "message-upsert", cause, message });
  }

  private async handleMessageDelete(event: DeletedMessageEvent): Promise<void> {
    const ids = event.deletedIds.map(String);
    const explicitChatId = event.peer
      ? await this.client.getPeerId(event.peer)
      : null;
    const chatIds = new Set<string>();
    if (explicitChatId) chatIds.add(explicitChatId);
    for (const id of ids) {
      for (const chatId of this.messageChats.get(id) ?? []) chatIds.add(chatId);
    }
    for (const chatId of chatIds) {
      this.emit({ type: "message-delete", chatId, messageIds: ids });
    }
    for (const id of ids) this.messageChats.delete(id);
  }

  private handleMessageRead(event: MessageReadEvent): void {
    const chatId = event.chatId?.toString();
    if (!chatId || event.contents) return;
    this.emit({
      type: "message-read",
      chatId,
      maxMessageId: String(event.maxId),
      direction: event.outbox ? "outbox" : "inbox",
    });
  }

  private indexMessage(chatId: string, message: TeleprotoMessage): void {
    const id = message.id.toString();
    const chats = this.messageChats.get(id) ?? new Set<string>();
    chats.add(chatId);
    this.messageChats.set(id, chats);
  }

  private removeEventHandlers(): void {
    this.client.removeEventHandler(this.onNewMessage, this.newMessageBuilder);
    this.client.removeEventHandler(
      this.onEditedMessage,
      this.editedMessageBuilder,
    );
    this.client.removeEventHandler(
      this.onDeletedMessage,
      this.deletedMessageBuilder,
    );
    this.client.removeEventHandler(this.onMessageRead, this.inboxReadBuilder);
    this.client.removeEventHandler(this.onMessageRead, this.outboxReadBuilder);
  }

  private emit(event: TelegramWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private emitSyncError(error: unknown): void {
    this.emit({ type: "sync-error", message: safeError(error) });
  }

  private toChat(dialog: TeleprotoDialog): ChatDto {
    const title = dialog.title || dialog.name;
    if (!title) throw new Error("Telegram dialog has no title");
    const notifySettings = dialog.dialog.notifySettings;
    const muted =
      "muteUntil" in notifySettings &&
      typeof notifySettings.muteUntil === "number" &&
      notifySettings.muteUntil > Math.floor(Date.now() / 1000);
    const saved =
      dialog.isUser &&
      Boolean((dialog.entity as { self?: boolean } | undefined)?.self);
    return {
      id: this.dialogId(dialog),
      title,
      preview: dialog.message?.message || "",
      updatedAt: this.dialogDate(dialog).toISOString(),
      unreadCount: dialog.unreadCount,
      muted,
      pinned: dialog.pinned,
      kind: saved
        ? "saved"
        : dialog.isChannel
          ? "channel"
          : dialog.isGroup
            ? "group"
            : "direct",
      initials: initials(title),
    };
  }

  private dialogId(dialog: TeleprotoDialog): string {
    if (!dialog.id) throw new Error("Telegram dialog has no id");
    return dialog.id.toString();
  }

  private dialogDate(dialog: TeleprotoDialog): Date {
    if (typeof dialog.date !== "number") {
      throw new Error(
        `Telegram dialog ${this.dialogId(dialog)} has no timestamp`,
      );
    }
    return new Date(dialog.date * 1000);
  }

  private async replySnapshots(
    chatId: string,
    messages: ReadonlyArray<TeleprotoMessage>,
  ): Promise<Map<string, MessageReplyToDto>> {
    const ids = [
      ...new Set(
        messages
          .map((message) => message.replyToMsgId)
          .filter((id): id is number => typeof id === "number"),
      ),
    ];
    const snapshots = new Map<string, MessageReplyToDto>();
    if (ids.length === 0) return snapshots;
    const replied = await this.client.getMessages(chatId, { ids });
    const byId = new Map(replied.map((entry) => [entry.id, entry]));
    for (const message of messages) {
      if (typeof message.replyToMsgId !== "number") continue;
      const source = byId.get(message.replyToMsgId);
      if (!source) continue;
      snapshots.set(message.id.toString(), {
        id: source.id.toString(),
        senderName: await senderName(source),
        body: source.message,
      });
    }
    return snapshots;
  }

  private async toMessage(
    chatId: string,
    message: TeleprotoMessage,
    replyTo: MessageReplyToDto | null = null,
  ): Promise<MessageDto> {
    return {
      id: message.id.toString(),
      chatId,
      senderName: await senderName(message),
      body: message.message,
      sentAt: new Date(message.date * 1000).toISOString(),
      outgoing: Boolean(message.out),
      status: message.out ? "sent" : "read",
      replyTo,
      editedAt:
        typeof message.editDate === "number"
          ? new Date(message.editDate * 1000).toISOString()
          : null,
    };
  }
}

type TeleprotoMessage = Awaited<ReturnType<TelegramClient["sendMessage"]>>;
type TeleprotoDialog = Awaited<
  ReturnType<TelegramClient["getDialogs"]>
>[number];

async function senderName(message: TeleprotoMessage): Promise<string> {
  const sender = (await message.getSender()) as
    | {
        firstName?: string;
        lastName?: string;
        title?: string;
        username?: string;
      }
    | undefined;
  const senderDisplayName = sender
    ? [sender.firstName, sender.lastName].filter(Boolean).join(" ") ||
      sender.title ||
      sender.username
    : undefined;
  const chat = senderDisplayName
    ? undefined
    : ((await message.getChat()) as
        { title?: string; firstName?: string; username?: string } | undefined);
  const name =
    senderDisplayName ||
    message.postAuthor ||
    chat?.title ||
    chat?.firstName ||
    chat?.username;
  if (!name) throw new Error(`Telegram message ${message.id} has no sender`);
  return name;
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function telegramMessageId(value: string): number {
  if (!/^\d+$/.test(value))
    throw new Error(`Invalid Telegram message id ${value}`);
  return Number(value);
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Telegram authentication failed";
}
