# entities

This layer contains domain data and rules.

## What goes here

- One folder per domain concept: `chat`, `telegram`, `agent`, `preferences`.
- Types, factories, validation, and pure functions that operate on the entity.
- Model stores (zustand, or external stores via `useSyncExternalStore`) that hold entity state for the renderer.
- `preferences` owns the user-preference hooks: `createPreferenceStore` builds a module-level external store per key that loads the persisted value once, publishes optimistic writes, and re-sources from `preferences.get()` on failure. Any layer may subscribe, so preference edits in Settings apply live everywhere. App-wide values (theme, accent, message text size) also apply their DOM side effects at module scope.
- No UI and no HTTP clients. Model stores may call the typed preload contract (`window.telo`, defined in `contracts/src`) directly; that IPC surface is the renderer's transport boundary, not framework-specific code.

## Example

```ts
// entities/order/order.ts
export type OrderStatus = "draft" | "submitted" | "cancelled";

export interface Order {
  id: string;
  items: OrderItem[];
  status: OrderStatus;
}
```

## Dependencies

`entities` can import only from `shared`.
