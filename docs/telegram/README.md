# Telegram capability baseline

Telo is a third-party Telegram client. The production kernel is TDLib in the Electron main process ([`../decisions/005-tdlib-client-kernel.md`](../decisions/005-tdlib-client-kernel.md)). The renderer never imports `tdl` or `td_api`.

[`tdlib-capability-matrix.json`](tdlib-capability-matrix.json) classifies product workflows against TDLib methods:

- `covered` — implemented and supported by repository evidence;
- `planned` — a Telo workflow not yet implemented;
- `not-applicable` — out of product scope (calls, Stories, Mini Apps, Stars, wallets).

`pnpm telegram:check` runs as part of `make check`. It fingerprints the installed `prebuilt-tdlib` version and commit, and requires every `covered` capability to cite existing evidence files.

The matrix is a planning and audit baseline. `covered` means the named product capability has an implemented client workflow. New workflows must update this matrix and the relevant product documentation in the same change.

Related:

- [`ablation.md`](ablation.md) — packaging, SQLite, sync, media, and multi-account measurements
- [`baseline.md`](baseline.md) — daily-client checklist vs Telegram Desktop
- [`../todo/tdlib-migration.md`](../todo/tdlib-migration.md) — execution ledger
