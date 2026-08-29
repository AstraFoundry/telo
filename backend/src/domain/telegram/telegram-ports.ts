import type {
  ChatPageDto,
  ChatPageInput,
  CurrentUserDto,
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
  MessageDto,
  MessagePageDto,
  MessagePageInput,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";

export interface TelegramRepository {
  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void;
  getCurrentUser(): Promise<CurrentUserDto>;
  listChatPage(input: ChatPageInput): Promise<ChatPageDto>;
  listMessagePage(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto>;
  sendMessage(
    chatId: string,
    body: string,
    replyToId?: string,
  ): Promise<MessageDto>;
  /**
   * Edits an outgoing message. Telegram only allows editing one's own
   * messages; adapters reject non-outgoing targets.
   */
  editMessage(input: EditMessageInput): Promise<void>;
  deleteMessage(input: DeleteMessageInput): Promise<void>;
  /**
   * Forwards a message to another chat. The forwarded copy is a new outgoing
   * message in the target chat and never carries a replyTo snapshot.
   */
  forwardMessage(input: ForwardMessageInput): Promise<void>;
  setChatPinned(chatId: string, pinned: boolean): Promise<void>;
  setChatMuted(chatId: string, muted: boolean): Promise<void>;
  /**
   * Marks a dialog read or unread. Read clears the unread counter; unread
   * flags the dialog (`unreadCount` becomes 1 in the demo workspace).
   */
  setChatRead(chatId: string, read: boolean): Promise<void>;
  /**
   * Ends the current session: disconnects the client and clears the stored
   * session. A no-op for the demo workspace; the demo reset is owned by the
   * renderer clearing the demoWorkspace preference.
   */
  logout(): Promise<void>;
}

export interface TelegramSessionRepository {
  get(): Promise<string>;
  save(session: string): Promise<void>;
  clear(): Promise<void>;
}

export interface TelegramConnectionProfile {
  readonly apiId: number;
  readonly apiHash: string;
  readonly phoneNumber: string;
}

export interface TelegramConnectionProfileRepository {
  get(): Promise<TelegramConnectionProfile | null>;
  save(profile: TelegramConnectionProfile): Promise<void>;
}
