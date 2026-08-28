import type {
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
} from "../../../../contracts/src/ipc";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";

export class MessageActionsService {
  constructor(private readonly repository: TelegramRepository) {}

  editMessage(input: EditMessageInput): Promise<void> {
    if (!input.chatId.trim()) throw new Error("Chat id is required");
    if (!input.messageId.trim()) throw new Error("Message id is required");
    if (!input.body.trim()) throw new Error("Message body is required");
    return this.repository.editMessage({ ...input, body: input.body.trim() });
  }

  deleteMessage(input: DeleteMessageInput): Promise<void> {
    if (!input.chatId.trim()) throw new Error("Chat id is required");
    if (!input.messageId.trim()) throw new Error("Message id is required");
    return this.repository.deleteMessage(input);
  }

  forwardMessage(input: ForwardMessageInput): Promise<void> {
    if (!input.fromChatId.trim()) throw new Error("Chat id is required");
    if (!input.messageId.trim()) throw new Error("Message id is required");
    if (!input.toChatId.trim()) throw new Error("Chat id is required");
    return this.repository.forwardMessage(input);
  }
}
