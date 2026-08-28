# Import Rules

FSD is only useful if imports are enforced. Follow these rules strictly.

## Layer direction

Imports can only go from a higher layer to a lower layer:

```
app -> pages -> widgets -> features -> entities -> shared
```

- `shared` cannot import from any other layer.
- `entities` cannot import from `features`, `widgets`, `pages`, or `app`.
- `features` cannot import from `widgets`, `pages`, or `app`.

## Slice isolation

- A slice can import from the public API of any slice in a lower layer.
- A slice in the same layer must not import from another slice in the same layer; the boundary gate rejects it. If two slices need to interact, lift the composition one layer up (for example, the `app` layer composes the workspace and settings pages) or extract a shared abstraction into a lower layer.
- The `app` layer is the composition root and has no slices, so it may import its own modules (e.g. global styles).

## Public API only

- Import only from a slice's root `index.ts`.
- Never import from `ui/`, `model/`, `lib/`, `api/`, or `config/` directly.

## UI barrel enforcement

- All UI primitives and animations come from the vendored beui registry (`frontend/src/shared/beui/`), but application code must import them only through the `shared/ui` barrel (`frontend/src/shared/ui/index.ts`).
- `no-restricted-imports` in `eslint.config.js` forbids every other module under `frontend/src/**` from importing the registry directly, whether via the `@components/*` / `@beui-lib/*` aliases or any relative path into `shared/beui/`.
- The only exempted file is the barrel itself; the beui directory is excluded from linting entirely, so its internal cross-references are unaffected.
- If a component is missing from the barrel, add a re-export to `shared/ui/index.ts` instead of importing the registry file directly.

## Enforcement

`pnpm lint` enforces these rules with `eslint-plugin-boundaries` (`boundaries/dependencies` in `eslint.config.js`) and `no-restricted-imports`:

- Each slice is a distinct element (`boundaries/elements` captures `elementName` per slice directory), so cross-slice imports are checked against the layer policies instead of being skipped as internal.
- Imports are resolved with `eslint-import-resolver-typescript` (`import/resolver` setting), so both tsconfig path aliases (`pages/*`, `entities/*`, ...) and relative imports are checked.
- The default policy is `disallow`; only the layer directions listed above are allowed.
- `no-restricted-imports` enforces the UI barrel rule described above.

## Examples

```ts
// ✅ Good: page imports from widgets and features
import { Header } from "widgets/header";
import { AddToCartButton } from "features/add-to-cart";

// ✅ Good: feature imports from entities and shared
import { type Order } from "entities/order";
import { Button } from "shared/ui";

// ❌ Bad: feature imports from another feature
import { useSearch } from "features/search";

// ❌ Bad: shared imports from entities
import { type User } from "entities/user";

// ❌ Bad: importing internals
import { internalHelper } from "features/add-to-cart/lib/internalHelper";

// ❌ Bad: bypassing the shared/ui barrel to reach the beui registry
import { Button } from "@components/motion/button";
```

## Exceptions

Exceptions must be documented in [`docs/project/architecture.md`](../project/architecture.md) and approved by the user.
