# telegram-macos parity

Telo follows [Telegram for macOS](https://github.com/TelegramMessenger/telegram-macos) for its interactions and features. `make parity` (part of `make check`) holds the code to that: it fails when an upstream surface is unclassified, when a claim has no code or test behind it, or when a key binding drifts from upstream. The scope it enforces is [`007`](../decisions/007-telegram-macos-parity-scope.md).

## Files

| File | Role |
| --- | --- |
| [`parity/upstream-inventory.json`](parity/upstream-inventory.json) | Every upstream surface at a pinned commit: Swift packages (`module:`), main-menu items (`menu:`), keyboard shortcuts (`shortcut:`), settings sections and rows (`setting:`, `settings-row:`), message, chat and attach menu items. Generated; never edited by hand. |
| [`parity/ledger.json`](parity/ledger.json) | Telo's classification. Each entry claims upstream items and gives a status, the Go declarations that implement it, the tests that drive it, and for gaps a priority and a reason. |
| `cmd/parityinventory` | Regenerates the inventory from a telegram-macos checkout: `make inventory UPSTREAM=../telegram-macos`. |
| `cmd/paritycheck`, `internal/parity` | The gate. |

The summary counts live in the ledger's `summary` object; the gate fails when they disagree with the entries.

## Statuses

- **`implemented`** — the behavior ships. Needs `evidence` (Go declarations) and `tests`.
- **`partial`** — part of it ships. Needs evidence and tests, plus a `priority` and a `reason` naming what is missing.
- **`planned`** — not built. Needs a `priority` (`P0`, `P1`, `P2`) and a `reason`.
- **`not-applicable`** — out of scope. Needs a `reason` and a `decision` document that exists.

## What the gate checks

1. The ledger classifies the same telegram-macos commit as the inventory, and its summary matches its entries.
2. Every inventory item is claimed by exactly one entry; every claim names an inventory item.
3. Every `evidence` entry (`frontend/features/signin.State.SubmitPhone`) resolves to a declaration in the Go source: a function, a method, a type or a variable. Every `tests` entry resolves to a `Test…` function in that package's `_test.go` files. The tests themselves run in `make test`.
4. **Registry anchors.** The registries Telo binds carry the upstream id they reproduce: `config.Shortcuts`, the menu bar (`bootstrap.Menus`), the settings index (`settings.Entries`), the message menu (`messageactions.Items`), the chat menu (`chatactions.Items`) and the attach menu (`compose.AttachItems`). The gate fails when:
   - a registry binds an upstream item the ledger marks `planned` or `not-applicable`;
   - a shortcut or menu item binds different keys from upstream (`⌘F` where upstream has `⌘⇧F`);
   - an interactive upstream item (menu, shortcut, setting, row, message, chat or attach action) is `implemented` but no registry binds it.

So a menu item cannot ship without its ledger entry, and the ledger cannot claim an interactive item that no menu, shortcut or settings row reaches.

## Changing parity

- **Shipping a gap.** Add the registry entry with its `Upstream` id, move the ledger entry to `implemented` or `partial`, and name the evidence and the tests. `make parity` fails until all three agree.
- **A new upstream commit.** Run `make inventory UPSTREAM=…`, then classify every new item the gate reports.
- **Out of scope.** Only with a reason recorded in a decision; extend [`007`](../decisions/007-telegram-macos-parity-scope.md) or write a new ADR.

The ledger's `planned` and `partial` entries are Telo's gap list, ordered by priority.
