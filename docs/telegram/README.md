# Telegram

Telo is a third-party Telegram client. Its kernel is TDLib 1.8.67, loaded into the Go process with `purego` ([`../decisions/005-tdlib-client-kernel.md`](../decisions/005-tdlib-client-kernel.md), [`../decisions/006-mygo-native-desktop.md`](../decisions/006-mygo-native-desktop.md)). The UI never imports TDLib: it reads the domain's `tg.Repository`, which `backend/infrastructure/telegram/live` implements over the generated `tdapi` bindings.

Two committed baselines, both checked by `make check`:

- **[`parity.md`](parity.md)** — interactions and features against [Telegram for macOS](https://github.com/TelegramMessenger/telegram-macos): every upstream module, menu item, shortcut, settings row and context-menu item is classified in [`parity/ledger.json`](parity/ledger.json) (`make parity`).
- **[`tdlib-capability-matrix.json`](tdlib-capability-matrix.json)** — product workflows against TDLib methods (`make capabilities`): `covered` (implemented, with evidence), `planned`, or `not-applicable` (VoIP media, story browsing, Mini Apps, Stars, wallets). It pins the TDLib version and commit `package.json` stages, and every TDLib function a covered workflow names must be in the generated bindings (`tdapi.list`).

## Behavior notes

- **Avatars.** Chat and user photos download through `downloadFile`; the minithumbnail paints at once while the photo loads. Peers without a photo get TDLib's empty userpic: the first grapheme of the title on the peer's accent color. Saved Messages draws its bookmark disc.
- **Send rights.** The composer follows the chat's `CanSendMessages`, `CanSendStickers` and `CanSendMedia`: a read-only channel or a left group never calls `sendMessage`, `setChatDraftMessage` or `sendChatAction`; a text-only restriction keeps the field and disables the matching control.
- **Profile.** Settings edits the photo (`setProfilePhoto`), the bio (`setBio`), the name and the username (`checkChatUsername`, `setUsername`).
- **Contacts.** Added by phone (`importContacts`) or from a direct chat's profile (`addContact`, `removeContacts`, with the phone-sharing exception).
- **Calls.** Call messages render as call cards; VoIP is out of scope ([`007`](../decisions/007-telegram-macos-parity-scope.md)), so there is no call button.

New workflows update the matrix, the parity ledger and the product documentation in the same change.

Related:

- [`baseline.md`](baseline.md) — the daily-client checklist and the live driver (`make test-live`)
- [`ablation.md`](ablation.md) — Teleproto vs TDLib measurements from the Electron build
