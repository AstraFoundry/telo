# Daily-client baseline

Standard Telo workflows that must be `covered` in [`tdlib-capability-matrix.json`](tdlib-capability-matrix.json) and exercised before cutover. Compared against Telegram Desktop on the same account. Not in this baseline: calls, Stories, Mini Apps, Stars, wallets.

Live runs are secret-gated (`make test-live`). Demo Playwright remains the PR merge gate for UI.

## Auth

- [ ] Phone number + login code
- [ ] Cloud password (2FA)
- [ ] Restore after restart from `tdlib/<accountId>/`
- [ ] Log out deletes the account directory
- [ ] Three accounts; only the active one stays connected

## Chat list

- [ ] Order matches Desktop for main, pin, Archive, and folders
- [ ] Mute, unread, Saved Messages
- [ ] Restart paints from SQLite before network catch-up

## History

- [ ] Page older messages
- [ ] Live new / edit / delete
- [ ] Reply, forward, silent send
- [ ] Optimistic `clientId` reconcile

## Composer

- [ ] UTF-16 entities
- [ ] Media album
- [ ] Stickers, drafts, typing

## Search and media

- [ ] Global + in-chat search
- [ ] Download progress and cancel
- [ ] `telo-media:` serving and cache cap

## Presence and extras

- [ ] Presence, typing, read receipts
- [ ] Reactions, bot callback
- [ ] Reconnect: offline → synchronizing → connected, no dup/miss

## Secret chats (Wave 6)

- [ ] Create from Telo to an official client
- [ ] Device-local history after kill
- [ ] Lock UI on sidebar and header
