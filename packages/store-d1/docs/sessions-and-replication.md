# Sessions and read replication (Phase 16.5)

**Package:** `@paykernel/store-d1`  
**Official docs:** https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession  
**Verified:** **2026-08-03**

When D1 **read replication** is enabled, unbound queries may hit **replicas** and observe **stale** data after a write on the primary. Correctness-critical **read-after-write (RAW)** must use the **Sessions API**.

Alias: historical short doc [`sessions.md`](./sessions.md) points here.

---

## Primary writes vs replica reads

| Operation | Where it lands | Strong? |
| --------- | -------------- | ------- |
| Claim / reserve / complete / fail (writes) | Primary (D1 write path) | **Strong** claim semantics at the engine (conditional UPSERT/UPDATE) |
| Unbound `get` / list after a write (no session) | May hit replica under replication | **Stale possible** |
| Session-scoped reads (`first-primary` / bookmark) | Sequential consistency within session | RAW aligned with session guarantees |

**Claims themselves are writes** and remain strong regardless of sessions. Sessions primarily protect subsequent **reads** used for classification after empty RETURNING, listing, operator queries, and any app-level read-after-write.

Manifest honesty:

- `consistency.readAfterWrite: "session"`
- `consistency.staleReadsPossible: true` (without Sessions under replication)

See [guarantees.md](./guarantees.md) and `D1_STORAGE_ADAPTER_MANIFEST`.

---

## Helpers

```ts
import {
  createD1PaymentStores,
  createD1Executor,
  withD1Session,
  createSessionScopedExecutor,
  D1_SESSION_FIRST_PRIMARY,
  supportsD1Sessions,
} from "@paykernel/store-d1";

// Ergonomic: session option on primary factory
const stores = createD1PaymentStores({
  db: env.PAYMENTS_DB,
  session: "first-primary",
});

// Or wrap binding / executor
const db = withD1Session(env.PAYMENTS_DB, D1_SESSION_FIRST_PRIMARY);
const executor = createSessionScopedExecutor(env.PAYMENTS_DB);

if (supportsD1Sessions(env.PAYMENTS_DB)) {
  // binding exposes withSession
}
```

| Constraint / bookmark | Behavior |
| --------------------- | -------- |
| `first-primary` | First query in the session goes to primary (best for RAW after write) |
| `first-unconstrained` | First query may hit any instance (lowest latency; weaker RAW) |
| bookmark string | Resume sequential consistency from a prior session bookmark |

---

## Strategy for apps

1. **Writes (claims):** always use the shared D1 binding; prefer single-statement UPSERT (see [claims.md](./claims.md)).
2. **Read-after-write on the same request:** use `session: "first-primary"` (or bookmarks across requests if you persist the bookmark).
3. **Cross-region / multi-replica:** do **not** advertise multi-region strong consistency without sessions; stale replica reads are possible.
4. **Tests:** mock D1 may record session constraints; live/miniflare suites assert helpers when available (`sessions.d1.test.ts`).

---

## What we do **not** claim

- Strong RAW **without** Sessions when read replication is on  
- Multi-primary consensus across independent D1 databases  
- Interchangeability with Turso embedded replicas or Durable Objects strong single-object consistency  

Durable Objects (Phase 17) is a **different** consistency model (per-object single-threaded) — not this package.

---

## Related

- [binding.md](./binding.md) — prepare/bind/batch/withSession surface  
- [crash-boundaries.md](./crash-boundaries.md) — lease reclaim after isolate restart  
- [limits.md](./limits.md) — multi-region caveats vs DO  
