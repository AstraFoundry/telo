# UI Patterns

This document defines how UI is written in this project. The goal is a consistent, maintainable, and accessible interface.

## Language

- All user-facing copy must be in English unless the user explicitly asks for another language.
- All code, comments, prop names, and CSS custom properties must be in English.

## No hardcoded strings

- Every user-facing string must come from a centralized source: i18n keys, design-system tokens, or a constants file.
- Do not write labels, placeholders, or error messages directly in components.

```tsx
// ✅ Good
import { t } from "shared/i18n";

<Button>{t("order.submit")}</Button>;
```

```tsx
// ❌ Bad
<Button>Submit order</Button>
```

## No redundant copy

- Do not repeat information already shown by a title, icon, selected state, or surrounding section.
- Prefer concise labels over explanatory text when the state is self-evident.
- Remove disabled placeholder actions unless they teach a real next step.

```tsx
// ❌ Bad
<div>
  <h1>Orders</h1>
  <p>This section shows your orders.</p>
</div>
```

```tsx
// ✅ Good
<div>
  <h1>{t("orders.title")}</h1>
  <OrderList />
</div>
```

## Semantic styling

- Use semantic design tokens instead of physical colors.
- ❌ Avoid: `bg-white`, `text-black`, `zinc-500`.
- ✅ Prefer: `bg-background`, `text-foreground`, `border-border`, `text-muted-foreground`.
- Theme differences must live in one place (global theme file or CSS variables). Do not scatter `dark:` or media queries across components. When one theme needs a contrast tweak, reach for an alpha variant of a semantic token (e.g. `text-foreground/70`) that reads correctly in both themes.
- Elevation is expressed with layered transparent shadows, not hairlines. The workspace shell paints `bg-background`; the central column floats on it as a card (`bg-card rounded-l-2xl shadow-column`, token defined per theme in `frontend/src/app/styles/index.css`), and its shadow carries the separation. When the agent panel is open the card's right corners round too (`rounded-r-2xl`) and the panel sits borderless on the shell background, mirroring the left sidebar. Reserve `border-*` for structural separations inside content (Settings section dividers, the sidebar account row) — never to partition the app shell, and never doubled against a shadowed edge.
- Outgoing chat bubbles use the beui `MessageBubble` `tint` variant (accent-tinted surface, foreground text), matching Telegram's accent-family outgoing bubbles. The `solid` variant inverts `bg-foreground`/`text-background`, which reads as near-black in light theme and glaring white in dark theme; do not use it for chat bubbles.

## Deslop scan suppressions

The `kill-ai-slop` project skill ships a scanner (`.agents/skills/kill-ai-slop/scripts/scan.mjs`) that flags AI-slop visual and copy tells in source. It runs on demand through the skill; it is not wired into `package.json` scripts or CI.

Hits that have been reviewed and confirmed intentional are pinned in source with comment directives:

- `deslop-ignore` — suppress hits on the same line.
- `deslop-ignore-next-line` — suppress hits on the next line.
- `deslop-ignore-file` — suppress hits in the whole file.

Each directive accepts optional tell ids (e.g. `/* deslop-ignore-next-line 19 */`) to suppress only those tells. Always prefer the id-scoped form so new tells on the same lines still surface, and add a suppression only after the hit has been defended — never to silence the scanner preemptively. `deslop-ignore-next-line` must sit on the line immediately above the line the scanner reports; inside a multi-line JSX element the hit lands on the `className` attribute line, so the directive belongs between the previous attribute and `className`, not above the element's opening tag.

Current uses: tell `12` (flat type hierarchy) on compact panel headings and tell `19` (max-radius) on avatar and unread-badge pills — both deliberate parts of the Telegram-style chat UI. Avatars and unread pills stay hand-composed under these suppressions because the beui registry has no generic `Avatar` or unread-count `Badge` yet; the upstream registry request is tracked in `.workspace/todo/telo.md`, and these suppressions should be revisited once those components land.

## Component and icon sources

- Import UI primitives only from `shared/ui`; that module re-exports the installed BEUI registry source.
- Compose product-specific rows and regions from those primitives. Do not create a parallel button, input, select, switch, tooltip, message, or prompt implementation.
- Use `@phosphor-icons/react` for system icons. Icon-only controls require a tooltip and accessible name.
- The assistant/agent icon is `Sparkle` everywhere (panel header, message avatars, the agent toggle, empty states), matching the beui agent components (`AgentActivity` rows use it too). Never use `Robot`. Keep the toggle's `weight={open ? "fill" : "regular"}` outline/fill state convention.
- Keep notification copy out of the renderer surface and send notifications through `window.telo.shell.notify`. Status: the capability is implemented end to end (contract, preload, main handler) but no renderer code calls it yet. Decision: retain the channel as ready-to-use; the first intended integration point is unread-message notifications.

## Settings and preferences

- Preference reads/writes go through per-key hooks built with `createPreferenceStore` (`frontend/src/entities/preferences/model/preference-store.ts`) — the theme model generalized: a module-level external store loads the persisted value once, `select` publishes the new value optimistically, and a failed write re-sources from `preferences.get()`. Values that are visible outside React pass an `apply` side effect. Only app-wide values (accent, message text size) load eagerly at module scope; the rest load on first subscriber. The hooks live in the `entities/preferences` slice (`model/hooks.ts`) so any layer can subscribe; Settings edits apply live in the conversation sidebar (row timestamps), the conversation view (message times, `--message-font-size`), and the message composer (send-with-Enter) without a remount.
- A single switch-style setting renders as a `SettingRow` (`frontend/src/pages/settings/ui/setting-row.tsx`): label and optional hint on the left, control on the right. Multi-option choices use the beui `RadioGroup`; bounded numbers use the beui `RangeSlider` with the current value shown next to the label.
- Token override points live in `frontend/src/entities/preferences/model/hooks.ts`. A non-blue accent writes `--primary` / `--primary-foreground` / `--ring` inline on `documentElement` — same lightness/chroma as the blue defaults in `app/styles/index.css`, only the hue differs, with separate light and dark sets. Blue removes the inline overrides so the stylesheet defaults win again, and a `MutationObserver` on the `dark` class re-applies the matching set when the theme flips. The message text size publishes as `--message-text-size`; message surfaces size with `var(--message-text-size, 14px)`.
- Destructive account actions confirm in two steps on the beui `StatefulButton`: the first click arms the confirm label (destructive tokens), the second executes and the button's own loading/success states carry the async feedback. Demo-workspace logout additionally clears the `demoWorkspace` preference; the backend demo logout is a no-op by design.

## Context menus

- Context menus come only from the beui `ContextMenu` family via `shared/ui`. Right-click, the ContextMenu/Shift+F10 keyboard path, and the touch long-press are built into the component; consumers never wire their own `contextmenu` listeners. The portal's morph origin, keyboard navigation, typeahead, and reduced-motion fallback are likewise component-owned.
- Trigger targets: the chat row in the conversation sidebar and the message bubble in the conversation view. The trigger wraps the innermost element that carries the meaning (the row button, the bubble), so header and footer chrome stays outside the menu's hit area and left-click selection behavior is untouched.
- Item order mirrors Telegram desktop: mark read/unread → pin/unpin → mute/unmute on chat rows; Reply → Edit (outgoing messages only) → Copy → Forward → separator → Delete on message bubbles. A destructive item, when one exists, goes last after a `ContextMenuSeparator` with `tone="destructive"`.
- Toggle labels reflect the current state (`Mark as read` vs `Mark as unread`, `Unpin` vs `Pin`, `Unmute` vs `Mute`) and come from `copy.ts`; each item pairs a `size-4` Phosphor icon (`Checks`, `PushPin`/`PushPinSlash`, `Bell`/`BellSlash`, `Copy`, `ArrowBendUpLeft`, `PencilSimple`, `ArrowFatLineRight`, `Trash`) with its label.
- The message menu is selection-aware: it snapshots `window.getSelection()` when the menu opens (`onOpenChange`), not at render time — the portal keeps its items mounted while closed, so render-time reads go stale. A non-empty selection offers `Copy Selected Text`; otherwise `Copy Text` copies the whole message body via `navigator.clipboard`.
- Reply/Edit do not act on the message directly: they set the chat store's `composerTarget`, and the composer's preview bar (accent bar, title, truncated preview, cancel control) carries the pending state until send or cancel.

## Dialogs

- Modals come only from the beui `CenterMorphModal` family via `shared/ui`. Controlled usage passes `open` + `onOpenChange`; `CenterMorphModalContent` owns the backdrop, focus trap, Escape dismissal, close control, and reduced-motion fallback. Its `ariaLabel` and `closeButtonLabel` come from `copy.ts` — never accept the component's hardcoded English default.
- Confirmation dialogs (message deletion) state the consequence in one sentence and offer a ghost cancel plus a single danger action: the beui `Button` has no destructive variant, so the confirm button is `variant="primary"` with a destructive token override (`bg-destructive text-primary-foreground hover:bg-destructive/90`).
- Picker dialogs (forward target) list conversations as full-width ghost `Button` rows that reuse the sidebar chat-row composition (initials avatar + title); this is a composition of existing primitives, not a new row component.

## Onboarding

- The onboarding page (`frontend/src/pages/onboarding/ui/onboarding-page.tsx`) holds a local `welcome | auth` step. Welcome shows the logo, title, subtitle, the `copy.startMessaging` primary action, and the demo ghost action; the auth step renders `TelegramConnectionFlow` and closing it returns to welcome. The skip-to-content link convention from Accessibility applies here too.
- The connection flow is a beui `MorphingModal` (`placement="center"`) whose `viewId` follows the step, so the panel morphs its height and blur cross-fades between views; the first view does not animate. The beui registry has no non-modal view-morph container — the modal scheme is the sanctioned reuse of `morphing-modal`'s inner-view morph; do not hand-write a step transition instead. The vendored component's backdrop label is a hardcoded registry default (no label prop exists yet) — a known registry gap.
- Steps are `phone → code → password`, driven by `useConnectionForm` (`features/connect-telegram/model`): local step state follows the store's auth status, so a submitted or failed attempt keeps the user on the current step until the backend pushes the next one. The code step header carries the entered phone number plus a pencil icon-button (`copy.editPhoneNumber`, with tooltip) that returns to the phone step; the password step titles itself with `copy.connectionPassword`.
- Application credentials are build-time injected, so the renderer never asks for them. When `configuration.applicationCredentialsConfigured === false` the flow renders only a `role="alert"` configuration error (`copy.credentialsMissing`).
- Submission errors surface through the beui `Input` `error` prop (shake, red border, inline message) — never a standalone error paragraph next to the form.
- The entrance stagger on welcome uses the beui `TextReveal` for the text items (title, then subtitle with a small `delay`); the logo and buttons stay static because the registry has no generic reveal container for arbitrary elements. Note that `TextReveal` splits copy into per-word spans, so jsdom accessible-name queries concatenate without spaces — assert on `textContent` in unit tests.
- The loading state (auth initializing) renders `copy.connectionConnecting` inside the beui `TextShimmer`, wrapped in a `role="status"` paragraph. `TextShimmer` injects its keyframes via a `<style>` tag, so assertions must use `toContain` on the status text.

## Message bubbles

- A reply renders as a quote block inside `MessageBubbleContent`, above the body: a 2px accent left border (`border-l-2 border-primary`), the quoted sender name in `text-primary`, and the quoted body truncated in `text-foreground/70`. The data is the `replyTo` snapshot on `MessageDto`, so the block survives edits of the original message.
- An edited message shows the `edited` marker next to its timestamp in `MessageFooter` whenever `editedAt` is set.

## Motion

- High-frequency rows change surface color without scaling or lifting.
- Buttons use a restrained `0.96` press scale and no hover scale.
- Interactive transitions name the changing properties and last no more than 200 ms.
- The global agent panel is the one spatial exception: it uses the beui `AnimatedSidebar` in offcanvas mode, whose outer column springs to zero width while the inner 380 px surface remains fixed to prevent text reflow. The component owns the spring timing, the inner cross-fade (the content surface fades and slides with the panel on the component's own transition, covering the OpenTrade-style opacity reveal), the reduced-motion fallback, and the `aria-hidden` + `inert` guard on the closed panel. The panel width lives in a single `AGENT_PANEL_WIDTH` constant in the widget. Never hand-write a CSS transition or a `motion` wrapper around the panel; if the reveal itself must change, change the vendored component.
- Agent activity and thinking states render through the beui `AgentActivity` primitive (its working row is a `ThinkingShimmer`). The placeholder label is never injected as message content. These components carry their own reduced-motion handling (the shimmer ships a `prefers-reduced-motion` rule; the disclosure and row animations read `useReducedMotion`), so consumers must not add local motion media queries.
- Reduced-motion preferences disable nonessential movement globally.

## Components are small and focused

- A component should do one thing.
- Extract a new component when a file grows beyond ~300 lines or when a block is reused.
- Components receive data and callbacks through props; they do not fetch their own data unless they live in a feature slice and that is the slice's explicit responsibility.

## Layout rules

- Use Flexbox to partition the screen into stable regions (header, content, footer).
- Only designated containers scroll. Do not allow the body or arbitrary containers to scroll.
- Set `min-height: 0` on every flex container that participates in the scroll chain.
- The page root should fill the viewport (`min-h-dvh` / `h-dvh`).

## Accessibility

- Use semantic HTML (`button`, `a`, `label`, `nav`, `main`).
- Every interactive element must have an accessible name.
- Do not build fake buttons or links with `div` + click handlers.
- Shell layouts render a skip-to-content link as the first tab stop: visually hidden (`sr-only`), visible on focus (`focus:not-sr-only`), pointing at the `id` anchor on the main content surface. The label comes from `copy.skipToContent`.
