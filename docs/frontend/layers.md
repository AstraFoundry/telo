# Layers

> **Telo mapping.** Layers are directories under `frontend/` and slices are Go packages inside them; the generic examples below map as `components` → view functions, `stores` → `State` structs, `HTTP clients` → services on `shared/runtime`. The packages of each layer are listed in [`../project/architecture.md`](../project/architecture.md).

FSD uses six layers. Each has a single responsibility and a strict downward dependency direction.

## `app`

- The root view: which page shows (onboarding, lock, workspace, settings), the theme, global shortcuts, toasts, notifications, the dock badge and the automation lifecycle.

**Does not contain:** business logic, reusable UI or page-specific code.

## `pages`

- Surfaces the `app` layer switches between: `onboarding`, `lock`, `workspace`, `settings`. Telo has no router.
- The page layout and its composition of widgets and features.

**Does not contain:** reusable UI, business logic or direct calls to Telegram. Keep pages thin.

## `widgets`

- Self-contained blocks: the chat list, the conversation, the profile, the settings panes, the media viewer, the onboarding illustration and stepper.
- May compose features and entities, but stay one visual block.

**Does not contain:** application-wide state or page switching.

## `features`

- Complete user scenarios: signing in, composing, message actions, chat actions, search, the account menu, the agent panel.
- Holds the scenario's view, state and calls through the runtime.

**Does not contain:** generic primitives (`shared`) or domain rules (`entities` or the backend domain).

## `entities`

- UI-side models of domain data: `entities/chat` (the chat store: list, transcripts, composers, downloads) and `entities/onboarding` (the sign-in flow).
- Entity stores call the services on `shared/runtime`; that is the UI's boundary to the backend, not an HTTP client.

**Does not contain:** views.

## `shared`

- Primitives and utilities any layer uses: `kit`, `theme`, `copy`, `icons`, `config`, `media`, `runtime`, `lib/timefmt`.

**Does not contain:** business logic or references to specific entities or features.

## Dependency direction

```text
app -> pages -> widgets -> features -> entities -> shared
```

`make arch` enforces it ([`import-rules.md`](import-rules.md)).
