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

## Related

- [migrations.md](./migrations.md) — explicit migrate only  
- [sharding.md](./sharding.md) — routing strategies  
- [limits.md](./limits.md) — platform limits  
- Official DO get-started: https://developers.cloudflare.com/durable-objects/get-started/  
