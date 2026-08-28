# pages

This layer contains surface components that the `app` layer switches between (onboarding, workspace, settings). Telo is an Electron app with no URL router; surfaces are selected by application state.

## What goes here

- One folder per surface.
- Surface composition: combine widgets and features into a complete screen.
- Reading surface parameters and passing them to child components.
- Surface-level layout skeleton (header / left / main / right / footer).

## What does NOT go here

- Reusable UI components.
- Business logic or direct API calls.
- Deep prop drilling; prefer composing features/widgets.

## Dependencies

`pages` can import from `widgets`, `features`, `entities`, `shared`.
