import type { ChatDto } from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";

/** Header and profile subtitle for a secret chat, matching Telegram Desktop. */
export function secretChatStatus(state: ChatDto["secretState"]): string {
  if (state === "pending") return copy.secretChatWaiting;
  if (state === "closed") return copy.secretChatClosed;
  return copy.secretChatDeviceLocal;
}
