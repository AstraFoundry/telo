import type { AvatarPlaceholderDto } from "./chat";

/**
 * Call vocabulary: transcript call cards and the call-history page.
 */

/**
 * A call log entry inside the transcript (Telegram `messageCall` /
 * `messageGroupCall`). `status` folds direction and discard reason together
 * the way tdesktop's `Data::MediaCall::Text` does: outgoing+missed reads
 * "Cancelled", incoming+missed reads "Missed", incoming+declined reads
 * "Declined". `durationSeconds` is 0 unless the call connected.
 */
export type MessageCallStatus =
  "outgoing" | "incoming" | "missed" | "declined" | "cancelled" | "group";

export interface MessageCallDto {
  readonly video: boolean;
  readonly status: MessageCallStatus;
  readonly durationSeconds: number;
  /** `messageGroupCall.is_active`: the group call is still running. */
  readonly active?: boolean;
}

export type TelegramCallKind = "incoming" | "outgoing" | "missed";

export interface TelegramCallDto {
  readonly id: string;
  readonly chatId: string;
  readonly title: string;
  readonly avatarDataUrl: string | null;
  readonly avatarPlaceholder?: AvatarPlaceholderDto | null;
  readonly kind: TelegramCallKind;
  readonly video: boolean;
  readonly occurredAt: string;
  readonly durationSeconds: number;
}

export interface TelegramCallPageDto {
  readonly items: ReadonlyArray<TelegramCallDto>;
  readonly nextCursor: string | null;
}
