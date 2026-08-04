# Persistence and durability (roadmap §13.5)

**Export:** `REDIS_STORAGE_ADAPTER_MANIFEST` — `durability: "configuration-dependent"`

Redis is excellent for atomic claims, leases, and low-latency coordination. It is **not** automatically a durable long-term audit store.

## Four distinctions (must not blur)

| # | Distinction | Meaning for this adapter |
| - | ----------- | ------------------------ |
| 1 | **Coordination-safe** | Multi-worker claims/leases work while Redis is up and shared. |
| 2 | **Durable across process restart** | App processes die; keys still present in the **running** Redis service. |
| 3 | **Durable across Redis restart** | Only if AOF and/or RDB (or managed cloud persistence) is configured correctly and recovery succeeds. |
| 4 | **Only-audit-store** | Using Redis as the **sole** long-term audit history — **not recommended** by default. Prefer hybrid SQL. |

The manifest advertises **(1)** as multi-host coordination and **honest configuration-dependent** durability for (2)/(3). It does **not** claim (4).

## AOF / RDB (operator checklist)

| Setting | Why it matters |
| ------- | -------------- |
| AOF `appendfsync` | `always` / `everysec` / `no` trade durability vs latency |
| AOF rewrite / RDB snapshots | Recovery point objective after crash |
| Replication + failover | Replica lag ⇒ possible loss on promotion |
| Managed Redis (ElastiCache, Memorystore, Upstash, …) | Read the provider’s persistence/SLA docs — do not assume “cloud = durable audit” |
| `maxmemory` eviction | Evicted keys break both coordination and history |

Misconfigured ephemeral Redis (no persistence, aggressive eviction) is fine for **ephemeral coordination tests** but must **not** be described as a durable payment audit trail.

## Not sole audit store

Prefer:

- Redis (or Valkey) for **claims, leases, TTL, due indexes**
- PostgreSQL / D1 / Turso (or equivalent) for **long-term history and audit**

See [hybrid-examples.md](./hybrid-examples.md).

## Replication / failover caveats

- Async replication can lose acknowledged writes on failover.
- Split-brain or multi-primary without consensus is out of scope for `multi-host` honesty.
- Cluster resharding requires hash-tag co-location (`clusterKeys`) on multi-key scripts — Bun binding does not support Cluster.

## Manifest alignment

From `REDIS_STORAGE_ADAPTER_MANIFEST`:

- `coordinationScope: "multi-host"` — shared Redis/Valkey
- `durability: "configuration-dependent"`
- `supportsTransactions: false` (Lua atomicity, not multi-key MULTI as the claim path)
- Notes call out coordination vs process restart vs Redis restart vs audit-store roles

Full field table: [guarantees.md](./guarantees.md).

## Related

- [crash-boundaries.md](./crash-boundaries.md) — Redis restart scenarios
- [guarantees.md](./guarantees.md)
- Roadmap §3.6 / §3.8 / §13.5
