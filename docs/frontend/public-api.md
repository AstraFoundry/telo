# Public API

> **Telo mapping.** A slice is one Go package; its public API is its exported identifiers. There are no barrel files.

## Rules

- Export only what other slices use: the slice's `State` or `Page`, its `Render` or `View`, its `Env` or `Props`, and the registries the parity gate reads (`Items`, `AttachItems`).
- Keep helpers unexported. A helper two slices need moves down a layer and is exported there.
- A slice does not split into internal sub-packages that other slices could reach; when a slice grows, split it into two slices of the right layers.
- Go's own `internal/` directories are not used inside `frontend/`; the layer rules already say who may import what.

## Example

```go
// frontend/features/compose: the public API
type Env struct { /* … */ }
type Composer struct { /* … */ }
func (cp *Composer) Render(c *ui.Context, env Env, chatID tg.ChatID)
var AttachItems = []AttachItem{ /* … */ }

// unexported: only compose uses it
func (cp *Composer) renderPanel(c *ui.Context, env Env, ch tg.Chat)
```

## Shared

`shared` holds independent packages, each its own public API: `kit` (primitives), `theme` (tokens), `copy` (the catalog), `icons`, `config` (shortcuts, countries, emoji, links), `media` (image cache), `runtime` (the UI's boundary), `lib/timefmt`, `assets` and `testkit`.
