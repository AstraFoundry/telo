# Teleproto capability baseline

Telo is a third-party Telegram client. The Teleproto request surface is therefore the upstream capability baseline, not a list of optional implementation details.

[`teleproto-capability-matrix.json`](teleproto-capability-matrix.json) classifies every Teleproto request namespace and records the current status of product-level client capabilities:

- `covered` — implemented and supported by repository evidence;
- `planned` — supported by Teleproto but not yet implemented as a Telo workflow;
- `not-applicable` — a transport or experimental/server-operations API that is intentionally outside the desktop client's scope.

`pnpm teleproto:check` runs as part of `make check`. It verifies the installed Teleproto version, fingerprints all request classes (currently 825), requires a policy decision for every namespace, and validates every capability's cited API and evidence path. A Teleproto upgrade or API-surface change fails the check until the matrix is explicitly reviewed.

The matrix is a planning and audit baseline. `covered` does not mean every low-level request in that namespace has a dedicated UI; it means the named product capability has an implemented client workflow. New workflows must update this matrix and the relevant product documentation in the same change.

Telo stays on Teleproto. A full migration to [TDLib](https://github.com/tdlib/td) was evaluated and rejected: Teleproto is the wire protocol (and is documented for automation), TDLib is a client runtime; Telo already implements the kernel the protocol library does not ship. See [`../decisions/004-keep-teleproto.md`](../decisions/004-keep-teleproto.md).
