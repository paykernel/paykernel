# Platform limits and honesty (Durable Objects)

**Package:** `@paykernel/store-durable-objects`  
**Manifest:** `coordinationScope: "multi-host"` (partitioned DO), `durability: "durable"`, strong claims/RAW **within a partition**  
**Not:** shared D1 · local single-host SQLite · Turso/libSQL · one global DO for all work

This document records operational limits so multi-host DO claims stay **honest**.

---

## DO / Workers limits (operator awareness)

| Area | Guidance |
| ---- | -------- |
| **Per-object single-threading** | One Durable Object instance processes storage ops serially. Same-key (or same-partition) work queues; do not expect parallel writes inside one object. |
| **Storage size** | Each SQLite-backed DO has a platform storage limit (plan-dependent). Partition when data grows; do not assume unbounded single-object growth. |
| **CPU / wall time** | Keep claims short SQL. Do not run long scans or bulk jobs on the hot claim path. Alarms (optional) for deferred drain — not unbounded CPU in `fetch`/RPC. |
| **Request size** | Bound list/retry page sizes. Do not store raw provider payloads/signatures by default. |
| **Object count** | `key` strategy can create many objects; `hash` caps partitions. Cold starts and eviction cost scale with object cardinality. |
| **Alarms** | One alarm per DO + queue table. Many `setAlarm` per record → alarm storms (forbidden pattern). At-least-once delivery — not exactly-once. |
| **Multi-region** | Do **not** advertise global multi-primary strong consistency. Strong coordination is **per partition** (per DO instance). |

Official limits evolve; re-check Cloudflare Durable Objects docs for your plan.  
SQLite storage + alarms API pin used by this package: **2026-08-03** —  
https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ ·  
https://developers.cloudflare.com/durable-objects/api/alarms/

---

## Hot partitions and hot keys

| Risk | Why | Mitigation |
| ---- | --- | ---------- |
| Hot key (`kind: "key"`) | All ops for one key hit one object | Expected for true per-key serialization; accept queueing or redesign product key |
| Hot tenant (`kind: "tenant"`) | One tenant dominates traffic | Split tenant further, or hash within tenant for non-strict isolation needs |
| Hot hash bucket | Many keys collide on one partition | Increase `partitions` (recommend ≥ 16); rebalance carefully if changing N |
| Global singleton | Entire payment volume on one DO | **Forbidden** — rejected by sharding helpers; never default |

Details: [sharding.md](./sharding.md).

---

## Comparison matrix

| Concern | **store-durable-objects** | store-d1 | store-sqlite | store-turso |
| ------- | ------------------------- | --------------------- | -------------- | ------------- |
| Coordination | **Multi-host partitioned** DO (strong **within** partition) | **Multi-host shared** D1 | **Single-host** local file | **Multi-host** remote Turso/libSQL |
| API | Worker stub RPC + sync in-object SQL | Workers D1 binding async | Sync `BEGIN IMMEDIATE` | Async libSQL/serverless clients |
| Deploy | Workers + **SQLite-backed** DO classes | Workers/Pages D1 binding | Bun/Node process | Any runtime with client |
| Ordering | Serial **per DO**; no global total order | Shared DB; session-dependent RAW under replication | Single-host process | Shared remote primary |
| REST account token for claims | **Not required** (binding) | **Not required** (binding) | N/A | Auth token for remote URL |
| Interchangeable? | **No** | **No** | **No** | **No** |

Do **not**:

- Merge this package into `store-d1` or invent a generic `adapter-cloudflare` / umbrella Cloudflare store
- Treat DO as a drop-in for local SQLite or Turso
- Default all payment work to one global Durable Object
- Use legacy KV-only DO (`new_classes` without SQLite) — this adapter needs `new_sqlite_classes` / `storage.sql`

---

## Crash and restart (summary)

| Event | Expected behavior |
| ----- | ----------------- |
| Crash after claim commit, before external complete | Lease remains until expiry; reclaim after expiry |
| Throw inside `transactionSync` | Transaction rolls back |
| Object eviction / restart | SQLite-backed storage is durable; completed rows remain |
| Stale lease token on complete | `StoreLeaseLostError` |
| Alarm redelivery | At-least-once; re-check claim/lease state |

Details: [crash-boundaries.md](./crash-boundaries.md).

---

## Related

- [guarantees.md](./guarantees.md) — `DO_STORAGE_ADAPTER_MANIFEST`  
- [sharding.md](./sharding.md) — strategies and ordering  
- [transactions.md](./transactions.md) — `transactionSync` rules  
- [alarms.md](./alarms.md) — optional partition queues  
- [wrangler.md](./wrangler.md) — binding + `new_sqlite_classes`  
