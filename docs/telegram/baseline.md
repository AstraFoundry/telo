# Daily-client baseline

Standard Telo workflows that must be `covered` in [`tdlib-capability-matrix.json`](tdlib-capability-matrix.json) and exercised before cutover. Compared against Telegram Desktop on the same account. Not in this baseline: VoIP media, story browsing, Mini Apps, Stars, wallets.

Live runs are secret-gated (`make test-live`). Demo Playwright remains the PR merge gate for UI.

## Auth

- [ ] Phone number + login code
- [ ] Cloud password (2FA)
- [ ] Restore after restart from `tdlib/<accountId>/`
- [ ] Log out deletes the account directory
- [ ] Three accounts; only the active one stays connected

## Chat list

- [ ] Order matches Desktop for main, pin, Archive, and folders
- [ ] Create, edit, and delete server folders from Settings → Folders; tabs update live
- [ ] Mute, unread, Saved Messages
- [ ] Restart paints from SQLite before network catch-up

## History

- [ ] Page older messages
- [ ] Live new / edit / delete
- [ ] Reply, forward, silent send, pin/unpin
- [ ] Schedule a message from the send-options menu; scheduled bar lists, deletes
- [ ] Optimistic `clientId` reconcile
- [ ] Polls render as cards; vote single/multiple, quiz reveals after answering, closed polls read final results

## Composer

- [ ] UTF-16 entities
- [ ] Media album
- [ ] Create a poll from the send-options menu (question, 2-10 options, quiz correct answer)
- [ ] Voice note record and send (mic button, elapsed timer, cancel discards)
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

## Account menu actions

- [ ] Open My Profile and Contacts
- [ ] Add a contact by phone; add/remove a contact from a direct chat's profile
- [ ] Edit profile name, bio, username, and photo from Settings
- [ ] Transcript renders call messages as call cards (no redial)
- [ ] Create a basic group and channel
- [ ] Start a secret chat from a contact
- [ ] Page call-message history
- [ ] Post a normalized photo story and a TDLib-compatible video story
