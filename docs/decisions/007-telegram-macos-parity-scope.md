# 007: Scope of telegram-macos parity

## Status

Accepted.

## Context

Telo aligns its interactions and features with [Telegram for macOS](https://github.com/TelegramMessenger/telegram-macos). `make check` holds it to that: `cmd/paritycheck` compares a committed ledger with an inventory extracted from a pinned telegram-macos commit ([`docs/telegram/parity.md`](../telegram/parity.md)). Every inventory item is implemented, partial, planned, or out of scope. Out of scope needs a recorded reason; this decision records them.

## Decision

These telegram-macos surfaces are **not applicable** to Telo:

1. **Calls and video chats.** One-to-one calls, group calls, screen sharing, camera toggles and push-to-talk need `tgcalls` and native media capture and playback, which neither TDLib nor MyGo provide. Telo shows call history from call messages.
2. **Payments, Premium and Stars.** Premium subscriptions, gifts, Stars, TON, the wallet, paid media and in-app purchases. A third-party client cannot take App Store or Telegram payments for Telegram.
3. **Business, identity and verification.** Telegram Business, quick replies, Passport, age verification and passkeys.
4. **Mini Apps, bots' attachment menu and web content.** These run web views, which [`006`](006-mygo-native-desktop.md) keeps out.
5. **Sponsored messages and promotions.** Telo shows no ads and no promoted proxy chats.
6. **Premium-only customizations.** Profile colors, emoji statuses, saved-message tags, checklists and chat themes that require Premium.
7. **Text services of AppKit.** Spelling and grammar, substitutions and transformations in the Edit menu need the system text services MyGo's text system does not expose.
8. **Upstream platform libraries.** telegram-macos packages that only exist to support the above, or that implement plumbing Telo gets from TDLib, Go's standard library or MyGo (archive, GZIP, ring buffers, Objective-C helpers, crash reporting, performance labs).

Everything else is in scope: shipped as implemented or partial, or planned with a P0, P1 or P2 priority and a reason.

## Consequences

- The ledger can only call an item not applicable by citing this decision; adding a surface here is a reviewed change.
- Reversing an item (for example, calls once a native media stack exists) is a new decision that moves its ledger entries to planned.

## References

- [`docs/telegram/parity/ledger.json`](../telegram/parity/ledger.json)
- [`docs/telegram/parity/upstream-inventory.json`](../telegram/parity/upstream-inventory.json)
