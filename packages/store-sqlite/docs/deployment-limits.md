# Deployment limits (Phase 14.5)

**Package:** `@paykernel/store-sqlite`  
**Manifest:** `coordinationScope: "single-host"` — never multi-host for local SQLite files.

Local/embedded SQLite is excellent for single-host apps, desktop tools, Bun services, and tests. It is **not** a distributed coordination plane. The four limits below are **required** reading for production use.

---

## The four limits (14.5)

### 1. One durable filesystem authority per database file

One database file must have **one** durable filesystem authority for writers. All processes that open the file for writes must run against that same local volume on the same host (or equivalent single-host mount).

| OK | Not OK |
| -- | ------ |
| Multiple workers on one host, one local path | Two hosts writing the same file path |
| One container with a local volume | Two containers on two VMs sharing a file without a single FS authority |

### 2. Do not share the file over unsupported network filesystems

Do **not** place the SQLite file on NFS, SMB, or other network filesystems and treat locking/durability as correct multi-writer coordination. Locking and crash recovery semantics are unreliable for this workload.

| Pattern | Outcome |
| ------- | ------- |
| NFS/SMB shared write SQLite | Corruption / lost updates / false “success” risk |
| Local SSD/NVMe path | Supported single-host model |

### 3. Ephemeral serverless filesystems lose state

AWS Lambda, Cloud Functions, and similar **local disks** are often ephemeral between invocations (or across instances). They are **not** suitable as durable inbox / idempotency / reconciliation stores with this adapter.

| Pattern | Outcome |
| ------- | ------- |
| SQLite on `/tmp` in serverless | State may vanish; leases and completions lost |
| Dedicated single-host VM/container with persistent volume | Supported |

### 4. Horizontal multi-host scaling requires another service

Scaling writers across **hosts** requires a shared coordination/durability service — not “copy the same SQLite file” or “mount it from everywhere.”

| Need multi-host? | Prefer |
| ---------------- | ------ |
| Durable multi-host SQL | `@paykernel/store-postgres` |
| Optional multi-host coordination | `@paykernel/store-redis` |
| Multi-host remote SQLite-compatible | `@paykernel/store-turso` |
| Multi-host Workers D1 | `@paykernel/store-d1` |
| Per-object single-threaded coordination | Durable Objects (Phase 17 — not this package) |

---

## Recommended (single-host production)

- `PRAGMA journal_mode = WAL` for persistent multi-connection same-host apps
- `PRAGMA busy_timeout = N` (e.g. 5000 ms) so concurrent writers wait briefly instead of immediate `SQLITE_BUSY`
- `PRAGMA foreign_keys = ON`
- Backups of the main DB file (+ WAL/SHM as appropriate for your ops model)
- Explicit `migrateSqliteAdapter` in bootstrap/ops — never import-time migrate

```ts
import { applyRecommendedPragmas } from "@paykernel/store-sqlite";

applyRecommendedPragmas(executor, { busyTimeoutMs: 5_000, wal: true });
```

---

## Anti-patterns

| Pattern | Why it fails |
| ------- | ------------ |
| NFS/SMB shared SQLite | Locking and durability unreliable |
| Multiple hosts writing one file | Split-brain / corruption risk |
| Advertising multi-host or multi-region for local file | Misrepresents coordination (A3) |
| Auto-migrate on import / default create | Surprises production; forbidden |
| Serverless ephemeral disk as durable inbox | State lost between invocations |
| Shipping sql-store NON_PRODUCTION reference as product | Wrong package / wrong guarantees |

---

## Related

- [guarantees.md](./guarantees.md) — manifest fields
- [drivers.md](./drivers.md) — WAL / busy_timeout helpers
- [overview.md](./overview.md)
