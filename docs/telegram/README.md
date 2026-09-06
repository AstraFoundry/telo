# Telegram capability baseline

Telo is a third-party Telegram client. The production kernel is TDLib in the Electron main process ([`../decisions/005-tdlib-client-kernel.md`](../decisions/005-tdlib-client-kernel.md)). The renderer never imports `tdl` or `td_api`.

[`tdlib-capability-matrix.json`](tdlib-capability-matrix.json) classifies product workflows against TDLib methods:

- `covered` — implemented and supported by repository evidence;
- `planned` — a Telo workflow not yet implemented;
- `not-applicable` — out of product scope (calls, Stories, Mini Apps, Stars, wallets).

`pnpm telegram:check` runs as part of `make check`. It fingerprints the installed `prebuilt-tdlib` version and commit, and requires every `covered` capability to cite existing evidence files.

The matrix is a planning and audit baseline. `covered` means the named product capability has an implemented client workflow. Chat and user photos download through TDLib `downloadFile` into the existing `telo-media:` avatar cache (`chat.photo.small` / `user.profile_photo.small`) and patch the renderer with `chat-avatar`. User and private-chat discs also paint `profile_photo.minithumbnail` / `chat.photo.minithumbnail` immediately as a `data:` URL so the slot is not empty while that download runs; `getMe` without `profile_photo` is followed by `getUser`. Incoming replies use bundled `messageReplyToMessage` data or `getRepliedMessage`. Photos and videos expose TDLib `minithumbnail` as `blurredThumbnail`. Link-preview photos use the preview type's `photo` file through the media pipeline. Outgoing read receipts follow `updateChatReadOutbox`. New workflows must update this matrix and the relevant product documentation in the same change.

Related:

- [`ablation.md`](ablation.md) — packaging, SQLite, sync, media, and multi-account measurements
- [`baseline.md`](baseline.md) — daily-client checklist vs Telegram Desktop
- [`../todo/tdlib-migration.md`](../todo/tdlib-migration.md) — execution ledger
