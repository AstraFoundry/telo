# Infrastructure Layer

The infrastructure layer implements the abstractions that the domain layer defines. It contains all framework, database, and external-service code.

## What belongs in `infrastructure/`

- **Repository implementations** — concrete persistence for domain aggregates.
- **External service clients** — HTTP clients, SDK wrappers, message publishers.
- **Messaging adapters** — event bus, queue producers/consumers.
- **Configuration and environment access** — reading env vars, config files.
- **Framework-specific code** — ORM mappings, database migrations, cache integrations.

## Rules

- Infrastructure depends on `domain` and `application`. It never contains business rules.
- Implement domain ports, do not invent new interfaces unless needed.
- Keep mapping code explicit. Transform between persistence models and domain entities in one place.
- Do not leak infrastructure details into `application` or `domain`.

## Example

```ts
// infrastructure/persistence/sql-order-repository.ts
export class SqlOrderRepository implements OrderRepository {
  constructor(private readonly db: Database) {}

  async findById(id: OrderId): Promise<Order | null> {
    const row = await this.db.query("orders").where("id", id.value).first();
    return row ? this.toDomain(row) : null;
  }

  async save(order: Order): Promise<void> {
    const row = this.toPersistence(order);
    await this.db("orders").insert(row).onConflict("id").merge();
  }

  private toDomain(row: OrderRow): Order {
    /* ... */
  }
  private toPersistence(order: Order): OrderRow {
    /* ... */
  }
}
```

## External services

- Wrap third-party APIs in thin adapters.
- Define the port in `domain/` or `application/` and implement it here.
- Failures in external services should be translated into domain or application errors, not leaked as raw HTTP errors.
- The agent gateway uses the Vercel AI SDK. Named BYOA providers each have an official `@ai-sdk/*` package except Kimi, which uses `@ai-sdk/openai-compatible` against `https://api.kimi.com/coding/v1`. Construction lives in `createAgentLanguageModel`. `streamText` omits `temperature` when `agentRequestOmitsTemperature` is true (Kimi coding / Moonshot K2.5+), because those models only accept the server's mode-fixed sampler. OAuth tokens are exchanged in `VendorOAuthClient` (PKCE loopback or device code) and attached as a Bearer credential.
- Vendor model lists are fetched by `HttpAgentModelCatalog` (`GET /v1/models`, Anthropic `/v1/models`, Google `v1beta/models`). Failures become a single user-safe message so response bodies never leave the adapter. `TELO_E2E=1` swaps in `FixtureAgentModelCatalog`.

## Agent tools

`AiSdkAgentGateway` assembles the model's tool set per run:

- `inspectWorkspace` reads the renderer's UI snapshot, so it stays gated on the user's workspace-access setting.
- `createAgentTelegramTools` (`agent-telegram-tools.ts`) provides read-only Telegram access — `listChats`, `readChatHistory`, `searchChatMessages`, `searchGlobal`. Tool output is forwarded to the model provider, so sender names and message bodies pass through the same redaction as the scoped-payload pipeline before they leave the main process. Sending stays out of reach: delivery is owned by the automation runner's draft/auto-send pipeline.
- `createAgentAutomationTools` (`agent-automation-tools.ts`) lets the agent manage its own automation: `configureTriggerRule` and `configureScheduledTask` (list / create / update / set-enabled / remove). Everything configured here is authored as `createdBy: "agent"` and takes effect immediately; the tools depend on a structural view of `AgentAutomationService` so the infrastructure layer imports no application class.
