# Wrangler binding (SQLite-backed Durable Objects)

**Package:** `@paykernel/store-durable-objects`  
**Example:** [`examples/wrangler.toml`](../examples/wrangler.toml)

## Required

```toml
name = "payments-worker"
main = "src/index.ts"
compatibility_date = "2024-09-23"

[[durable_objects.bindings]]
name = "PAYMENTS_DO"
class_name = "PaymentsStoreDurableObject"

[[migrations]]
tag = "v1"
# REQUIRED — SQLite-backed DO (storage.sql + transactionSync)
new_sqlite_classes = ["PaymentsStoreDurableObject"]
```

### `new_sqlite_classes` is REQUIRED

| Migration field | Result |
| --------------- | ------ |
| **`new_sqlite_classes`** | SQLite-backed DO: `ctx.storage.sql`, `transactionSync` — **supported** |
| Legacy `new_classes` only (KV-only) | No SQL API — **unsupported** by this adapter |

Do not deploy this adapter against KV-only Durable Object classes.

## Schema

Call `ensureDoSchema` / `migrateDoAdapter` in the DO constructor (e.g. `blockConcurrencyWhile`) or via ops scripts — **not** on package import and **not** by default in `createDoPaymentStores`.

## Worker usage

```ts
const stores = createDoPaymentStores({
  namespace: env.PAYMENTS_DO,
  // NEVER omit — never a silent global DO
  sharding: { kind: "hash", partitions: 32 },
});
```

No REST credentials or account IDs required for store construction.

## Required DO RPC methods

Worker wrappers must forward every name in `REQUIRED_DO_RPC_METHODS` onto
`PaymentsStoreObject`. Hash sharding **requires** `bindHashPartitionLayout`
(DO-1 layout seal) — do not omit the next layout/meta method when one is added;
extend that list.

| RPC | Why |
| --- | --- |
| `bindHashPartitionLayout` | Hash sharding / DO-1 — first writer seals `N` |
| Store claim/list/cleanup (`reserveIdempotency`, `claimWebhook`, …) | Phase 9 contracts |

`tableNamespace` (when set on `createDoPaymentStores`) is the last RPC argument
and is applied inside the DO. `failWebhook` is **pull-only** recovery
(`listRetryable`) — do not auto-wire it to optional alarms.

See [`examples/wrangler.toml`](../examples/wrangler.toml) and `smoke/worker.ts`.

## Related

- [migrations.md](./migrations.md) — explicit migrate only  
- [sharding.md](./sharding.md) — routing strategies  
- [limits.md](./limits.md) — platform limits  
- Official DO get-started: https://developers.cloudflare.com/durable-objects/get-started/  
