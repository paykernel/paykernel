# Wrangler / Workers deployment

**Package:** `@paykernel/store-d1`  
**Example:** [`examples/wrangler.toml`](../examples/wrangler.toml)

---

## Binding

```toml
name = "payments-worker"
main = "src/index.ts"
# Bumped for node:async_hooks (AsyncLocalStorage). Required so a Worker
# that copies this config does not fail on `import … from "node:async_hooks"`.
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]

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

Prefer `migrateD1Adapter(env.PAYMENTS_DB)` for parity with `@paykernel/sql-foundation` DDL.  
Details: [migrations.md](./migrations.md). Reference SQL: `migrations/0001_foundation.sql`, `migrations/0002_list_indexes.sql`.

---

## Notes

- Normal operation uses the **Workers binding only** — no Cloudflare REST / account API token for store construction.
- Optional peer `@cloudflare/workers-types` improves `D1Database` typing; the package uses structural types so portable monorepo typecheck does not require `cloudflare:workers`.
- Do not leak `cloudflare:workers` imports into core/webhooks/testkit.
- **`compatibility_flags = ["nodejs_compat"]` is required.** `@paykernel/store-d1` imports `node:async_hooks` (`AsyncLocalStorage`) for `withTransaction` isolation. A Worker copying `examples/wrangler.toml` without this flag fails at module load. `nodejs_als` is an acceptable narrower substitute.
- Batch size and D1 platform limits apply; prefer single-statement claims ([limits.md](./limits.md)).
- Read replication: [sessions-and-replication.md](./sessions-and-replication.md). Defaults to `session: "first-primary"` when `db.withSession` exists.
- Multi-host honesty: all instances must share **one** D1 database id.

---

## Related

- [binding.md](./binding.md)  
- [overview.md](./overview.md)  
- [testing.md](./testing.md)  
