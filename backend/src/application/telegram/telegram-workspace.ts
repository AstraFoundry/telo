import type {
  ChatDto,
  CurrentUserDto,
  MessageDto,
  SendMessageInput,
} from "../../../../contracts/src/ipc";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";

export class TelegramWorkspaceService {
  constructor(private readonly repository: TelegramRepository) {}

  getCurrentUser(): Promise<CurrentUserDto> {
    return this.repository.getCurrentUser();
  }

  listChats(): Promise<ReadonlyArray<ChatDto>> {
    return this.repository.listChats();
  }

  listMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    return this.repository.listMessages(chatId);
  }

  sendMessage(
    chatId: string,
    body: string,
    input?: SendMessageInput,
  ): Promise<MessageDto> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (!body.trim()) throw new Error("Message body is required");
    return this.repository.sendMessage(chatId, body.trim(), input?.replyToId);
  }
}
