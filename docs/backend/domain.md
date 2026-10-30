# Domain Layer

The domain layer contains the business rules of the system. It has no dependencies on frameworks, databases, or transport details.

> **Telo mapping.** `backend/domain/telegram`, `agent`, `preferences` and `keywordfolder` are Go packages that import only the standard library and each other. The TypeScript examples below are illustrative.

## What belongs in `domain/`

- **Entities** — objects with identity that change over time (e.g., `Order`, `User`).
- **Value objects** — immutable objects defined by their attributes (e.g., `Money`, `EmailAddress`).
- **Aggregates** — clusters of entities and value objects treated as a single unit.
- **Domain services** — stateless operations that do not naturally belong to an entity.
- **Domain events** — facts that happened in the domain and may trigger reactions elsewhere.
- **Repository interfaces (ports)** — abstractions that the domain defines for persistence.

## Rules

- The domain layer must not import from `application`, `infrastructure`, or `interfaces` (`make arch`).
- Domain code is plain Go: no HTTP, no TDLib, no MyGo.
- Validation of business invariants happens here.
- Domain-owned vocabulary (chats, messages, media, stickers, stories, people, accounts and sign-in steps, agent providers and bounds, preferences, upload limits) is declared here and used by every other layer, the UI included.
- Use rich domain models when the rules are complex. Use anemic models with domain services only when the rules are trivial.

## Telegram vocabulary and rules

`domain/telegram` owns the Telegram vocabulary (`chat.go`, `message.go`, `people.go`, `account.go`, `events.go`), the ports (`ports.go`: `Repository` for the active account, `Accounts` for sign-in and switching) and these rules:

- **Send permissions.** `Chat.CanSend` evaluates `CanSendMessages`, `CanSendStickers` and `CanSendMedia` for a content kind; `RequireSend` returns `ErrCannotWrite`, `ErrCannotStickers` or `ErrCannotMedia`. Both adapters and the automation runner call it before sending, so the TDLib and demo workspaces cannot diverge.
- **Upload limits.** `MaxAlbumFiles` (10), `MaxUploadBytes` (2 GB) and `StoryPhotoMaxSize` (10 MB), as Telegram enforces them; the composer and both adapters check the same constants.
- **Text.** `ParseMarkdown` turns Telegram's inline Markdown into a body and entities; UTF-16 offsets (`UTF16Len`) match TDLib's.
- **Events.** `ChatUpserted`, `MessageUpserted`, `MessagesDeleted`, `MessagesRead`, `TypingChanged`, `DraftChanged`, `AvatarChanged`, `FoldersChanged` and the rest are what the chat store and automation consume.

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

`domain/agent` holds the configuration, threads, redaction and audit records, and automation (`automation.go`):

- **`Delivery`** — `auto-send` or `draft-only`, per rule and task; new entries default to draft-only, so nothing leaves the account unless an entry opts in. `Creator` (`user` or `agent`) records who wrote the entry; agent-written entries take effect at once ([`003`](../decisions/003-agent-automation-safety.md)).
- **`Rule`** — fires on an incoming message. Match dimensions (`ChatIDs`, `SenderIDs`, `Keywords`, `Pattern`, `ExcludeMuted`) combine with AND; keywords are OR within their dimension (case-insensitive substring); `Pattern` is case-insensitive RE2, compiled in `NewRule`. A rule restricts at least one dimension. `Matches` never accepts an outgoing message: the anti-loop rule lives in the domain.
- **`Task`** — fires on a schedule (`cron`, or `once` at an instant; a one-shot is spent once attempted) and delivers to a chat, with an optional unread or folder scope. `NextRun` reports no next run for spent one-shots and impossible expressions.
- **`Cron`** — five fields in local time: wildcards, numbers, ranges, steps, lists, English month and day names, 0 and 7 for Sunday; when both day fields are restricted, either matches (Vixie cron). The search gives up after four years, so "Feb 30" has no next run instead of hanging.

`NewRule` and `NewTask` validate on creation and when a stored file is read back, so a hand-edited file cannot introduce an invalid entry.
