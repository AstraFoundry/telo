# Telegram capability baseline

Telo is a third-party Telegram client. The production kernel is TDLib in the Electron main process ([`../decisions/005-tdlib-client-kernel.md`](../decisions/005-tdlib-client-kernel.md)). The renderer never imports `tdl` or `td_api`.

[`tdlib-capability-matrix.json`](tdlib-capability-matrix.json) classifies product workflows against TDLib methods:

- `covered` — implemented and supported by repository evidence;
- `planned` — a Telo workflow not yet implemented;
- `not-applicable` — out of product scope (VoIP media, story browsing, Mini Apps, Stars, wallets).

`pnpm telegram:check` runs as part of `make check`. It fingerprints the installed `prebuilt-tdlib` version and commit, and requires every `covered` capability to cite existing evidence files.

The matrix is a planning and audit baseline. `covered` means the named product capability has an implemented client workflow. The avatar menu is the entry point for the current profile, contacts, basic groups, channels, secret chats, call-message history, and story posting. Call history uses `searchCallMessages`; it does not provide VoIP media. Story posting normalizes photos to 1080×1920 JPEG and accepts TDLib-compatible 720×1280 MP4 video, while story browsing remains outside the client surface. Chat and user photos download through TDLib `downloadFile` into the existing `telo-media:` avatar cache (`chat.photo.big` / `user.profile_photo.big`, falling back to `small`) and patch the renderer with `chat-avatar`. User and private-chat discs also paint `profile_photo.minithumbnail` / `chat.photo.minithumbnail` immediately as a `data:` URL so the slot is not empty while that download runs; `getMe` without `profile_photo` is followed by `getUser`, `getUserFullInfo`, and `getUserProfilePhotos`. A `chatPhoto` size list picks the smallest square of at least 320px (never the 40–90px `s` thumbnail). Peers with no photo paint TDLib's empty userpic: the first grapheme of the title on `accent_color_id` fills (built-in ids 0–6, or `updateAccentColors` RGB lists). Saved Messages is still that self-chat in TDLib, but the renderer paints the bookmark disc on chat-identifying avatars rather than the account userpic. Incoming replies use bundled `messageReplyToMessage` data or `getRepliedMessage`. Photos and videos expose TDLib `minithumbnail` as `blurredThumbnail`. Link-preview photos use the preview type's `photo` file through the media pipeline. Outgoing read receipts follow `updateChatReadOutbox`. Composer send, draft, and typing follow `ChatDto.canSendMessages`; sticker and attachment controls follow `canSendStickers` / `canSendMedia`. A read-only channel or left group never calls `sendMessage`, `setChatDraftMessage`, or `sendChatAction`, while a text-only restriction keeps the field and disables the matching button. New workflows must update this matrix and the relevant product documentation in the same change.

Profile editing follows tdesktop's My Profile: Settings shows the photo (replaceable via `setProfilePhoto`), an inline bio that autosaves (`setBio`), and name/username dialogs (`setName`, `setUsername`, availability via `checkChatUsername` on the Saved Messages chat); the avatar menu's My Profile opens the account's identity card, not the Saved Messages dialog. Contacts are writable both directions: phone-first through `importContacts` (tdesktop AddContactBox), user-first through `addContact`/`removeContacts` on a direct chat's profile (EditContactBox, with the share-phone exception when `needPhonePrivacyException` is set). Call messages render in the transcript as static call cards (tdesktop `HistoryView::Media::Call` label folding); VoIP media remains out of scope — TDLib ships signaling only, so there is no initiation or redial affordance.

Related:

- [`ablation.md`](ablation.md) — packaging, SQLite, sync, media, and multi-account measurements
- [`baseline.md`](baseline.md) — daily-client checklist vs Telegram Desktop
- [`../todo/tdlib-migration.md`](../todo/tdlib-migration.md) — execution ledger
