# Import Rules

`make arch` (`cmd/archcheck`, part of `make check`) enforces these rules on every Go import under `frontend/` and `backend/`. A violation fails the gate; there is no suppression.

## Layer direction

Imports go only from a higher layer to a lower one:

```text
app -> pages -> widgets -> features -> entities -> shared
```

- `shared` imports no other layer.
- `entities` never imports `features`, `widgets`, `pages` or `app`.
- `features` never imports `widgets`, `pages` or `app`.

## Slice isolation

- A slice may import any slice of a lower layer.
- A slice never imports a sibling slice of its own layer (`features/compose` cannot import `features/search`). Lift the composition one layer up, or extract the shared part into a lower layer. `kit.RichBody` moved to `shared/kit` this way when both the conversation and the agent panel needed it.
- `shared` sub-packages (`kit`, `theme`, `copy`, `config`, …) may import each other; `app` is one package.

## Boundaries outside the frontend

- The UI never imports `backend/infrastructure`; it reaches Telegram, the agent and the stores through `frontend/shared/runtime`. Only `shared/testkit` and `_test.go` files may build the demo workspace.
- The UI never imports `bootstrap`, the composition root.
- The UI may import `backend/domain` (values such as `tg.Chat`) and `backend/application` (services held by the runtime).

The backend rules are in [`../backend/README.md`](../backend/README.md).

## Examples

```go
// ✅ a page composes widgets and features
import (
    "github.com/AstraFoundry/telo/frontend/features/search"
    "github.com/AstraFoundry/telo/frontend/widgets/chatlist"
)

// ❌ a feature imports a sibling feature
import "github.com/AstraFoundry/telo/frontend/features/search" // in features/compose

// ❌ the UI reaches infrastructure
import "github.com/AstraFoundry/telo/backend/infrastructure/telegram/live"
```

## Exceptions

Exceptions must be documented in [`../project/architecture.md`](../project/architecture.md), approved by the user, and encoded in `cmd/archcheck` with a test.
