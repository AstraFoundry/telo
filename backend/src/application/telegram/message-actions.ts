import type {
  AnimatedEmojiEffectDto,
  BotCallbackAnswerDto,
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
  SetMessageReactionInput,
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
    if (
      input.scope !== undefined &&
      input.scope !== "me" &&
      input.scope !== "everyone"
    ) {
      throw new Error("Delete scope must be me or everyone");
    }
    return this.repository.deleteMessage(input);
  }

  forwardMessage(input: ForwardMessageInput): Promise<void> {
    if (!input.fromChatId.trim()) throw new Error("Chat id is required");
    if (!input.messageId.trim()) throw new Error("Message id is required");
    if (!input.toChatId.trim()) throw new Error("Chat id is required");
    return this.repository.forwardMessage(input);
  }

  /**
   * Presses a `"callback"` inline keyboard button. The button id addresses
   * the payload the adapter kept for that message, so nothing about the
   * callback data needs to be trusted from the renderer.
   */
  answerBotCallback(
    chatId: string,
    messageId: string,
    buttonId: string,
  ): Promise<BotCallbackAnswerDto> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (!messageId.trim()) throw new Error("Message id is required");
    if (!buttonId.trim()) throw new Error("Button id is required");
    return this.repository.answerBotCallback(chatId, messageId, buttonId);
  }

  /**
   * Adds or removes this account's reaction on a message. `remove` takes
   * the named emoji back; otherwise it is added.
   */
  setMessageReaction(input: SetMessageReactionInput): Promise<void> {
    if (!input.chatId.trim()) throw new Error("Chat id is required");
    if (!input.messageId.trim()) throw new Error("Message id is required");
    if (!input.emoji.trim()) throw new Error("Reaction emoji is required");
    return this.repository.setMessageReaction({
      ...input,
      emoji: input.emoji.trim(),
      remove: Boolean(input.remove),
    });
  }

  listAvailableReactions(
    chatId: string,
    messageId?: string,
  ): Promise<ReadonlyArray<string>> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    const target = messageId?.trim();
    return this.repository.listAvailableReactions(
      chatId,
      target ? target : undefined,
    );
  }

  clickAnimatedEmoji(
    chatId: string,
    messageId: string,
  ): Promise<AnimatedEmojiEffectDto | null> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    if (!messageId.trim()) throw new Error("Message id is required");
    return this.repository.clickAnimatedEmoji(chatId, messageId);
  }
}
