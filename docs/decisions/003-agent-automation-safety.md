# 003: Agent automation safety

## Status

Accepted.

## Context

Agent automation lets the agent act while the user is not at the keyboard. Trigger rules fire an agent run when an incoming Telegram message matches, scheduled tasks fire one on a cron expression or a single future instant, and the agent itself can author both through its `configureTriggerRule` / `configureScheduledTask` tools. Every run ends in a delivery: the reply is posted into a chat or parked in the composer draft.

That surface carries risks the interactive panel never had. A run can send messages nobody asked for. A rule that reacts to messages can react to automation's own output and loop. A run that parks a draft can clobber a message the user is half-way through writing. An agent that configures itself can quietly accumulate behavior the user never approved. And in a multi-account app, a rule authored against one account's chats could fire on — or send from — another.

## Decision

- **Delivery mode is per entry, with a global draft-only default.** Each rule and task declares `auto-send` or `draft-only` (`AgentDeliveryMode`); an absent value resolves to draft-only at domain construction, in the agent tool schemas, and in the Settings dialogs, where draft is the preselected radio. Nothing leaves the account unless a specific entry explicitly opts into auto-send.
- **Agent self-configuration takes effect immediately and stays visible.** Entries authored through the agent tools are saved with `createdBy: "agent"`, work at once (no confirmation queue), and appear in Settings → Agent with a marker, where the user can inspect, disable, or delete them. Every run appends the standard audit record (scope, message ids, redaction counts, prompt hash) under thread id `"automation"`.
- **Outgoing messages never trigger rules.** The trigger engine evaluates only incoming `message-upsert` events with cause `new`, and the rule entity's `matches()` returns false for outgoing messages regardless of match dimensions. Automation's own sends are outgoing, so a rule cannot react to a reply it produced — the anti-loop boundary is in the domain, not in a configuration hint. Message edits never re-fire rules.
- **A draft conflict never overwrites a user draft.** Draft-only delivery checks the composer's `draftPreview` first; an occupied composer is a human's half-written message, so the run ends as `draft-conflict`, leaves the draft alone, and reports the outcome through the automation event.
- **Automation is foreground-account-only.** The trigger engine subscribes to `TelegramAccountCoordinator`, which forwards events only from the active account, and delivery goes through the same façade's `sendMessage` / `saveDraft`, which delegate to the active account. Parked accounts neither fire rules nor receive deliveries. Rules and tasks are stored once per app, not per account.

## Consequences

The user can grant send capability narrowly — one rule, one task — instead of flipping a global switch, and the default posture is read-and-draft. Agent-authored automation is useful immediately (the agent can set up the watch it was asked for in the same conversation) while remaining auditable and reversible from Settings. Loop prevention does not depend on prompt engineering or rate limits: an auto-send rule whose keyword matches its own reply still stops after one hop, because the reply never re-enters matching.

The costs: a legitimate auto-send rule cannot intentionally respond to the account's own messages; a user who wants "always send" must set it on every entry; and a draft-only run whose target composer stays occupied silently accumulates `draft-conflict` events until the user clears the draft.

## Alternatives considered

- **A global delivery setting instead of per-entry modes.** One switch cannot express "this alert rule may send, everything else drafts", and flipping it would silently change every existing entry.
- **A confirmation queue for agent-authored entries.** That makes the agent's management tools useless in the conversation where they were invoked and duplicates the review surface Settings already provides.
- **Loop prevention via depth caps or rate limiting.** A cap still sends N unsolicited messages before it trips; excluding outgoing messages at the domain boundary stops the loop before the first extra send.
- **Overwriting the composer draft (with undo).** Automation would then destroy user content it cannot reconstruct; parking the run as a conflict loses nothing.
- **Per-account automation stores or background delivery.** Delivering from a parked account would resurrect its connection and send as an account the user is not looking at; scoping automation to the foreground account keeps every effect on the account whose events caused it.

## References

- [`001-electron-ipc-boundary.md`](001-electron-ipc-boundary.md) — privileged services stay behind typed IPC.
- [`../backend/domain.md`](../backend/domain.md) — trigger rule, scheduled task, cron, and delivery-mode concepts.
- [`../backend/application.md`](../backend/application.md) — automation service, runner, trigger engine, and scheduler.
- [`../backend/interfaces.md`](../backend/interfaces.md) — automation IPC channels and the automation event.
