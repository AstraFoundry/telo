# Domain Layer

The domain layer contains the business rules of the system. It has no dependencies on frameworks, databases, or transport details.

## What belongs in `domain/`

- **Entities** — objects with identity that change over time (e.g., `Order`, `User`).
- **Value objects** — immutable objects defined by their attributes (e.g., `Money`, `EmailAddress`).
- **Aggregates** — clusters of entities and value objects treated as a single unit.
- **Domain services** — stateless operations that do not naturally belong to an entity.
- **Domain events** — facts that happened in the domain and may trigger reactions elsewhere.
- **Repository interfaces (ports)** — abstractions that the domain defines for persistence.

## Rules

- The domain layer must not import from `application`, `infrastructure`, or `interfaces`.
- Domain code must be pure JavaScript/TypeScript or the equivalent in your language. No HTTP, no SQL, no framework annotations.
- Validation of business invariants happens here.
- Domain-owned vocabulary (chat/message/sticker/story/call/contact/profile DTO shapes, agent provider ids and bounds, preference unions, upload limits) is declared in the domain modules and mirrored by `contracts/src/ipc.ts` through re-exports, so the domain never imports the transport contract.
- Use rich domain models when the rules are complex. Use anemic models with domain services only when the rules are trivial.

## Telegram vocabulary and rules

`domain/telegram/` owns the Telegram vocabulary (`chat.ts`, `message.ts`, `sticker.ts`, `story.ts`, `call.ts`, `contact.ts`, `profile.ts`, `workspace-event.ts`) plus two rule modules:

- **`can-send-content.ts`** — evaluates a chat's `canSendMessages`/`canSendStickers`/`canSendMedia` flags against a content kind (`text` / `stickers` / `media` / `any`). Omitted flags mean writable, and omitted sticker/media flags follow the text flag, matching the `ChatDto` contract. Application send paths consult `assertCanSendContent` before invoking the repository port; adapters only map raw permission data into the flags.
- **`upload-policy.ts`** — Telegram's vendor upload limits (album ≤ 10 files, 2 GB per upload, 10 MB story photos). The IPC boundary and the application layer validate against the same constants.

## Example

```ts
// domain/order/order.ts
export class Order {
  constructor(
    public readonly id: OrderId,
    private items: OrderItem[],
    private status: OrderStatus,
  ) {}

  addItem(item: OrderItem): void {
    if (this.status !== OrderStatus.Draft) {
      throw new OrderDomainError("Cannot modify a submitted order");
    }
    this.items.push(item);
  }

  submit(): void {
    if (this.items.length === 0) {
      throw new OrderDomainError("Cannot submit an empty order");
    }
    this.status = OrderStatus.Submitted;
  }
}
```

## Ports

The domain defines interfaces for anything it needs from the outside world:

```ts
// domain/order/ports/order-repository.ts
export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  save(order: Order): Promise<void>;
}
```

Implementations of these ports live in `infrastructure/`.

## Agent automation

The automation subsystem (`domain/agent/`) adds two entities and the shared vocabulary they use (`agent-automation.ts`).

- **`AgentDeliveryMode`** — `"auto-send" | "draft-only"`, declared per rule/task. The global default is `AGENT_DELIVERY_DEFAULT = "draft-only"`: nothing leaves the account unless an entry explicitly opts into auto-send. `AgentAutomationCreator` (`"user" | "agent"`) records who authored the entry; agent-authored entries take effect immediately.
- **`AgentTriggerRule`** (`agent-trigger-rule.ts`) — fires an agent run when an incoming message matches. The match dimensions (`chatIds`, `senderIds`, `keywords`, `pattern`, `excludeMuted`) combine with AND; several keywords are OR within their dimension (case-insensitive substring); `pattern` is a case-insensitive JavaScript regex validated at construction. A rule must restrict at least one dimension, so it cannot match every message by accident; `excludeMuted` defaults to true. Outgoing messages never match — the anti-loop invariant lives in `matches()`. New rules start enabled.
- **`AgentScheduledTask`** (`agent-scheduled-task.ts`) — fires an agent run on a timer and delivers the result to a fixed `chatId`. The schedule is `{ kind: "cron", expression }` (recurring) or `{ kind: "once", runAt }` (one ISO instant; once attempted, the task is spent and never fires again, even if re-enabled). The optional context scope is `unread` or `folder` — never `selected`, because pinned message ids go stale between scheduling and firing; an `unread` scope without an explicit chat defaults to the delivery chat. `nextRunAt` returns null for spent one-shots and impossible crons.
- **`CronExpression`** (`agent-cron.ts`) — five-field cron (minute hour day-of-month month day-of-week) in the machine's local timezone: star wildcards, numbers, ranges `a-b`, steps (`*/n`, `a-b/n`), comma-separated lists, three-letter English month/day names, both 0 and 7 for Sunday. When day-of-month and day-of-week are both restricted, a day matches either field (Vixie cron semantics). The next-fire search gives up after four years, so an impossible expression ("Feb 30") resolves to no occurrence instead of hanging.

Both entities validate in `create` and re-validate on `restore`, so a hand-edited persistence file cannot smuggle in an invalid match or schedule.
