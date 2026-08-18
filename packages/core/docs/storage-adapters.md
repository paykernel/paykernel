# Storage adapters (pointer)

**Core (`@paykernel/core`) does not depend on any storage adapter package.**  
Idempotency, webhook inbox, and reconciliation stores are injected at the **application** layer.

## How to choose

Use the monorepo **Phase 18 selection guide** (capability matrix, decision tree, recommended defaults):

→ **[docs/adapter-selection.md](../../../docs/adapter-selection.md)**

That guide is the single consumer-facing home. Values come from each package’s `StorageAdapterManifest` and shared testkit conformance — not marketing.

## Honesty (short)

| Rule | Detail |
| ---- | ------ |
| Redis is **optional** | Not required to use this SDK |
| Local SQLite is **single-host** | Never multi-host for a local file |
| Turso ≠ local SQLite | Multi-host **remote** only; no `/sync` |
| D1 ≠ Durable Objects | Separate packages; shared D1 vs partitioned DO |
| Memory is **NON-PRODUCTION** | Testkit only (`single-process` + `ephemeral`) |
| No multi-region claim | No published adapter manifest uses `coordinationScope: "multi-region"` |

## Contracts home

Lease-aware store interfaces, error taxonomy, and adapter manifests:

→ [packages/store-contracts/docs/contracts.md](../../store-contracts/docs/contracts.md) (§7 manifests)

## Package map

| Phase | Package | Scope |
| ----- | ------- | ----- |
| 12 | `@paykernel/store-postgres` | Multi-host durable (general default when you have Postgres) |
| 13 | `@paykernel/store-redis` | Optional multi-host; durability configuration-dependent |
| 14 | `@paykernel/store-sqlite` | Single-host file SQLite |
| 15 | `@paykernel/store-turso` | Multi-host remote Turso / libSQL |
| 16 | `@paykernel/store-d1` | Multi-host shared D1 (Workers) |
| 17 | `@paykernel/store-durable-objects` | Multi-host **partitioned** SQLite DO (never one global DO) |

Core remains portable and adapter-free. See also monorepo [workspace-boundaries.md](../../../docs/workspace-boundaries.md).
