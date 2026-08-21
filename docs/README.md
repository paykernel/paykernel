# PayKernel documentation

Read in this order. Package guides stay next to the code they describe.

## Start here

| Doc | When |
| --- | --- |
| [Getting started](./getting-started.md) | First payment, then production composition (inbox + store + reconcile) |
| [Adapter selection](./adapter-selection.md) | Choosing PostgreSQL / Redis / SQLite / Turso / D1 / Durable Objects |
| [Examples](../examples/README.md) | Private Bun checkout kernel + thin Hono/Elysia hosts (single-host in-memory SQLite) |
| Root [README](../README.md) | Package map and install commands |

## Consumer packages

| Package | Start |
| --- | --- |
| `@paykernel/core` | [README](../packages/core/README.md) · [money](../packages/core/docs/money.md) · [outcomes](../packages/core/docs/operation-results.md) · [webhooks](../packages/core/docs/webhooks.md) · [events](../packages/core/docs/webhook-events.md) |
| `@paykernel/webhooks` | [README](../packages/webhooks/README.md) · [inbox](../packages/webhooks/docs/webhook-inbox.md) |
| `@paykernel/reconciliation` | [README](../packages/reconciliation/README.md) · [overview](../packages/reconciliation/docs/overview.md) |
| `@paykernel/routing` | [README](../packages/routing/README.md) · [overview](../packages/routing/docs/overview.md) |
| `@paykernel/gateway-tap` | [README](../packages/gateway-tap/README.md) · [overview](../packages/gateway-tap/docs/overview.md) |
| `@paykernel/opentelemetry` | [README](../packages/observability/README.md) · [overview](../packages/observability/docs/overview.md) |
| `@paykernel/store-contracts` | [README](../packages/store-contracts/README.md) · [contracts](../packages/store-contracts/docs/contracts.md) |
| `@paykernel/sql-foundation` | [README](../packages/sql-foundation/README.md) · [relational foundation](../packages/sql-foundation/docs/relational-foundation.md) |
| `@paykernel/testkit` | [README](../packages/testkit/README.md) (mocks, conformance, memory stores) |
| Store adapters | [Postgres](../packages/store-postgres/README.md) · [Redis](../packages/store-redis/README.md) · [SQLite](../packages/store-sqlite/README.md) · [Turso](../packages/store-turso/README.md) · [D1](../packages/store-d1/README.md) · [Durable Objects](../packages/store-durable-objects/README.md) |

Folder `packages/observability` publishes as **`@paykernel/opentelemetry`**.

## Contributor

| Doc | When |
| --- | --- |
| [Monorepo DX](./monorepo.md) | Layout, commands, build order |
| [Workspace boundaries](./workspace-boundaries.md) | Dependency matrix (`bun run check:boundaries`) |
| [Releases](./releases.md) | Changesets, provenance, prerelease |
| [Core baseline](../packages/core/docs/baseline/README.md) | Generated public-api / pack inventory (not a product guide) |

`roadmap.md` at the repo root is a **completed phase log** (0–22 shipped; Phase 23 started with `@paykernel/gateway-tap`) plus leftover product work. It is not the consumer index.

## Honesty (always)

- Redis is **optional**. Local SQLite is **single-host**. Turso is **remote multi-host** (no `/sync`). D1 ≠ Durable Objects. Memory stores are **non-production**.
- `handleWebhook` verifies and normalizes. Fulfill after an inbox **claim**, and only when `isPaidOutcome` (or an equivalent paid-like check) is true.
- Never auto-route a second gateway after timeout / indeterminate / uncertain 5xx.
