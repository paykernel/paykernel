# PayKernel Package Manifest

Generated during bootstrap from the source snapshot (commit `f83a311`).

## Package map

| Workspace path (source) | Source name | New path | New name | Version policy | Status | Action |
|---|---|---|---|---|---|---|
| `.` (root) | `@abshahin/payments-sdk-monorepo` | `.` | `paykernel` | n/a | private | rename |
| `packages/core` | `@abshahin/payments-sdk` | `packages/core` | `@paykernel/core` | `0.1.0-next.0` | public | rename |
| `packages/testkit` | `@abshahin/payments-testkit` | `packages/testkit` | `@paykernel/testkit` | `0.1.0-next.0` | public | rename |
| `packages/webhooks` | `@abshahin/payments-webhooks` | `packages/webhooks` | `@paykernel/webhooks` | `0.1.0-next.0` | public | rename |
| `packages/reconciliation` | `@abshahin/payments-reconciliation` | `packages/reconciliation` | `@paykernel/reconciliation` | `0.1.0-next.0` | public | rename |
| `packages/observability` | `@abshahin/payments-observability` | `packages/observability` | `@paykernel/opentelemetry` | `0.1.0-next.0` | public | rename |
| `packages/routing` | `@abshahin/payments-routing` | `packages/routing` | `@paykernel/routing` | `0.1.0-next.0` | public | rename |
| `packages/adapter-postgres` | `@abshahin/payments-adapter-postgres` | `packages/store-postgres` | `@paykernel/store-postgres` | `0.1.0-next.0` | public | rename path + name |
| `packages/adapter-redis` | `@abshahin/payments-adapter-redis` | `packages/store-redis` | `@paykernel/store-redis` | `0.1.0-next.0` | public | rename path + name |
| `packages/adapter-sqlite` | `@abshahin/payments-adapter-sqlite` | `packages/store-sqlite` | `@paykernel/store-sqlite` | `0.1.0-next.0` | public | rename path + name |
| `packages/adapter-turso` | `@abshahin/payments-adapter-turso` | `packages/store-turso` | `@paykernel/store-turso` | `0.1.0-next.0` | public | rename path + name |
| `packages/adapter-cloudflare-d1` | `@abshahin/payments-adapter-cloudflare-d1` | `packages/store-d1` | `@paykernel/store-d1` | `0.1.0-next.0` | public | rename path + name |
| `packages/adapter-cloudflare-do` | `@abshahin/payments-adapter-cloudflare-do` | `packages/store-durable-objects` | `@paykernel/store-durable-objects` | `0.1.0-next.0` | public | rename path + name |
| `internal/sql-store` | `@abshahin/payments-internal-sql-store` | `internal/sql-store` | `@paykernel/internal-sql-store` | private | private | rename |

## Independent packages (do not rename)

| Name | Notes |
|---|---|
| `@abshahin/subscriptions` | Personal package; mentioned in roadmap only; not part of PayKernel |
| `@abshahin/logbun` | Sibling personal project; not part of PayKernel |

## Repository metadata (all public packages)

```text
repository.url: git+https://github.com/paykernel/paykernel.git
bugs.url:       https://github.com/paykernel/paykernel/issues
homepage:       https://github.com/paykernel/paykernel#readme (or package subdirectory)
publishConfig.access: public
```
