# Backend

This section defines how Telo's backend (`backend/`, Go packages in the same process as the UI) is organized using **Domain-Driven Design (DDD)**.

> **Telo mapping.** `domain` and `application` are as described here. `infrastructure` holds TDLib, the Telegram adapters, the agent gateways and the stores. Telo has no network server: the **interfaces** role is played by `bootstrap` (the composition root, menus and the desktop adapter) and by `frontend/shared/runtime`, the services the UI calls. Generic examples in these documents are illustrative; the Telo sections name the Go code.

## Documents

- [`domain.md`](domain.md) — entities, value objects, ports and domain events.
- [`application.md`](application.md) — use cases and the agent's automation.
- [`infrastructure.md`](infrastructure.md) — TDLib, Telegram adapters, agent gateways, storage.
- [`interfaces.md`](interfaces.md) — the composition root and the runtime boundary the UI calls.
- [`api-conventions.md`](api-conventions.md) — conventions of that boundary: results, errors, events.
- [`database.md`](database.md) — every file Telo writes.
- [`logging.md`](logging.md) — diagnostics and masking.

## Dependency direction

```text
interfaces (bootstrap, runtime) -> application -> domain
infrastructure -> domain (implements its ports)
```

`make arch` enforces it: the domain imports nothing outside itself, the application imports only the domain (tests may use infrastructure fakes), and infrastructure never imports the UI or `bootstrap`.

## Core principle

Business rules live in `domain`. The other layers depend on it through ports the domain defines; infrastructure implements them.
