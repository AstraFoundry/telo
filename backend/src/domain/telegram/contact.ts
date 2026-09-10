import type { AvatarPlaceholderDto } from "./chat";

/**
 * Contact vocabulary: phone-first import and known-peer edits.
 */

export interface TelegramContactDto {
  readonly id: string;
  readonly displayName: string;
  readonly username: string | null;
  readonly phone: string | null;
  readonly avatarDataUrl: string | null;
  readonly avatarPending?: boolean;
  readonly avatarPlaceholder?: AvatarPlaceholderDto | null;
}

/**
 * Phone-first contact creation (Telegram `importContacts`). Mirrors
 * tdesktop's AddContactBox: one name part is enough, the phone decides.
 */
export interface AddContactByPhoneInput {
  readonly firstName: string;
  readonly lastName: string;
  /** Free-form; the adapter strips everything but digits and a leading +. */
  readonly phone: string;
}

/**
 * User-first contact add/edit for a known peer (Telegram `addContact`),
 * tdesktop's EditContactBox. `sharePhoneNumber` maps to
 * `addContact.share_phone_number` — the phone-privacy exception offered when
 * `PeerProfileDto.needPhonePrivacyException` is set.
 */
export interface SetPeerContactInput {
  readonly userId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly sharePhoneNumber: boolean;
}
