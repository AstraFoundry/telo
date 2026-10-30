# Design system

Telo shares its component anatomy with AstraFoundry's Arion and keeps its own colors. The anatomy is [coss ui](https://coss.com/ui) ported to MyGo, as Arion ports it; the palette is Telo's. Physical values (colors, radii, spacing, type sizes, motion) live only in `frontend/shared/theme`; views read `theme.Tokens` and draw with `frontend/shared/kit`.

## Anatomy (shared with Arion)

- **Radius scale.** `RadiusXS` 2 · `SM` 4 · `MD` 6 · `LG` 10 (controls) · `XL` 14 (cards) · pill. Nested corners are computed (inner = outer − padding), never repeated.
- **Raised controls.** A 1px edge, a 1px top light (`Highlight`) and a contact shadow plus an ambient shadow tinted with `Shade`, never pure black. Pressing flattens the face; `kit.Press` scales to 0.96 for 90 ms.
- **Buttons.** coss variants — `Primary` (one per view), `Outline`, `Secondary`, `Ghost`, `Destructive` — in three heights (28, 32, 36). A disabled button keeps its layout at 64% opacity.
- **Cards and groups.** Hairline cards (`kit.Card`), grouped settings rows (`kit.Group`, `kit.Row`, `kit.NavRow`, `kit.SwitchRow`) with a title above and a footer below the group.
- **Inputs.** `kit.Field` wraps a MyGo input in the card edge and focus ring; `kit.SearchBox`, `kit.Select`, `kit.Segmented`, `kit.Toggle`, `kit.DateTime`.
- **Overlays.** `kit.Dialog` (title, description, body, footer actions), MyGo popover menus for context menus (right-click) and button menus, toasts through `ui.Context.AddToast`.
- **Type scale.** `Display` 28 · `Title` 20 · `Heading` 15 · `Body` 14 · `Callout` 13 · `Caption` 11.
- **Spacing by relationship.** `GapTight` 4 inside a control, `GapRelated` 8 between related items, `GapGroup` 28 between groups, `Gutter` 24 at the edge of a pane.
- **Motion.** Springs that keep their velocity when interrupted: `Settle` (layout, no overshoot), `Pop` (small surfaces entering, slight overshoot), `Quick` (hover and color). With Telo's or the desktop's Reduce motion on, `Tokens.Motion` and `Tokens.Transition` turn springs and slides into a 120 ms fade; views animate only through them.

## Onboarding (aligned with Arion)

`frontend/pages/onboarding` uses the layout of Arion's onboarding window: an 840 × 560 window, the illustration pane (320 wide) on the left, and on the right the stepper, a large title, one sentence and one primary action at the bottom. The steps are welcome, phone or QR code, code, password, registration, the agent provider (optional) and done.

- `widgets/stepper` draws progress as dots; the current dot stretches into a pill.
- `widgets/showcase` draws each step's illustration: a soft photographic backdrop with a mock Telo window and the agent's summary pill floating over it, drawn from fixed copy rather than live state.
- Each step has exactly one primary action; Back and secondary choices are `Ghost`.

## Palette (Telo's own)

- **Neutrals** are cool and low-chroma at OKLCH hue 250, from `Canvas` (0.985 light, 0.17 dark) through `Card`, `Subtle`, `Hairline`, `CardBorder`, `Faint`, `Muted` to `Text`.
- **Accents** — blue, green, purple, red, orange — share one lightness and chroma and differ only in hue, so switching accent never changes contrast. Each resolves `Accent`, `AccentSoft` (hover wash), `AccentInk` (accent as text or line), `Ring`, `Selection` and the outgoing bubble.
- **Status** colors (`Online`, `Success`, `Warning`, `Danger`) are fixed hues, not tied to the accent.
- **Dark** is its own resolution, not an inversion: lighter accents, darker outgoing bubbles, white-alpha hairlines.
- `theme.Apply` also installs the palette into MyGo's own controls, and raises edges and muted text when the desktop asks for more contrast.

## Conversation metrics

The transcript keeps Telegram's density: bubbles pad 11 × 8, are at most 430 wide, round at 16 with 6 on the grouped corners of consecutive messages by one author, and avatars are 33 with a 7 gap. Chat rows are 62 high.

## Rules

- Never write a color, radius or font size in a view; add a token when one is missing.
- Use a `kit` primitive when one exists; extend `kit` rather than styling a MyGo control in place.
- Every visible string comes from the copy catalog ([`ui-patterns.md`](ui-patterns.md)).
