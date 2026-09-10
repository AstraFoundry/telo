import type { AvatarPlaceholderDto, ChatKind } from "./chat";

/**
 * Peer and account identity vocabulary.
 */

/** Self profile name edit (Telegram `setName`). First name is required. */
export interface UpdateProfileNameInput {
  readonly firstName: string;
  readonly lastName: string;
}

/**
 * Availability of a personal username, mapped from TDLib
 * `checkChatUsername` on the Saved Messages chat. "unknown" covers the
 * non-deciding results (purchasable, public-chat quota) — the save itself
 * stays the source of truth.
 */
export type UsernameAvailability =
  "available" | "invalid" | "taken" | "unknown";

export interface CurrentUserDto {
  readonly id: string;
  readonly displayName: string;
  readonly username: string | null;
  /** Telegram "about" text from `getUserFullInfo`; null when empty. */
  readonly bio: string | null;
  /** The account's own phone number, always known once authorized. */
  readonly phone: string | null;
  readonly initials: string;
  readonly avatarDataUrl: string | null;
  /** True until the account photo settles, like `ChatDto.avatarPending`. */
  readonly avatarPending?: boolean;
  readonly avatarPlaceholder?: AvatarPlaceholderDto | null;
}

/**
 * Identity card for any Telegram user: peers with no dialog, the account's
 * own My Profile, and direct-chat dialogs all read it. It carries the
 * UserFullInfo fields a ChatDto does not — bio, phone, contact state.
 */
export interface PeerProfileDto {
  readonly id: string;
  readonly title: string;
  readonly username: string | null;
  readonly kind: ChatKind;
  readonly avatarDataUrl: string | null;
  /** True until the photo settles, exactly like `ChatDto.avatarPending`. */
  readonly avatarPending?: boolean;
  /** Whether the peer is in the account's contact list (`user.is_contact`). */
  readonly isContact?: boolean;
  /**
   * `userFullInfo.need_phone_number_privacy_exception`: adding this peer as a
   * contact should offer the "share my phone number" exception.
   */
  readonly needPhonePrivacyException?: boolean;
  readonly avatarPlaceholder?: AvatarPlaceholderDto | null;
  /** Telegram "about" text; null when empty or hidden from the account. */
  readonly bio: string | null;
  /** Set only when the peer shares their number with the account. */
  readonly phone: string | null;
}
