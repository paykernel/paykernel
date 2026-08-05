# Transactions (Durable Object SQLite storage)

**Package:** `@paykernel/store-durable-objects`  
**API:** `storage.transactionSync` / `createDoExecutor().transaction`  
**Pin:** Cloudflare DO SQLite storage API verified **2026-08-03** —  
https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/

How multi-statement atomicity works **inside** a SQLite-backed Durable Object.  
This is **not** D1 `batch()`, **not** local `BEGIN IMMEDIATE` from `adapter-sqlite`, and **not** Turso client transactions.

---

## Two layers

| Layer | Sync? | Role |
| ----- | ----- | ---- |
| **Worker client** | Async (stub RPC) | Phase 9 store methods; routes via sharding → DO stub |
| **In-object SQL** | **Synchronous** | `storage.sql.exec` + optional `transactionSync` |

Worker-side code is always async. Inside the object, SQL execution is sync. Do not assume you can `await` network I/O while holding a DO storage transaction.

### Worker-client `withTransaction` (honesty)

`createDoPaymentStores(...).{idempotency,webhookInbox,reconciliation}.withTransaction` **hard-fails** with `StoreUnsupportedFeatureError`. Cross-object / cross-stub multi-mutation atomicity is not available; the DO manifest's `supportsTransactions: true` refers to **in-object** `transactionSync` / single-statement SQL only. Prefer single-statement claims, or call `withTransaction` on in-object stores (`createDo*Store` / `PaymentsStoreObject`).

---

## Preferred: single-statement atomicity

Most claims use one engine-level statement (no explicit multi-statement txn):

```sql
INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING …
```

A single SQLite statement is atomic. Prefer this path whenever the sql-store SQLite claim template fits.

---

## Multi-statement: `transactionSync` only

When more than one statement must commit or roll back together:

```ts
storage.transactionSync(() => {
  // pure sync sql.exec only — no await, no fetch, no provider SDK
  storage.sql.exec("UPDATE …", …);
  storage.sql.exec("INSERT …", …);
});
```

Via the package executor:

```ts
executor.transaction(() => {
  executor.run("UPDATE …", […]);
  executor.query("INSERT … RETURNING …", […]);
});
```

### Rules (must follow)

1. **Sync callback only** — the `transactionSync` body must not return a `Promise`. No `async`/`await` inside.
2. **Never external I/O inside the txn** — no `fetch`, no PSP/provider calls, no Worker subrequests while the storage transaction is open.
3. **Never `BEGIN` / `COMMIT` / `ROLLBACK` via `sql.exec`** — the executor forbids them; use `transactionSync` (or the mock’s equivalent).
4. **Cursor fully consumed before any await** — call `.toArray()` (or equivalent) on every `SqlStorageCursor` before leaving the sync path. DO SQL has **no snapshot isolation** for cursors held across awaits.
5. **Never hold a transaction open across external provider network calls** (roadmap / A1).

---

## Correct claim lifecycle

```text
1) claim atomically   (UPSERT RETURNING and/or transactionSync — sync, short)
2) leave / commit storage transaction
3) external provider work  (Worker or DO method AFTER storage txn)
4) complete / fail / markIndeterminate with leaseToken
```

Mismatching or stale lease tokens → `StoreLeaseLostError`.  
Uncertain provider outcomes → `markIndeterminate` / contract rules — **never** invent a definitive failure.

See [claims.md](./claims.md) and [crash-boundaries.md](./crash-boundaries.md).

---

## `blockConcurrencyWhile`

Use `ctx.blockConcurrencyWhile` for **schema init** (e.g. `ensureDoSchema` / `migrateDoAdapter` once at construction), not for every request.

| Use | Avoid |
| --- | ----- |
| One-time `ensureSchema` under `blockConcurrencyWhile` in the DO constructor | Wrapping every claim/RPC in `blockConcurrencyWhile` |
| Short storage transactions for multi-statement claims | Holding concurrency blocked while awaiting external I/O |

---

## Rollback

- Throw inside `transactionSync` → partial SQL writes in that transaction are rolled back.
- Crash after a committed claim but before `complete` → lease remains until expiry; another worker may reclaim (see [crash-boundaries.md](./crash-boundaries.md)).
- Tests: mock DO SQL uses `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` to emulate `transactionSync` ([testing.md](./testing.md)).

---

## Forbidden patterns

```ts
// FORBIDDEN — await inside transactionSync
storage.transactionSync(async () => {
  claim();
  await fetch(providerUrl); // NEVER
});

// FORBIDDEN — BEGIN/COMMIT via sql.exec
storage.sql.exec("BEGIN");
// …

// FORBIDDEN — hold cursor across await
const cursor = storage.sql.exec("SELECT …");
await something();
cursor.toArray(); // cursor-before-await violation

// FORBIDDEN — get-then-set claim outside atomic engine path
const row = get(key);
if (!row) write(key);
```

---

## Related

- [claims.md](./claims.md) — UPSERT / claim → external → complete  
- [crash-boundaries.md](./crash-boundaries.md) — crash before/after side effects  
- [guarantees.md](./guarantees.md) — `supportsTransactions: true` (within partition)  
- [wrangler.md](./wrangler.md) — `new_sqlite_classes` required for `storage.sql`  
