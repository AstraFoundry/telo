# Decisions

This section records architecture decision records (ADRs). Each ADR explains why a significant decision was made and what alternatives were considered.

## When to write an ADR

Write an ADR when the decision:

- Is hard to reverse.
- Affects multiple layers or teams.
- Has non-obvious trade-offs.

## Existing decisions

- [`001-electron-ipc-boundary.md`](001-electron-ipc-boundary.md) — privileged services stay behind typed IPC.
- [`002-byoa-providers.md`](002-byoa-providers.md) — named vendor accounts are the preferred agent path; OpenAI-compatible is the fallback, all through the AI SDK.
- [`adr-template.md`](adr-template.md) — template for new ADRs.

## Naming

Use a sequential number and a short kebab-case title:

```
decisions/
  001-use-uuid-for-ids.md
  002-choose-postgresql.md
```
