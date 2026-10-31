# Quality

This section defines testing strategy, code-review expectations, and quality gates.

## Documents

- [`testing.md`](testing.md) — testing strategy and test types.
- [`code-review.md`](code-review.md) — code-review checklist.

## Quality principles

- Tests must be deterministic.
- Tests must run quickly enough to be executed on every change.
- Code review is required before merging to the main branch.
- `make check` (format, vet, generated code, architecture, TDLib capabilities, telegram-macos parity, tests, documentation) must pass before merge.

## Definition of done

- Feature is implemented according to the documented architecture.
- Unit tests cover domain logic and critical paths.
- Integration tests cover repository and external-service boundaries.
- UI journeys that change are covered by headless UI tests.
- New telegram-macos surfaces are classified in the parity ledger.
- Documentation is updated if behavior or conventions changed.
- No hardcoded strings, redundant copy, duplicated code, or fallback cleverness.
