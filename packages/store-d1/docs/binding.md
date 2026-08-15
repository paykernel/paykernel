# D1 Workers binding API

**Package:** `@paykernel/store-d1`  
**Official docs (pin):** https://developers.cloudflare.com/d1/worker-api/ — verified **2026-08-03**

This adapter’s primary path is the **Workers/Pages D1 binding** (`env.PAYMENTS_DB`).  
**No Cloudflare REST API** and **no account API token** are required for normal store construction or claim traffic.

---

## What you bind

In Wrangler (`[[d1_databases]]`), the binding name becomes an `env` property:

```toml
[[d1_databases]]
binding = "PAYMENTS_DB"
database_name = "payments"
database_id = "<your-d1-id>"
```

```ts
// Worker
const stores = createD1PaymentStores({ db: env.PAYMENTS_DB });
```

See [wrangler.md](./wrangler.md) and [`examples/wrangler.toml`](../examples/wrangler.toml).

---

## Surface used by this adapter

| Binding API | Role in adapter |
| ----------- | --------------- |
| `db.prepare(sql)` | Create a prepared statement |
| `stmt.bind(...values)` | Bind parameters (never string-interpolate user values) |
| `stmt.first()` / `stmt.all()` | Read rows (including `RETURNING` claim classification) |
| `stmt.run()` | Execute without needing result rows |
| `db.batch([stmt, …])` | Multi-statement **transaction**; failure aborts/rolls back the sequence |
| `db.withSession(constraintOrBookmark?)` | Sessions for sequential consistency / read-after-write under replication |

Structural types (`D1DatabaseLike`, `D1PreparedStatementLike`, optional session types) **duck-type** the real Workers binding so the package does **not** static-import `cloudflare:workers`. Optional peer `@cloudflare/workers-types` improves DX only.

---

## Executor layer

```ts
import {
  createD1Executor,
  createD1PaymentStores,
  migrateD1Adapter,
} from "@paykernel/store-d1";

// Preferred ergonomic path
const stores = createD1PaymentStores({ db: env.PAYMENTS_DB });

// Or explicit executor (tests, advanced session wrapping).
// Defaults to session: "first-primary" when db.withSession exists.
const executor = createD1Executor(env.PAYMENTS_DB);
await migrateD1Adapter(executor);
```

`D1Executor` is a narrow async port: `query` / `execute` / `batch` (+ optional session helpers). Stores never require local SQLite sync transaction callbacks (`BEGIN IMMEDIATE`).

---

## REST / account API (not required)

| Path | Required for production claims? |
| ---- | ------------------------------- |
| Workers D1 binding (`env.DB`) | **Yes** (primary) |
| Cloudflare REST Management API + account token | **No** |
| Miniflare / local Wrangler D1 | Dev/test only |

Do not require operators to embed account tokens in the Worker for store APIs. Management API may still be used by **ops tooling** outside this package (create DB, apply migrations via Wrangler CLI) — that is outside the runtime binding path.

---

## Forbidden patterns

| Pattern | Why |
| ------- | --- |
| `db.exec` with interpolated SQL for claims | Injection + non-portable; use prepare/bind |
| Unprotected get-then-set across two `.all()` round-trips | Not engine-atomic under concurrency |
| Static `import … from "cloudflare:workers"` in portable packages | Leaks Workers types into core/webhooks/testkit typecheck |
| Treating D1 as `bun:sqlite` / `better-sqlite3` | Different package (`@paykernel/store-sqlite`); different concurrency model |

---

## Related

- [claims.md](./claims.md) — UPSERT + `batch` atomicity  
- [sessions-and-replication.md](./sessions-and-replication.md) — `withSession` / RAW  
- [limits.md](./limits.md) — batch size, CPU, multi-region honesty  
- [migrations.md](./migrations.md) — explicit migrate only  
