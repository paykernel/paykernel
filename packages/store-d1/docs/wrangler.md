# Wrangler / Workers deployment

**Package:** `@paykernel/store-d1`  
**Example:** [`examples/wrangler.toml`](../examples/wrangler.toml)

---

## Binding

```toml
name = "payments-worker"
main = "src/index.ts"
compatibility_date = "2024-09-23"

[[d1_databases]]
binding = "PAYMENTS_DB"
database_name = "payments"
database_id = "<your-d1-id>"
# Optional: migrations_dir for wrangler d1 migrations (DDL must not use BEGIN/COMMIT)
# migrations_dir = "migrations"
```

`binding` becomes `env.PAYMENTS_DB` in the Worker.

---

## Worker sketch

```ts
import {
  createD1PaymentStores,
  migrateD1Adapter,
} from "@paykernel/store-d1";

export interface Env {
  PAYMENTS_DB: D1Database; // or structural D1DatabaseLike
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Prefer migrate in deploy/CI / one-shot Worker, not every request:
    // await migrateD1Adapter(env.PAYMENTS_DB);

    const stores = createD1PaymentStores({
      db: env.PAYMENTS_DB,
      session: "first-primary",
    });
    // …
    return new Response("ok");
  },
};
```

---

## Migrations via Wrangler CLI

```bash
# Apply package or project migration SQL (no BEGIN/COMMIT in files)
npx wrangler d1 migrations apply payments --local
npx wrangler d1 migrations apply payments --remote
```

Prefer `migrateD1Adapter(env.PAYMENTS_DB)` for parity with sql-store foundation DDL.  
Details: [migrations.md](./migrations.md). Reference SQL: `migrations/0001_foundation.sql`.

---

## Notes

- Normal operation uses the **Workers binding only** — no Cloudflare REST / account API token for store construction.
- Optional peer `@cloudflare/workers-types` improves `D1Database` typing; the package uses structural types so portable monorepo typecheck does not require `cloudflare:workers`.
- Do not leak `cloudflare:workers` imports into core/webhooks/testkit.
- Batch size and D1 platform limits apply; prefer single-statement claims ([limits.md](./limits.md)).
- Read replication: [sessions-and-replication.md](./sessions-and-replication.md).
- Multi-host honesty: all instances must share **one** D1 database id.

---

## Related

- [binding.md](./binding.md)  
- [overview.md](./overview.md)  
- [testing.md](./testing.md)  
