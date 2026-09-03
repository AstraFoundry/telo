# Application Layer

The application layer orchestrates use cases. It depends on the domain layer and on domain-defined ports, but not on concrete infrastructure.

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

Four services run automations with no renderer behind them (`application/agent/`):

- **`AgentAutomationService`** (`agent-automation.ts`) — the create/update/remove surface for trigger rules and scheduled tasks, shared by the IPC handlers (`createdBy: "user"`) and the agent's own management tools (`createdBy: "agent"`). Updates rebuild the entity through the domain's validated restore path, so a patch can never smuggle in an invalid match or schedule, and change hooks notify the runner processes (a task save re-arms the scheduler).
- **`AgentAutomationRunner`** (`agent-automation-runner.ts`) — executes one automation run end to end: assembles the optional scoped payload, streams the gateway with a deliberately empty UI snapshot, and appends the same audit record as a panel run (thread id `"automation"`, hash of the exact prompt, never the prompt itself). An invalid scope throws before anything leaves the device; gateway failures become `"error"` results. Delivery is per the entry's mode: `auto-send` posts the reply into the chat (trigger runs reply to the matched message); `draft-only` parks it in the composer draft — unless the draft is occupied, which is a human's half-written message, so the run ends as `draft-conflict` and never overwrites it. An empty reply is an `empty` result and delivers nothing.
- **`AgentTriggerEngine`** (`agent-trigger-engine.ts`) — subscribes to the Telegram workspace event stream and runs matching rules on `message-upsert` events with cause `new`. Edits never re-fire rules, and outgoing messages (automation's own sends included) are the anti-loop boundary. Chat mute state is tracked live from chat events, so `excludeMuted` evaluates against the latest state without an extra dialog fetch. Matching rules run sequentially per message — several rules on one chat must not race replies into it — and a rule already running is not re-entered until its run finishes.
- **`AgentScheduler`** (`agent-scheduler.ts`) — fires scheduled tasks on a single re-armed timer. Each `refresh` fires missed one-shots (an enabled `once` task whose instant passed while the app was down and that never ran) and arms one timer for the soonest upcoming fire; every completed run re-enters `refresh`, so cron tasks re-arm and spent one-shots drop out. `lastRunAt` is persisted even for failed runs: a one-shot is spent once attempted, and a cron's next occurrence comes from the clock. Clock and timers are injectable for deterministic tests.

The engine and the scheduler report every finished (or failed) run through a shared `notify` callback as an `AgentAutomationEvent`, and runner rejections (invalid scope) surface as a failed run instead of killing the subscription. A corrupt store must not kill the main process either: scheduler `refresh` failures are logged, not thrown.
