# Platform limits and honesty (D1)

**Package:** `@paykernel/store-d1`  
**Manifest:** `coordinationScope: "multi-host"`, `durability: "durable"` — shared D1 only  
**Not:** local single-host SQLite · Turso/libSQL clients · Durable Objects ([`adapter-cloudflare-do`](../../store-durable-objects/README.md), Phase 17)

This document records operational limits and comparison notes so the multi-host claim is **honest**.

---

## D1 / Workers limits (operator awareness)

| Area | Guidance |
| ---- | -------- |
| **`batch()` size** | Prefer **single-statement** claims. Multi-statement only inside `db.batch([...])`. Respect current Cloudflare D1 batch statement limits (platform may cap statements per batch — keep claim batches tiny: typically 1–few statements). |
| **Workers CPU time** | Claims are short SQL; avoid large scans in request path. List/retry endpoints should paginate / bound limits. |
| **Statement size / binds** | Always prepare + bind. Do not ship megabyte provider payloads into store columns by default. |
| **Concurrent writers** | Many Worker isolates may write the **same** D1 database; engine-level UPSERT serializes claims. Extremely hot single keys still contend (expected). |
| **Read replication** | Without Sessions, replica reads may be stale — see [sessions-and-replication.md](./sessions-and-replication.md). |
| **Multi-region** | Do **not** advertise multi-region **strong** consistency for unbound reads. One shared D1 primary + optional replicas ≠ multi-primary consensus. |

Official limits evolve; re-check Cloudflare D1 docs for your account plan. Binding API pin used by this package: **2026-08-03** — https://developers.cloudflare.com/d1/worker-api/

---

## Crash and restart (summary)

| Event | Expected behavior |
| ----- | ----------------- |
| Worker isolate kill mid-request after claim write | Lease row durable in D1; other workers blocked until lease expiry / reclaim |
| Crash before claim write commits | No lease issued; safe retry |
| Crash after side effect, before `complete` | Lease holder or reclaim path; use indeterminate when outcome is uncertain — never invent failure |
| Process restart | Shared D1 retains rows; inject clock for tests (`FakeClock`) |

Details: [crash-boundaries.md](./crash-boundaries.md).

---

## Comparison matrix

| Concern | **adapter-cloudflare-d1** | adapter-sqlite | adapter-turso | Durable Objects (Phase 17, not this package) |
| ------- | ------------------------- | -------------- | ------------- | -------------------------------------------- |
| Coordination | **Multi-host** shared D1 | **Single-host** local file | **Multi-host** remote Turso/libSQL | Per-object single-threaded (different model) |
| API | Workers binding async | Sync `BEGIN IMMEDIATE` | Async libSQL/serverless clients | DO storage / RPC |
| Deploy | Workers/Pages only (binding) | Bun/Node process | Any runtime with client | Workers + DO classes |
| REST account token for claims | **Not required** | N/A | Auth token for remote URL | N/A |
| Interchangeable? | **No** | **No** | **No** | **No** |

Do **not**:

- Drop D1 code into `adapter-sqlite` or vice versa  
- Advertise DO-style single-object linearizability for D1  
- Use local file SQLite as multi-host edge storage  

---

## Batch and claims

1. **Preferred:** one prepared UPSERT + `RETURNING` → one round-trip, engine-atomic.  
2. **Allowed:** multi-statement only via `db.batch()` with verified rollback on failure.  
3. **Forbidden:** get-then-set claim strategy across independent statements without batch.

See [claims.md](./claims.md).

---

## Related

- [guarantees.md](./guarantees.md) — manifest fields  
- [binding.md](./binding.md) — API surface  
- [wrangler.md](./wrangler.md) — deployment  
- Phase 17 DO: separate package [`@paykernel/store-durable-objects`](../../store-durable-objects/README.md) — **not** this package  

