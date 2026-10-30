# Application Layer

The application layer orchestrates use cases. It depends on the domain layer and on domain-defined ports, but not on concrete infrastructure.

> **Telo mapping.** `backend/application/agent` (agent runs, message actions, vendor connection, automation and the model's tools), `preferences`, `keywordfolder` and `telegram` (notification and badge rules). Services take their ports in a `Deps` struct; tests pass fakes or the demo workspace. The TypeScript example below is illustrative.

## What belongs in `application/`

- **Application services** — one per use case or per aggregate. They coordinate entities, domain services, repositories, and external services.
- **DTOs** — data-transfer objects for inputs and outputs at the application boundary.
- **Commands and queries** — lightweight objects representing incoming requests.
- **Transaction boundaries** — a unit of work that spans multiple domain operations.

## Rules

- Application services contain no business rules. They delegate to domain entities and services.
- Application services are framework-agnostic. They do not access HTTP request/response objects.
- One application service method should represent one use case.
- Return DTOs, not raw domain entities, when crossing the application boundary.

## Example

```ts
// application/place-order/place-order-service.ts
export class PlaceOrderService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly inventoryService: InventoryPort,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<OrderDto> {
    const order = Order.create(command.customerId, command.items);

    for (const item of order.items) {
      await this.inventoryService.reserve(item.productId, item.quantity);
    }

    await this.orderRepository.save(order);

    return OrderDto.from(order);
  }
}
```

## Transaction boundaries

- A single use case should be one transaction.
- Define the unit-of-work abstraction in `domain/` if multiple aggregates are involved.
- Implement the unit of work in `infrastructure/`.

## Cross-cutting concerns

- Logging, metrics, and authorization can be handled via decorators, middleware, or explicit service wrappers. Keep them thin and do not let them hide domain logic.

## Agent automation

`Service.StartAutomation(repo, report)` (`application/agent/automation.go`) runs automation for the connected account; the root view restarts it when the account changes, and `Automation.Stop` ends it.

- **Rules and tasks** are saved through `SaveRule` / `SaveTask` (create when the id is empty, edit otherwise), `SetRuleEnabled`, `SetTaskEnabled`, `RemoveRule` and `RemoveTask`. The settings pane passes `CreatorUser`; the agent's own tools (`configureTriggerRule`, `configureScheduledTask` in `tools.go`) pass `CreatorAgent`. Every save goes through `NewRule` / `NewTask`, and a task save re-arms the scheduler.
- **Triggers.** The subscription tracks each chat's mute state from `ChatUpserted` and runs matching rules on `MessageUpserted`. Edits, replacements of a pending message, service messages and outgoing messages never fire. A rule already running is not entered again until its run ends.
- **Schedule.** One timer is armed for the soonest due task. One-shots missed while Telo was closed run at the next start; each finished run re-arms the timer. The last run time is stored even when the run fails, so a one-shot is spent once attempted.
- **A run** assembles the optional scope (redacted, as a panel run), streams the gateway with no workspace snapshot, and appends the same audit record as a panel run. An invalid scope fails before anything leaves the device. Delivery follows the entry: `auto-send` posts (a reply to the matched message for rules); `draft-only` saves a draft, unless the chat's composer already holds text, which ends as `draft-conflict` and keeps the person's text. An empty answer delivers nothing.
- **Reports.** Every run, failed or not, reaches `report` as a `RunReport` (source, entry, chat, delivery, status `sent` · `draft` · `draft-conflict` · `empty` · `error`, and a 200-character preview); the root view shows it as a toast.
