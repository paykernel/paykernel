# Guarantees — Durable Object adapter

**Manifest:** `DO_STORAGE_ADAPTER_MANIFEST` / `getDoStorageAdapterManifest()`

| Field | Value | Honesty |
| ----- | ----- | ------- |
| `name` | `cloudflare-do` | |
| `coordinationScope` | `multi-host` | Partitioned DO; not multi-primary global consensus |
| `durability` | `durable` | SQLite-backed DO storage |
| `consistency.claims` | `strong` | Engine UPSERT/RETURNING and/or transactionSync **within a partition** |
| `consistency.readAfterWrite` | `strong` | **Within a single DO instance** |
| `staleReadsPossible` | `false` | Within partition; cross-partition no global order |
| `supportsTransactions` | `true` | `transactionSync` + single-statement atomicity |
| `supportsLeases` | `true` | |
| `supportsRetentionCleanup` | `true` | Partition-local cleanup |

## What we do **not** claim

- Strong global total order across all payment keys.
- Interchangeability with D1, local SQLite, or Turso.
- Exactly-once alarms (alarms are at-least-once).
- Safety of a single global Durable Object under load (forbidden as default).

Verification pin: Cloudflare DO SQLite storage + alarms docs **2026-08-03**.
