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
- `widgets/paperplane` is the illustration pane, described below.
- Each step has exactly one primary action; Back and secondary choices are `Ghost`.

## The paper-plane blueprint

The illustration pane is a blueprint sheet on which a sheet of A4 folds into a dart paper plane, one fold for each step the user advances. It follows the [anatomy](../../.agents/skills/anatomy/SKILL.md) skill's method, ported to Go because a native MyGo window has no web view for the skill's SVG or React output, and the marks of the [dimensional-drawing](../../.agents/skills/dimensional-drawing/SKILL.md) skill.

| Stage (stepper position) | Fold | Camera (azimuth, elevation) | Marks |
| --- | --- | --- | --- |
| 0 · welcome | flat sheet | 45°, 58° | `W 210`, `L 297`, centre line |
| 1 · phone or QR | corners to the centre line | 18°, 50° | two 45° arcs, crease length `CR 148.5` |
| 2 · code or registration | edges to the centre line | 74°, 44° | two 22.5° arcs, where the crease meets the side |
| 3 · password | in half | 122°, 30° | the angle left between the halves |
| 4 · agent | first wing | 168°, 32° | keel depth `K 30`, the keel-to-wing angle |
| 5 · done | second wing; the plane lifts off and floats | 236°, 30° | span, dihedral |

- **One model.** `model.go` is the sheet cut along every crease into facets, each carried by the hinges it belongs to; `PoseAt(s)` folds it to any position, and every number the drawing shows (`Marks`, the `ANG` readout) is measured from that pose. Folds stop a degree or two short of 180° so stacked layers keep their order.
- **The kit's camera.** `camera.go` ports the kit's orthographic iso camera and `fitProjection`; the camera eases to each stage's viewpoint the shorter way round the table while the fold runs.
- **Painter's order.** `order.go` orders faces as the kit's `settle` does: wherever two faces overlap on screen, the nearer at a point of the overlap draws later.
- **Paper.** Faces fill in `PaperTop` and the four `PaperShade` tones by facing, lit from the camera's upper left. Cut edges ink in `PaperEdge`; a crease inks in `PaperCrease` only once its fold has begun. The paper casts a soft footprint (`PaperShadow`).
- **Marks.** Extension lines with a gap and overshoot, arrowed dimension lines, dash-dot centre and crease lines, angle arcs with end ticks, and mono capitals over a knockout. They draw themselves on as a fold settles and leave as the next starts. On the paper they take the paper's ink. The fold just made is the one accent (`PlanActive`, `PaperActive`).
- **Frame.** `FIG nn` and the step's title above; a title block below with the part, the stock, `FOLD n / 5`, the drawn scale and the live fold angle.
- **Motion.** A step tweens the position over 1.5 s (a jump of several steps a little longer), and Back unfolds. At rest the camera sways ±2.4° and the finished plane floats, at 30 frames a second. Under Reduce motion every step lands at once and nothing sways.
- **Palette.** `PlanGround`, `PlanGrid`, `PlanGridMajor`, `PlanInk` and `PlanInkMuted` are Telo's hue-250 neutrals: navy ink on a pale ground (a whiteprint) in light, pale ink on navy (a blueprint) in dark.

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
