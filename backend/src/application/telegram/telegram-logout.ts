import type { TelegramRepository } from "../../domain/telegram/telegram-ports";

export class TelegramLogoutService {
  constructor(private readonly repository: TelegramRepository) {}

  execute(): Promise<void> {
    return this.repository.logout();
  }
}
