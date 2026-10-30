# UI Patterns

How Telo's MyGo views are written. Tokens and primitives are in [`design-system.md`](design-system.md); this document covers copy, structure, interaction and accessibility.

## Language and copy

- Every visible string is a key of `frontend/shared/copy/en.copy` (`key = text`), read with `copy.T`, `copy.F` (fmt verbs) or `copy.Plural`. `make copy` regenerates the key constants; `make generated` fails when they are stale, and a key used in code but missing from the catalog fails the build.
- A missing key is a defect. Never fall back to another key or a literal.
- Counts, sizes and durations use `copy.Count`, `copy.Bytes` and `copy.Duration`; times and dates use `frontend/shared/lib/timefmt` with the user's locale and 12/24-hour preference.
- Code, comments and identifiers are English.

```go
// ✅
kit.Button(c, t, kit.Primary, copy.T(copy.Send), ready)

// ❌
kit.Button(c, t, kit.Primary, "Send", ready)
```

## No redundant copy

- Do not repeat what a title, icon, selected state or surrounding section already says.
- An empty state is one line under an icon (`kit.Empty`), not a paragraph.
- Do not show disabled placeholder actions for features that are not built; the parity ledger tracks them ([`../telegram/parity.md`](../telegram/parity.md)).

## Structure

- Views are functions of state: they read the store and the runtime each frame and never keep a second copy of domain data. State that outlives a frame lives in the slice's `State` or `Page` struct.
- Work off the main thread goes through `runtime.Runtime.Go`, whose result is applied on the next frame; never mutate view state from a goroutine ([`../project/architecture.md`](../project/architecture.md)).
- Elements that animate, keep focus or hold scroll position need a stable identity: `c.Key(id)`. A composer field is keyed by chat so each chat keeps its draft and the field takes focus on open (`AutoFocus`).
- Extract a function or a slice when a block is reused or a file grows past about 300 lines.

## Interaction (telegram-macos)

Interactions follow telegram-macos. Each registry entry carries the upstream id it reproduces, and `make parity` checks the keys against upstream.

- **Shortcuts** live in `frontend/shared/config.Shortcuts`; the menu bar in `bootstrap.Menus`. A shortcut is bound in one place and shown in the menu and the Keyboard Shortcuts pane from there.
- **Context menus** open on right-click (`ui.PopoverMenu`): the message menu (`messageactions.Items`) and the chat menu (`chatactions.Items`). Items reflect state (Pin or Unpin, Mute or Unmute, Mark as Read or Unread) and hide when they do not apply.
- **Button menus** open on click (`ui.PopoverMenuButton`): the attach menu (`compose.AttachItems`), the header's more menu, the account menu.
- **Composer keys.** Enter sends (or ⌘Enter, by preference); ↑ in an empty field edits the last outgoing message; ⌘↑ / ⌘↓ step the reply target; ⌥↑ / ⌥↓ step chats; → in an empty field opens the chat info; Esc cancels a reply or an edit, then closes panels.
- **Destructive actions** confirm in a `kit.Dialog` with a `Destructive` button; deleting offers "also for everyone" where Telegram allows it.
- **Feedback** is a toast for outcomes the view does not show by itself (copied, saved to downloads, automation delivered), never for what the view already shows.

## Layout

- The workspace is three columns: chat list, conversation, and the side panel (chat info or agent). The dividers drag; widths persist in preferences.
- The window has no system title bar (`TitleBarHidden`). Headers read `c.TitleBar()`, leave the room the window controls take on every platform, and drag the window (`DragWindow`).
- Only lists scroll (`ui.List`, with `ListState` for paging and jump-to-message). The window never scrolls as a whole.
- Overlays (media viewer, dialogs, the lock screen) are `Absolute` layers over the workspace; while one is open the workspace ignores its shortcuts (`Env.Modal`).

## Accessibility

- Every interactive element has a label (`.Label(copy.T(…))`): icon buttons in particular.
- Overlays set a role (`ui.RoleDialog`) and take focus when they open; Esc closes them.
- Every action is reachable by keyboard; Tab order follows the visual order.
- Colors come from tokens that keep contrast in light, dark and the desktop's Increase Contrast ([`design-system.md`](design-system.md)).
- Telo's and the desktop's Reduce motion turn movement into fades.
