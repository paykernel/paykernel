# Redis key design

**Source:** `src/keys.ts`, caps in `src/limits.ts`

## Defaults

| Piece | Default |
| ----- | ------- |
| Prefix | `psdk` |
| Schema version | `v1` |
| Tenant | optional `t:{tenantId}` segment |
| Store segments | `idemp`, `whinbox`, `recon` |

### Record key shape

Without cluster hash tags:

```text
psdk:v1[:t:{tenant}]:{store}:{logicalKey}
```

Examples:

```text
psdk:v1:idemp:pay_123
psdk:v1:t:acme:whinbox:evt_abc
psdk:v1:recon:job_xyz
```

With `clusterKeys: true` (cluster-capable bindings only):

```text
psdk:v1:{tenantOr_}:{store}:{logicalKey}
```

Hash tag body is `tenantId` or `_` so **record + index keys co-locate** on one Cluster slot.

## Index keys (ZSETs / retention)

| Purpose | Key helper | Shape (non-cluster) |
| ------- | ---------- | ------------------- |
| Webhook retry / pending | `webhookRetryIndexKey` | `…:whinbox:retry` |
| Reconciliation due | `reconciliationDueIndexKey` | `…:recon:due` |
| Retention eligibility | `retentionIndexKey(store)` | `…:{store}:retain` |

Scores use millisecond epochs aligned with injectable clock ARGV.

## Size limits

| Cap | Value | Role |
| --- | ----- | ---- |
| `MAX_KEY_SEGMENT_LENGTH` | 128 | prefix, version, tenant, … |
| `MAX_REDIS_KEY_LENGTH` | 512 | full key string |
| `MAX_SANITIZED_ERROR_LENGTH` | 512 | last_error / diagnostics |
| `MAX_RESULT_JSON_BYTES` | 16_384 | idempotency cached result; `complete` fails closed if exceeded (no truncation marker) |
| `MAX_PAYLOAD_REF_LENGTH` | 512 | opaque payload ref (not raw body) |

Segments reject whitespace, newlines, and raw `{` / `}` (hash tags are applied only via `clusterKeys`).

## TTL / retention

- Optional `retentionTtlMs` on store options may set Redis `EXPIRE` on terminal records after complete/fail.
- `deleteExpired` remains the explicit retention API (must not delete indeterminate by default).
- TTLs alone are **not** a substitute for audit history — see [persistence.md](./persistence.md).

## Schema version suffix

`version` (default `v1`) is part of every key so operators can introduce a new key namespace without clobbering old data during rolling upgrades.

## Bun rejects Cluster

The **`/bun` binding** rejects:

- Cluster / Sentinel / nodes topology configuration
- `keys.clusterKeys: true`

Bun’s native Redis client does not support Redis Cluster or Sentinel. Use ioredis or node-redis cluster clients when Cluster is required, with `clusterKeys: true` so multi-key scripts stay single-slot.

## Tenants / multi-tenant

Set `keys: { tenantId: "…", prefix?, version?, clusterKeys? }` on store factories so multiple apps can share one Redis without key collision.

## Related

- [drivers.md](./drivers.md) — Bun topology reject
- [scripts-atomicity.md](./scripts-atomicity.md) — KEYS layout in scripts
- [overview.md](./overview.md)
