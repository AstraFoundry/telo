import { describe, expect, it, vi } from "vitest";

import type { TelegramRepository } from "../../domain/telegram/telegram-ports";
import { TelegramLogoutService } from "./telegram-logout";

describe("TelegramLogoutService", () => {
  it("forwards logout to the port", async () => {
    const repository = {
      logout: vi.fn(async () => undefined),
    } as unknown as TelegramRepository;
    const service = new TelegramLogoutService(repository);

    await service.execute();

    expect(repository.logout).toHaveBeenCalledTimes(1);
  });
});
