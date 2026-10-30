# Documentation

This directory is the single source of truth for how this project is built, organized, and evolved by agents.

## Domain map

- [`project/`](project/README.md) — project overview, goals, architecture, and boundaries.
- [`frontend/`](frontend/README.md) — Feature-Sliced Design (FSD) conventions.
- [`backend/`](backend/README.md) — Domain-Driven Design (DDD) layered conventions.
- [`operations/`](operations/README.md) — local development, CI/CD, and deployment.
- [`quality/`](quality/README.md) — testing strategy and code-review expectations.
- [`decisions/`](decisions/README.md) — architecture decision records (ADRs).
- [`telegram/`](telegram/README.md) — TDLib capability matrix, telegram-macos parity ledger and the live baseline.
- [`todo/`](todo/README.md) — where the gap list lives (the parity ledger).
- [`audits/`](audits/telegram-client-gap-audit.md) — a historical audit of the Electron build.

## How to use this documentation

1. If you are new to the project, read [`project/README.md`](project/README.md) and [`project/architecture.md`](project/architecture.md) first.
2. Before writing frontend code, read [`frontend/README.md`](frontend/README.md) and [`frontend/design-system.md`](frontend/design-system.md).
3. Before writing backend code, read [`backend/README.md`](backend/README.md).
4. Before changing deployment, build, or operational behavior, read [`operations/README.md`](operations/README.md).
5. Before adding or changing a Telegram surface, read [`telegram/parity.md`](telegram/parity.md).
6. If you change behavior, architecture, or conventions, update the relevant doc in the same change set. `make check` fails on broken links and unknown `make` targets.
