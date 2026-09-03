import type { TelegramRepository } from "../../domain/telegram/telegram-ports";

export class ChatActionsService {
  constructor(private readonly repository: TelegramRepository) {}

  setPinned(chatId: string, pinned: boolean): Promise<void> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    return this.repository.setChatPinned(chatId, pinned);
  }

  setMuted(chatId: string, muted: boolean): Promise<void> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    return this.repository.setChatMuted(chatId, muted);
  }

  setRead(chatId: string, read: boolean): Promise<void> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    return this.repository.setChatRead(chatId, read);
  }

  setArchived(chatId: string, archived: boolean): Promise<void> {
    if (!chatId.trim()) throw new Error("Chat id is required");
    return this.repository.setChatArchived(chatId, archived);
  }
}
