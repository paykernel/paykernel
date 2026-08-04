# Embedded replicas and `/sync` (not shipped)

**Package:** `@paykernel/store-turso`  
**Policy:** honest manifests only — never advertise untested local-first sync.

---

## What Phase 15 ships

| Export | Status |
| ------ | ------ |
| `@paykernel/store-turso` | Root: stores, migrate, manifest |
| `@paykernel/store-turso/serverless` | `@tursodatabase/serverless` remote fetch |
| `@paykernel/store-turso/libsql` | `@libsql/client` remote + local `file:` / `:memory:` |
| `@paykernel/store-turso/sync` | **Does not exist** |

There is no package subpath, no runtime helper, and no documentation path that claims production readiness for `/sync` or multi-writer embedded-replica conflict resolution.

---

## Legacy embedded replica ≠ true local-first multi-writer

Turso / libSQL ecosystems have historically discussed **embedded replicas** and sync clients (including packages such as `@tursodatabase/sync` in the broader ecosystem). Those modes are **distinct** from:

1. **Shared remote primary** multi-host coordination (this adapter’s advertised model).
2. **True local-first multi-writer** with proven conflict resolution for lease-aware claims.

Advertising embedded-replica or sync modes as “local-first multi-host safe” without dedicated conflict and concurrency tests is a **Phase 9 honesty failure**.

Phase 15 deliberately:

- Omits `./sync` from `package.json` `exports`.
- States in `TURSO_STORAGE_ADAPTER_MANIFEST.notes` that embedded replica / sync are **not** advertised as true local-first sync.
- Keeps `/libsql` `file:` as a **CI / single-process** convenience only, not multi-host coordination.

---

## What to use instead

| Goal | Recommendation |
| ---- | -------------- |
| Multi-host durable claims | Remote Turso / libSQL URL + this adapter (`multi-host` manifest) |
| Single-host local file SQLite | `@paykernel/store-sqlite` (honest `single-host`) |
| Low-latency optional coordination | `@paykernel/store-redis` (optional; not sole audit store by default) |
| Shared PostgreSQL | `@paykernel/store-postgres` |

---

## Operator guidance

- Do not point workers at divergent local replica files and assume engine-level claim exclusivity without a shared primary.
- Do not set `coordinationScope` marketing copy to multi-region strong consistency for untested sync topologies.
- If a future phase adds a tested sync/replica mode, it must ship new conformance + conflict proofs and update the manifest honestly.

---

## Related

- [overview.md](./overview.md)
- [guarantees.md](./guarantees.md)
- [drivers.md](./drivers.md)
- [claims.md](./claims.md)
