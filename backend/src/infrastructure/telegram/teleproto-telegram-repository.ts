import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";

import type {
  ChatDto,
  CurrentUserDto,
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
  MessageDto,
  MessageReplyToDto,
  TelegramAuthState,
  TelegramLoginConfigurationDto,
  TelegramLoginInput,
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
  private repository: TelegramRepository = new DemoTelegramRepository();
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
  ) {}

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
      this.repository = new TeleprotoRepository(client);
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

    await this.client?.disconnect();
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
        this.repository = new TeleprotoRepository(client);
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

  listChats(): Promise<ReadonlyArray<ChatDto>> {
    return this.repository.listChats();
  }

  listMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    return this.repository.listMessages(chatId);
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
    await this.client?.disconnect();
    this.client = null;
    this.challenge = null;
    this.repository = new DemoTelegramRepository();
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
}

class TeleprotoRepository implements TelegramRepository {
  constructor(private readonly client: TelegramClient) {}

  async getCurrentUser(): Promise<CurrentUserDto> {
    const user = await this.client.getMe();
    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.username ||
      "Telegram user";
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

  async listChats(): Promise<ReadonlyArray<ChatDto>> {
    const dialogs = await this.client.getDialogs({ limit: 60 });
    return dialogs.map((dialog) => {
      const title = dialog.title || dialog.name || "Telegram";
      return {
        id: dialog.id?.toString() ?? dialog.inputEntity.className,
        title,
        preview: dialog.message?.message || "",
        updatedAt: new Date((dialog.date ?? 0) * 1000).toISOString(),
        unreadCount: dialog.unreadCount,
        muted: false,
        pinned: dialog.pinned,
        kind: dialog.isChannel
          ? "channel"
          : dialog.isGroup
            ? "group"
            : "direct",
        initials: initials(title),
      };
    });
  }

  async listMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    const messages = await this.client.getMessages(chatId, { limit: 80 });
    const replyTo = await this.replySnapshots(chatId, messages);
    return messages
      .map((message) =>
        toMessage(chatId, message, replyTo.get(message.id.toString()) ?? null),
      )
      .sort((left, right) => left.sentAt.localeCompare(right.sentAt));
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
    return toMessage(chatId, sent, replyTo);
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
    await this.client.disconnect();
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
        senderName: source.out ? "You" : "Telegram",
        body: source.message,
      });
    }
    return snapshots;
  }
}

type TeleprotoMessage = Awaited<ReturnType<TelegramClient["sendMessage"]>>;

function toMessage(
  chatId: string,
  message: TeleprotoMessage,
  replyTo: MessageReplyToDto | null = null,
): MessageDto {
  return {
    id: message.id.toString(),
    chatId,
    senderName: message.out ? "You" : "Telegram",
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

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Telegram authentication failed";
}
